import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { autoSchedulePerformance, autoScheduleRange, autoScheduleRehearsal, shiftAutoScheduleCustomFields } from './autoScheduleAlgorithm.js';
import { ApiError } from './errors.js';

const STALE_AFTER_MS = 6 * 60_000;

const entryCount = data => (data.dailyTimetables || []).reduce((count, day) => count +
  (day.cools?.length ? day.cools.reduce((total, cool) => total + (cool.entries || []).length, 0) : (day.entries || []).length), 0);

const bestTimetable = (docs, type) => docs.filter(doc => doc.data().type === type)
  .sort((a, b) => (b.data().dailyTimetables?.length || 0) - (a.data().dailyTimetables?.length || 0)
    || entryCount(b.data()) - entryCount(a.data()))[0];

const sameVersion = (a, b) => !!a && !!b && a.updateTime?.isEqual(b.updateTime);

export async function startAutoScheduleJob(db, eventId, userId, userEmail, type = 'performance', range = null, preview = false) {
  const jobRef = db.collection('autoScheduleJobs').doc(eventId);
  const now = new Date();
  return db.runTransaction(async transaction => {
    const previous = await transaction.get(jobRef);
    const data = previous.data();
    if (data && ['queued', 'running'].includes(data.status)
      && now.getTime() - data.createdAt.toMillis() < 10 * 60_000) {
      return { runId: data.runId, type: data.type || 'performance', range: data.range || null, status: data.status, started: false };
    }
    const runId = randomUUID();
    transaction.set(jobRef, {
      eventId, runId, type, range, userId, userEmail: userEmail || '', preview, status: preview ? 'preparing' : 'queued',
      createdAt: now, updatedAt: now, placed: 0, remaining: 0, error: '', timings: null,
    });
    return { runId, type, range, status: preview ? 'preparing' : 'queued', started: true };
  });
}

export async function getAutoScheduleJob(db, eventId) {
  const snapshot = await db.collection('autoScheduleJobs').doc(eventId).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data();
  return {
    runId: data.runId, type: data.type || 'performance', range: data.range || null, status: data.status, placed: data.placed || 0,
    remaining: data.remaining || 0, error: data.error || '', timings: data.timings || null,
    updatedAt: data.updatedAt?.toDate?.()?.toISOString() || null,
  };
}

