import { waitUntil } from '@vercel/functions';
import { authenticateFirebaseUser, ensureEventEditableByUser } from '../../_lib/auth.js';
import { getAutoScheduleJob, runAutoScheduleJob, shouldResumeAutoScheduleJob, startAutoScheduleJob } from '../../_lib/autoScheduleJob.js';
import { ApiError } from '../../_lib/errors.js';
import { getAdminDb } from '../../_lib/firestoreAdmin.js';
import { generateRequestId } from '../../_lib/request.js';
import { parseEventId } from '../../_lib/viewer.js';

export default async function handler(req, res) {
  const requestId = generateRequestId();
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST'].includes(req.method)) {
    res.status(405).json({ success: false, requestId, error: { code: 'METHOD_NOT_ALLOWED' } });
    return;
  }
  try {
    const auth = await authenticateFirebaseUser(req);
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const eventId = parseEventId(req.method === 'GET' ? req.query?.eventId : body.eventId);
    if (!eventId) throw new ApiError(400, 'INVALID_EVENT_ID', 'A valid eventId is required.');
    await ensureEventEditableByUser({ eventId, userId: auth.userId, userEmail: auth.userEmail, allowedEventIds: null });
    const db = getAdminDb();
    if (req.method === 'POST') {
      const type = body.type || 'performance';
      if (!['performance', 'rehearsal'].includes(type)) throw new ApiError(400, 'INVALID_TYPE', 'Invalid timetable type.');
      const range = body.range || null;
      if (range && (!Number.isSafeInteger(range.startNumber) || !Number.isSafeInteger(range.endNumber)
        || range.startNumber < 1 || range.endNumber > 10000 || range.startNumber >= range.endNumber)) {
        throw new ApiError(400, 'INVALID_RANGE', '出演番号の範囲を確認してください。');
      }
      const job = await startAutoScheduleJob(db, eventId, auth.userId, auth.userEmail, type, range);
      if (job.started) waitUntil(runAutoScheduleJob(db, eventId, job.runId));
      res.status(202).json({ success: true, requestId, data: job });
      return;
    }
    const job = await getAutoScheduleJob(db, eventId);
    if (shouldResumeAutoScheduleJob(job)) waitUntil(runAutoScheduleJob(db, eventId, job.runId));
    res.status(200).json({ success: true, requestId, data: job || { status: 'none' } });
  } catch (error) {
    if (error instanceof SyntaxError) {
      res.status(400).json({ success: false, requestId, error: { code: 'INVALID_BODY' } });
      return;
    }
    if (error instanceof ApiError) {
      res.status(error.statusCode).json({ success: false, requestId, error: { code: error.code, message: error.message } });
      return;
    }
    console.error('[events/auto-schedule]', error);
    res.status(500).json({ success: false, requestId, error: { code: 'INTERNAL_ERROR' } });
  }
}
