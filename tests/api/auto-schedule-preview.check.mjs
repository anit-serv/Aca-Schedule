import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPreparedAutoScheduleJob } from '../../api/_lib/autoScheduleJob.js';

const version = value => ({ value, isEqual(other) { return value === other?.value; } });

const fakeDb = () => {
  const records = new Map([
    ['events', new Map([['event', { data: { ownerId: 'owner', customFields: {} }, version: version(1) }]])],
    ['timetables', new Map([['table', { data: { eventId: 'event', type: 'performance', dailyTimetables: [] }, version: version(2) }]])],
    ['bands', new Map([['band', { data: { eventId: 'event' }, version: version(3) }]])],
    ['autoScheduleJobs', new Map([['event', { data: {
      runId: 'run', status: 'prepared', userId: 'owner', userEmail: 'owner@example.com',
      type: 'performance', placed: 1, remaining: 0,
      prepared: {
        timetableId: 'table', dailyTimetables: [{ date: '2026-10-10', cools: [], entries: [] }], customFields: null,
        eventVersion: version(1), performanceVersion: version(2), rehearsalVersion: null,
        bandVersions: [{ id: 'band', version: version(3) }],
      },
    }, version: version(4) }]])],
  ]);
  const snapshot = (collection, id) => {
    const record = records.get(collection).get(id);
    return { id, exists: Boolean(record), data: () => record?.data, updateTime: record?.version };
  };
  const db = {
    collection(collection) {
      return {
        doc(id) { return { collection, id }; },
        where(field, _operator, value) { return { collection, field, value }; },
      };
    },
    async runTransaction(callback) {
      const writes = [];
      const result = await callback({
        async get(ref) {
          if (ref.field) {
            const docs = [...records.get(ref.collection).entries()]
              .filter(([, record]) => record.data[ref.field] === ref.value)
              .map(([id]) => snapshot(ref.collection, id));
            return { docs, size: docs.length };
          }
          return snapshot(ref.collection, ref.id);
        },
        update(ref, update) { writes.push({ ref, update }); },
      });
      for (const { ref, update } of writes) Object.assign(records.get(ref.collection).get(ref.id).data, update);
      return result;
    },
  };
  return { db, records };
};

test('prepared auto schedule applies the cached timetable without recomputing', async () => {
  const { db, records } = fakeDb();
  const result = await applyPreparedAutoScheduleJob(db, 'event', 'run', 'owner', 'owner@example.com');
  assert.equal(result.status, 'completed');
  assert.equal(records.get('timetables').get('table').data.dailyTimetables[0].date, '2026-10-10');
  assert.equal(records.get('autoScheduleJobs').get('event').data.prepared, null);
});

test('prepared auto schedule refuses a changed source timetable', async () => {
  const { db, records } = fakeDb();
  records.get('timetables').get('table').version = version(5);
  await assert.rejects(applyPreparedAutoScheduleJob(db, 'event', 'run', 'owner', 'owner@example.com'),
    error => error.code === 'PREVIEW_STALE');
  assert.deepEqual(records.get('timetables').get('table').data.dailyTimetables, []);
});

test('prepared auto schedule cannot be applied by another editor', async () => {
  const { db, records } = fakeDb();
  await assert.rejects(applyPreparedAutoScheduleJob(db, 'event', 'run', 'other', 'other@example.com'),
    error => error.code === 'FORBIDDEN');
  assert.deepEqual(records.get('timetables').get('table').data.dailyTimetables, []);
});
