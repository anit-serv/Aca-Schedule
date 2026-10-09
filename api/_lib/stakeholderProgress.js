import { getAdminDb } from './firestoreAdmin.js';
import { enforceRateLimit } from './rateLimit.js';
import { generateRequestId, sha256Hex } from './request.js';
import { parseEventId, verifyViewerPassword } from './viewer.js';
import { nextProgressBoundaryTime, validateProgressAdjustment } from './stakeholderScheduleAlgorithm.js';

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const emptyProgress = () => ({ version: 0, records: {}, history: [] });

export default async function handler(req, res) {
  const requestId = generateRequestId();
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ success: false, requestId, error: { code: 'METHOD_NOT_ALLOWED' } });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const eventId = parseEventId(body.eventId);
    if (!eventId || typeof body.password !== 'string' || body.password.length > 128 || !['read', 'apply'].includes(body.action)) {
      return res.status(400).json({ success: false, requestId, error: { code: 'INVALID_BODY' } });
    }
    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    await enforceRateLimit(`stakeholder_progress_${sha256Hex(`${eventId}:${ip}`).slice(0, 32)}`, { perMinute: 30, perDay: 1000, trackMinute: true });
    const db = getAdminDb();
    const [eventSnap, secretSnap] = await Promise.all([
      db.collection('events').doc(eventId).get(),
      db.collection('viewerPasswords').doc(eventId).get(),
    ]);
    if (!eventSnap.exists) return res.status(404).json({ success: false, requestId, error: { code: 'NOT_FOUND' } });
    if (!await verifyViewerPassword(body.password, secretSnap.data())) {
      return res.status(401).json({ success: false, requestId, error: { code: 'INVALID_PASSWORD' } });
    }
    const progressRef = db.collection('stakeholderProgress').doc(eventId);
    if (body.action === 'read') {
      const snapshot = await progressRef.get();
      const data = snapshot.data() || emptyProgress();
      return res.status(200).json({ success: true, requestId, data: {
        version: data.version || 0, records: data.records || {}, history: data.history || [],
      } });
    }

    const { timetableType, date, coolId, entryId, field, actualTime, expectedVersion } = body;
    if (!['performance', 'rehearsal'].includes(timetableType) ||
        typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        typeof coolId !== 'string' || coolId.length > 128 ||
        typeof entryId !== 'string' || entryId.length > 128 ||
        !['start', 'end'].includes(field) || !timePattern.test(actualTime) ||
        !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
      return res.status(400).json({ success: false, requestId, error: { code: 'INVALID_BODY' } });
    }
    const [timetableSnap, bandSnap] = await Promise.all([
      db.collection('timetables').where('eventId', '==', eventId).get(),
      db.collection('bands').where('eventId', '==', eventId).get(),
    ]);
    const matching = timetableSnap.docs.find(doc => doc.data().type === timetableType && doc.data().dailyTimetables?.some(day =>
      day.date === date && day.cools?.some(cool => cool.id === coolId && cool.entries?.some(entry => entry.id === entryId)),
    ));
    if (!matching) return res.status(404).json({ success: false, requestId, error: { code: 'ENTRY_NOT_FOUND' } });
    const day = matching.data().dailyTimetables.find(item => item.date === date);
    const linkedType = timetableType === 'rehearsal' ? 'performance' : 'rehearsal';
    const linkedDay = timetableSnap.docs.find(doc => doc.data().type === linkedType)?.data().dailyTimetables?.find(item => item.date === date);
    const nextBoundaryTime = nextProgressBoundaryTime(day, timetableType, coolId, eventSnap.data()?.rehearsalType, linkedDay);
    const bands = bandSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const key = `${timetableType}|${date}|${entryId}`;
    const result = await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(progressRef);
      const data = snapshot.data() || emptyProgress();
      if ((data.version || 0) !== expectedVersion) return null;
      const previous = data.records?.[key] || {};
      const next = { ...previous, [field === 'start' ? 'actualStart' : 'actualEnd']: actualTime };
      if (next.actualStart && next.actualEnd && next.actualEnd < next.actualStart) {
        return { invalidOrder: true };
      }
      const constraint = validateProgressAdjustment({
        day, type: timetableType, bands, rehearsalDuration: eventSnap.data()?.rehearsalDuration || 0,
        records: data.records || {}, coolId, entryId, field, actualTime, nextBoundaryTime,
      });
      if (constraint) return { constraint };
      const records = { ...(data.records || {}), [key]: next };
      const history = [{ key, coolId, field, actualTime, at: new Date().toISOString() }, ...(data.history || [])].slice(0, 100);
      const version = expectedVersion + 1;
      transaction.set(progressRef, { version, records, history, updatedAt: new Date() });
      return { version, records, history };
    });
    if (!result) return res.status(409).json({ success: false, requestId, error: { code: 'STALE_PROGRESS' } });
    if (result.invalidOrder) return res.status(400).json({ success: false, requestId, error: { code: 'INVALID_TIME_ORDER' } });
    if (result.constraint) return res.status(422).json({ success: false, requestId, error: { code: result.constraint } });
    return res.status(200).json({ success: true, requestId, data: result });
  } catch (error) {
    if (error instanceof SyntaxError) return res.status(400).json({ success: false, requestId, error: { code: 'INVALID_BODY' } });
    if (error?.statusCode === 429) {
      res.setHeader('Retry-After', String(error.retryAfterSeconds || 60));
      return res.status(429).json({ success: false, requestId, error: { code: 'RATE_LIMITED' } });
    }
    console.error('[stakeholder-progress]', error);
    return res.status(500).json({ success: false, requestId, error: { code: 'INTERNAL_ERROR' } });
  }
}
