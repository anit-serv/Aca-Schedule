import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAvailabilitySlots, validateBackupRehearsalContext, validateCreateBandPayload } from '../../api/_lib/validation.js';

const date = '2026-06-01';
const event = { rehearsalType: 'rehearsal-day', rehearsalDates: [date], performanceDates: [] };
const days = [{ date, startTime: '10:00', endTime: '18:00' }];
const normal = [{ date, timeRanges: [{ startTime: '12:00', endTime: '13:00' }] }];
const backup = (startTime, endTime, backupDate = date) => [{
  date: backupDate, timeRanges: [{ startTime, endTime }],
}];

test('accepts an optional priority-3 target date in the band API payload', () => {
  const payload = { eventId: 'event', name: 'headliner', performanceDuration: 10, toriPriority: 3,
    toriTargetDate: '2026-06-01' };
  assert.equal(validateCreateBandPayload(payload).toriTargetDate, '2026-06-01');
  assert.equal(validateCreateBandPayload({ ...payload, toriTargetDate: null }).toriTargetDate, null);
  assert.throws(() => validateCreateBandPayload({ ...payload, toriTargetDate: 'June 1' }),
    error => error.code === 'INVALID_FIELD' && error.details.some(detail => detail.field === 'toriTargetDate'));
});

test('accepts minute-precision backup slots adjacent to normal availability and within the rehearsal day', () => {
  const slots = backup('13:00', '13:07');
  assert.deepEqual(validateAvailabilitySlots(slots, 'backupRehearsalTimeSlots'), slots);
  assert.doesNotThrow(() => validateBackupRehearsalContext(slots, normal, event, days));
  assert.doesNotThrow(() => validateBackupRehearsalContext([], normal, event, days));
});

test('rejects backup time overlapping normal time', () => {
  assert.throws(() => validateBackupRehearsalContext(backup('12:59', '13:07'), normal, event, days),
    error => error.code === 'INVALID_FIELD' && error.details.some(detail => detail.message.includes('overlap')));
});

test('rejects backup time before the rehearsal start or after its end', () => {
  for (const slots of [backup('09:59', '10:15'), backup('17:45', '18:01')]) {
    assert.throws(() => validateBackupRehearsalContext(slots, normal, event, days),
      error => error.code === 'INVALID_FIELD' && error.details.some(detail => detail.message.includes('start and end')));
  }
});

test('rejects non-rehearsal dates and dates without a configured rehearsal timetable', () => {
  assert.throws(() => validateBackupRehearsalContext(backup('10:00', '10:15', '2026-06-02'), normal, event, days),
    error => error.code === 'INVALID_FIELD');
  assert.throws(() => validateBackupRehearsalContext(backup('10:00', '10:15'), normal, event, []),
    error => error.code === 'INVALID_FIELD');
});
