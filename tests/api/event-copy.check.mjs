import test from 'node:test';
import assert from 'node:assert/strict';
import { copyEventOnServer } from '../../api/_lib/eventCopy.js';

function fakeDb({ failCommit = false } = {}) {
  const records = new Map(['events', 'bands', 'timetables'].map(name => [name, new Map()]));
  let nextId = 0;
  const ref = (name, id) => ({
    id,
    collection: name,
    async get() {
      const data = records.get(name).get(id);
      return { id, exists: !!data, data: () => data };
    },
  });
  const db = {
    collection(name) {
      return {
        doc(id = `new-${++nextId}`) { return ref(name, id); },
        where(field, operator, value) {
          assert.equal(field, 'eventId');
          assert.equal(operator, '==');
          return {
            async get() {
              const docs = [...records.get(name).entries()]
                .filter(([, data]) => data.eventId === value)
                .map(([id, data]) => ({ id, data: () => data }));
              return { docs, size: docs.length };
            },
          };
        },
      };
    },
    batch() {
      const writes = [];
      return {
        set(document, data) { writes.push({ document, data }); },
        async commit() {
          if (failCommit) throw new Error('commit failed');
          for (const { document, data } of writes) {
            records.get(document.collection).set(document.id, data);
          }
        },
      };
    },
  };
  return { db, records };
}

test('server copy atomically writes all 80 bands and both timetables', async () => {
  const { db, records } = fakeDb();
  records.get('events').set('source', {
    name: 'Live', ownerId: 'owner', isPublic: true,
    collaboratorEmails: ['guest@example.com'],
    customFields: { performance: { columns: [{ id: 'memo' }], dailyData: {} } },
    customEvents: [{ id: 'break', name: '休憩', duration: 10 }],
    accessToken: 'source-secret', apiKey: 'source-api-key', viewerPasswordHash: 'source-password',
  });
  for (let index = 0; index < 80; index++) {
    records.get('bands').set(`band-${index}`, {
      eventId: 'source', name: `Band ${index}`, members: ['member'],
      toriPriority: 2, costume: true, bandMaster: 'leader',
    });
  }
  for (const type of ['performance', 'rehearsal']) {
    records.get('timetables').set(type, {
      eventId: 'source', type,
      dailyTimetables: [{ date: '2026-10-02', startTime: '10:00', entries: [], cools: [{
        id: 'cool', number: 1, startTime: '11:00', entries: [
          { id: `${type}-entry`, type: 'band', bandId: 'band-79', order: 0 },
          { id: `${type}-break`, type: 'custom', customEvent: { id: 'break', name: '休憩', duration: 10 }, order: 1 },
        ],
      }] }],
    });
  }

  const result = await copyEventOnServer(db, 'source', 'owner');
  assert.equal(result.bandCount, 80);
  assert.equal(result.timetableCount, 2);
  const bands = [...records.get('bands')].filter(([, band]) => band.eventId === result.eventId);
  assert.equal(bands.length, 80);
  const copiedBandId = bands.find(([, band]) => band.name === 'Band 79')[0];
  const event = records.get('events').get(result.eventId);
  assert.deepEqual(event.customEvents, [{ id: 'break', name: '休憩', duration: 10 }]);
  assert.deepEqual(event.customFields.performance.columns, [{ id: 'memo' }]);
  assert.deepEqual(event.collaboratorEmails, []);
  assert.equal(event.isPublic, false);
  assert.equal(event.accessToken, undefined);
  assert.equal(event.apiKey, undefined);
  assert.equal(event.viewerPasswordHash, undefined);
  const timetables = [...records.get('timetables').values()].filter(table => table.eventId === result.eventId);
  assert.equal(timetables.length, 2);
  for (const timetable of timetables) {
    assert.equal(timetable.dailyTimetables[0].cools[0].startTime, '11:00');
    assert.equal(timetable.dailyTimetables[0].cools[0].entries[0].bandId, copiedBandId);
    assert.equal(timetable.dailyTimetables[0].cools[0].entries[1].customEvent.name, '休憩');
  }
});

test('failed commit leaves no partial event or bands', async () => {
  const { db, records } = fakeDb({ failCommit: true });
  records.get('events').set('source', { name: 'Live', ownerId: 'owner' });
  for (let index = 0; index < 80; index++) records.get('bands').set(`band-${index}`, { eventId: 'source' });
  await assert.rejects(copyEventOnServer(db, 'source', 'owner'), /commit failed/);
  assert.equal(records.get('events').size, 1);
  assert.equal(records.get('bands').size, 80);
});

test('non-owners cannot copy an event', async () => {
  const { db, records } = fakeDb();
  records.get('events').set('source', { name: 'Live', ownerId: 'owner' });
  await assert.rejects(copyEventOnServer(db, 'source', 'other-user'), error => error.code === 'FORBIDDEN');
  assert.equal(records.get('events').size, 1);
});
