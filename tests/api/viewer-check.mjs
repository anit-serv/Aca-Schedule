import test from 'node:test';
import assert from 'node:assert/strict';
import { hashViewerPassword, projectViewerData, verifyViewerPassword } from '../../api/_lib/viewer.js';

const eventId = 'event-1';
const date = '2026-10-02';
const settings = {
  name: 'イベント', year: 2026, venue: '会場', isPublic: true,
  ownerId: 'private-owner', collaboratorEmails: ['private@example.com'],
  performanceDates: [date], rehearsalType: 'none',
  customFields: {
    performance: {
      columns: [
        { id: 'visible', name: '公開', bindingType: 'sequence', order: 0, isPublic: true,
          shift: { candidates: ['非公開の候補'], split: { mode: 'per-cool', value: 1 }, slotsByDate: { [date]: { cool: [{ id: 'slot', size: 1, assignee: '担当者' }] } } } },
        { id: 'hidden', name: '非公開', bindingType: 'sequence', order: 1 },
      ],
      dailyData: { [date]: { bySequence: { 1: { visible: { value: '表' }, hidden: { value: '秘密' } } }, byEntity: {} } },
    },
    rehearsal: { columns: [], dailyData: {} },
  },
};
const bands = [{ id: 'band-1', name: 'バンド', members: ['秘密のメンバー'], availableTimeSlots: [{ date }], performanceDuration: 10 }];

test('public response contains only explicitly public custom columns and no private band data', () => {
  const result = projectViewerData(eventId, settings, bands, [
    { id: 'performance', type: 'performance', dailyTimetables: [] },
    { id: 'rehearsal', type: 'rehearsal', dailyTimetables: [] },
  ], 'public');
  assert.deepEqual(result.settings.customFields.performance.columns.map(column => column.id), ['visible']);
  assert.deepEqual(result.settings.customFields.performance.columns[0].shift.candidates, []);
  assert.equal(result.settings.customFields.performance.columns[0].shift.slotsByDate[date].cool[0].assignee, '担当者');
  assert.deepEqual(result.settings.customFields.performance.dailyData[date].bySequence['1'], { visible: { value: '表' } });
  assert.deepEqual(result.bands[0].members, []);
  assert.deepEqual(result.bands[0].availableTimeSlots, []);
  assert.equal('ownerId' in result.settings, false);
  assert.equal('collaboratorEmails' in result.settings, false);
  assert.deepEqual(result.timetables.map(timetable => timetable.type), ['performance']);
});

test('stakeholder response contains all custom columns after password verification', async () => {
  const secret = await hashViewerPassword('correct horse battery staple');
  assert.equal(await verifyViewerPassword('wrong', secret), false);
  assert.equal(await verifyViewerPassword('correct horse battery staple', secret), true);
  const result = projectViewerData(eventId, settings, bands, [], 'stakeholder');
  assert.deepEqual(result.settings.customFields.performance.columns.map(column => column.id), ['visible', 'hidden']);
  assert.equal(result.settings.customFields.performance.dailyData[date].bySequence['1'].hidden.value, '秘密');
});

test('public response includes only performance progress for published entries', () => {
  const result = projectViewerData(eventId, settings, bands, [{ id: 'performance', type: 'performance', dailyTimetables: [
    { date, cools: [{ id: 'cool', entries: [{ id: 'entry' }] }] },
  ] }], 'public', { version: 2, history: [{ secret: 'private' }], records: {
    [`performance|${date}|entry`]: { actualStart: '10:05', actualEnd: '10:15', privateNote: 'secret' },
    [`rehearsal|${date}|entry`]: { actualStart: '09:05' },
    [`performance|${date}|missing`]: { actualStart: '10:20' },
  } });
  assert.deepEqual(result.progressRecords, { [`performance|${date}|entry`]: { actualStart: '10:05', actualEnd: '10:15' } });
  assert.equal('history' in result, false);
});
