import test from 'node:test';
import assert from 'node:assert/strict';
import { createEventOnServer, deleteEventOnServer } from '../../api/_lib/eventManagement.js';

function fakeDb({ failCommit = false } = {}) {
  const records = new Map(['events', 'bands', 'timetables', 'viewerPasswords', 'stakeholderProgress', 'autoScheduleJobs'].map(name => [name, new Map()]));
  let nextId = 0;
  const ref = (collection, id) => ({
    collection, id,
    async get() {
      const data = records.get(collection).get(id);
      return { exists: !!data, data: () => data };
    },
  });
  const db = {
    collection(name) {
      return {
        doc(id = `new-${++nextId}`) { return ref(name, id); },
        where(_field, _operator, value) {
          return {
            async get() {
              const docs = [...records.get(name).entries()]
                .filter(([, data]) => data.eventId === value)
                .map(([id, data]) => ({ id, ref: ref(name, id), data: () => data }));
              return { docs, size: docs.length };
            },
          };
        },
      };
    },
    batch() {
      const writes = [];
      return {
        set(document, data) { writes.push({ action: 'set', document, data }); },
        delete(document) { writes.push({ action: 'delete', document }); },
        async commit() {
          if (failCommit) throw new Error('commit failed');
          for (const write of writes) {
            const collection = records.get(write.document.collection);
            if (write.action === 'delete') collection.delete(write.document.id);
            else collection.set(write.document.id, write.data);
          }
        },
      };
    },
  };
  return { db, records };
}

const input = {
  name: 'Live', year: 2026, venue: 'Hall', goal: 'Enjoy',
  performanceDates: ['2026-10-02'], rehearsalType: 'rehearsal-day',
  rehearsalDates: ['2026-10-01'], rehearsalDuration: 20,
  presetDurations: [10, 15], ownerId: 'spoofed', isPublic: true,
};

test('create saves the event and both initial timetables atomically under the authenticated owner', async () => {
  const { db, records } = fakeDb();
  const { eventId } = await createEventOnServer(db, input, 'owner');
  assert.equal(records.get('events').get(eventId).ownerId, 'owner');
  assert.equal(records.get('events').get(eventId).isPublic, false);
  const tables = [...records.get('timetables').values()].filter(table => table.eventId === eventId);
  assert.deepEqual(tables.map(table => table.type).sort(), ['performance', 'rehearsal']);
});

test('delete removes 80 bands, timetables, the event, and the viewer secret together', async () => {
  const { db, records } = fakeDb();
  records.get('events').set('source', { ownerId: 'owner' });
  records.get('viewerPasswords').set('source', { hash: 'secret' });
  for (let i = 0; i < 80; i++) records.get('bands').set(`band-${i}`, { eventId: 'source' });
  records.get('timetables').set('table', { eventId: 'source' });
  const result = await deleteEventOnServer(db, 'source', 'owner');
  assert.equal(result.bandCount, 80);
  assert.equal(records.get('events').size, 0);
  assert.equal(records.get('bands').size, 0);
  assert.equal(records.get('timetables').size, 0);
  assert.equal(records.get('viewerPasswords').size, 0);
});

test('a failed delete commit leaves all related documents intact', async () => {
  const { db, records } = fakeDb({ failCommit: true });
  records.get('events').set('source', { ownerId: 'owner' });
  records.get('bands').set('band', { eventId: 'source' });
  await assert.rejects(deleteEventOnServer(db, 'source', 'owner'), /commit failed/);
  assert.equal(records.get('events').size, 1);
  assert.equal(records.get('bands').size, 1);
});

test('another user cannot delete the event', async () => {
  const { db, records } = fakeDb();
  records.get('events').set('source', { ownerId: 'owner' });
  await assert.rejects(deleteEventOnServer(db, 'source', 'other'), error => error.code === 'FORBIDDEN');
  assert.equal(records.get('events').size, 1);
});