export async function runAutoScheduleJob(db, eventId, runId) {
  const jobRef = db.collection('autoScheduleJobs').doc(eventId);
  const claimed = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(jobRef);
    const data = snapshot.data();
    if (!data || data.runId !== runId || !['queued', 'running', 'preparing', 'previewing'].includes(data.status)) return false;
    if (['running', 'previewing'].includes(data.status) && Date.now() - data.updatedAt.toMillis() < STALE_AFTER_MS) return false;
    transaction.update(jobRef, { status: data.preview ? 'previewing' : 'running', updatedAt: new Date() });
    return true;
  });
  if (!claimed) return;

  const started = performance.now();
  try {
    const eventRef = db.collection('events').doc(eventId);
    const [eventSnapshot, bandQuery, timetableQuery] = await Promise.all([
      eventRef.get(), db.collection('bands').where('eventId', '==', eventId).get(),
      db.collection('timetables').where('eventId', '==', eventId).get(),
    ]);
    if (!eventSnapshot.exists) throw new ApiError(404, 'EVENT_NOT_FOUND', 'イベントが見つかりません。');
    const event = eventSnapshot.data();
    const job = (await jobRef.get()).data();
    if (event.ownerId !== job.userId && !event.collaboratorEmails?.includes(job.userEmail)) {
      throw new ApiError(403, 'FORBIDDEN', 'イベントの編集権限がありません。');
    }
    const performanceDoc = bestTimetable(timetableQuery.docs, 'performance');
    const rehearsalDoc = bestTimetable(timetableQuery.docs, 'rehearsal');
    if (!performanceDoc) throw new ApiError(404, 'TIMETABLE_NOT_FOUND', '本番タイムテーブルが見つかりません。');
    const type = job.type || 'performance';
    if (type === 'rehearsal' && (event.rehearsalType === 'none' || event.rehearsalType === 'cool-pre-rehearsal')) {
      throw new ApiError(400, 'UNSUPPORTED_REHEARSAL_TYPE', 'このリハーサル形式は個別の自動配置に対応していません。');
    }
    if (type === 'rehearsal' && !rehearsalDoc) throw new ApiError(404, 'TIMETABLE_NOT_FOUND', 'リハーサルタイムテーブルが見つかりません。');
    const fetchMs = Math.round(performance.now() - started);
    const sourceDoc = type === 'rehearsal' ? rehearsalDoc : performanceDoc;
    const source = { id: sourceDoc.id, ...sourceDoc.data() };
    const rehearsal = rehearsalDoc ? { id: rehearsalDoc.id, ...rehearsalDoc.data() } : null;
    const dates = type === 'rehearsal' && event.rehearsalType === 'rehearsal-day'
      ? event.rehearsalDates || [] : event.performanceDates || [];
    const bands = bandQuery.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const range = job.range || null;
    const rangeBands = type === 'rehearsal' ? bands.map(band => ({
      ...band, performanceDuration: event.rehearsalDuration, performanceCount: 1, toriPriority: 1,
      availableTimeSlots: [...new Set([...(band.availableTimeSlots || []), ...(band.backupRehearsalTimeSlots || [])]
        .map(slot => slot.date))].map(date => ({
        date, timeRanges: [
          ...((band.availableTimeSlots || []).find(slot => slot.date === date)?.timeRanges || []),
          ...((band.backupRehearsalTimeSlots || []).find(slot => slot.date === date)?.timeRanges || []),
        ],
      })),
    })) : bands;
    const result = range
      ? autoScheduleRange(source, rangeBands, range, type === 'performance' && event.rehearsalType === 'cool-pre-rehearsal' ? rehearsal : null)
      : type === 'rehearsal'
        ? autoScheduleRehearsal(source, dates, bands, event.rehearsalDuration, event.rehearsalType,
          { id: performanceDoc.id, ...performanceDoc.data() })
        : autoSchedulePerformance(source, dates, bands,
          event.rehearsalType === 'cool-pre-rehearsal' ? rehearsal : null);
    const computeMs = Math.round(performance.now() - started - fetchMs);
    if (result.error) throw new ApiError(409, 'NO_COMPLETE_SCHEDULE', result.error);
    const customFields = result.placed > 0
      ? shiftAutoScheduleCustomFields(source, result.dailyTimetables, event.customFields, type)
      : undefined;

    await db.runTransaction(async transaction => {
      const [currentJob, currentEvent, currentPerformance, currentRehearsal, currentBands] = await Promise.all([
        transaction.get(jobRef), transaction.get(eventRef), transaction.get(performanceDoc.ref),
        rehearsalDoc ? transaction.get(rehearsalDoc.ref) : Promise.resolve(null),
        transaction.get(db.collection('bands').where('eventId', '==', eventId)),
      ]);
      if (currentJob.data()?.runId !== runId || !['running', 'previewing'].includes(currentJob.data()?.status)) return;
      const bandsUnchanged = currentBands.size === bandQuery.size && currentBands.docs.every((doc, index) =>
        doc.id === bandQuery.docs[index]?.id && sameVersion(doc, bandQuery.docs[index]));
      if (!sameVersion(currentEvent, eventSnapshot) || !sameVersion(currentPerformance, performanceDoc)
        || (rehearsalDoc && !sameVersion(currentRehearsal, rehearsalDoc)) || !bandsUnchanged) {
        transaction.update(jobRef, { status: 'failed', error: '計算中にイベントが変更されました。もう一度実行してください。', updatedAt: new Date() });
        return;
      }
      const now = new Date();
      if (job.preview) {
        transaction.update(jobRef, {
          status: 'prepared', placed: result.placed, remaining: result.remaining,
          prepared: {
            dailyTimetables: result.dailyTimetables, customFields: customFields ?? null,
            timetableId: sourceDoc.id, eventVersion: eventSnapshot.updateTime,
            performanceVersion: performanceDoc.updateTime, rehearsalVersion: rehearsalDoc?.updateTime ?? null,
            bandVersions: bandQuery.docs.map(doc => ({ id: doc.id, version: doc.updateTime })),
          },
          timings: { fetchMs, computeMs }, updatedAt: now,
        });
        return;
      }
      if (result.placed > 0) {
        transaction.update(sourceDoc.ref, { dailyTimetables: result.dailyTimetables, updatedAt: now });
        if (customFields) transaction.update(eventRef, { customFields, updatedAt: now });
      }
      transaction.update(jobRef, {
        status: 'completed', placed: result.placed, remaining: result.remaining, error: '',
        timings: { fetchMs, computeMs, saveMs: Math.round(performance.now() - started - fetchMs - computeMs) },
        updatedAt: now,
      });
    });
  } catch (error) {
    console.error('[auto-schedule job]', error);
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(jobRef);
      if (snapshot.data()?.runId !== runId || !['running', 'previewing'].includes(snapshot.data()?.status)) return;
      transaction.update(jobRef, {
        status: 'failed', error: error instanceof ApiError ? error.message : '自動配置に失敗しました。再度お試しください。',
        updatedAt: new Date(), timings: { totalMs: Math.round(performance.now() - started) },
      });
    });
  }
}

export const shouldResumeAutoScheduleJob = job => job && (job.status === 'queued'
  || job.status === 'preparing'
  || (['running', 'previewing'].includes(job.status) && job.updatedAt && Date.now() - new Date(job.updatedAt).getTime() > STALE_AFTER_MS));

export async function applyPreparedAutoScheduleJob(db, eventId, runId, userId, userEmail) {
  const jobRef = db.collection('autoScheduleJobs').doc(eventId);
  const eventRef = db.collection('events').doc(eventId);
  return db.runTransaction(async transaction => {
    const jobSnapshot = await transaction.get(jobRef);
    const job = jobSnapshot.data();
    if (!job || job.runId !== runId || job.status !== 'prepared' || !job.prepared) {
      throw new ApiError(409, 'PREVIEW_EXPIRED', '計算結果が古くなりました。確認画面を開き直してください。');
    }
    if (job.userId !== userId || job.userEmail !== (userEmail || '')) throw new ApiError(403, 'FORBIDDEN', 'この計算結果を適用できません。');
    const prepared = job.prepared;
    const timetableRef = db.collection('timetables').doc(prepared.timetableId);
    const [eventSnapshot, timetableSnapshot, timetableQuery, bandQuery] = await Promise.all([
      transaction.get(eventRef), transaction.get(timetableRef),
      transaction.get(db.collection('timetables').where('eventId', '==', eventId)),
      transaction.get(db.collection('bands').where('eventId', '==', eventId)),
    ]);
    const same = (a, b) => a?.isEqual?.(b) || (!a && !b);
    const performanceDoc = bestTimetable(timetableQuery.docs, 'performance');
    const rehearsalDoc = bestTimetable(timetableQuery.docs, 'rehearsal');
    const bandsUnchanged = bandQuery.size === prepared.bandVersions.length && bandQuery.docs.every(doc =>
      prepared.bandVersions.some(item => item.id === doc.id && same(item.version, doc.updateTime)));
    if (!eventSnapshot.exists || !timetableSnapshot.exists || !performanceDoc
      || !same(prepared.eventVersion, eventSnapshot.updateTime)
      || !same(prepared.performanceVersion, performanceDoc.updateTime)
      || !same(prepared.rehearsalVersion, rehearsalDoc?.updateTime)
      || !bandsUnchanged) {
      throw new ApiError(409, 'PREVIEW_STALE', '計算後にイベントが変更されました。もう一度確認してください。');
    }
    const now = new Date();
    if (job.placed > 0) {
      transaction.update(timetableRef, { dailyTimetables: prepared.dailyTimetables, updatedAt: now });
      if (prepared.customFields) transaction.update(eventRef, { customFields: prepared.customFields, updatedAt: now });
    }
    transaction.update(jobRef, { status: 'completed', prepared: null, updatedAt: now });
    return { runId, type: job.type, range: job.range || null, status: 'completed', placed: job.placed, remaining: job.remaining };
  });
}
