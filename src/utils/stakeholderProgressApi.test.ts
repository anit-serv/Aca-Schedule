import { beforeEach, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  progress: undefined as undefined | { version: number; records: Record<string, unknown>; history: unknown[] },
  timetable: undefined as undefined | { type: string; dailyTimetables: unknown[] },
}));
vi.mock('../../api/_lib/rateLimit.js', () => ({ enforceRateLimit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../api/_lib/request.js', () => ({ generateRequestId: () => 'request', sha256Hex: () => 'hash' }));
vi.mock('../../api/_lib/viewer.js', () => ({ parseEventId: (value: string) => value, verifyViewerPassword: async (value: string) => value === 'secret' }));
vi.mock('../../api/_lib/firestoreAdmin.js', () => ({ getAdminDb: () => ({
  collection: (name: string) => ({
    doc: (id: string) => ({ name, id, get: async () => ({ exists: name === 'events' || name === 'viewerPasswords' || Boolean(database.progress), data: () => name === 'stakeholderProgress' ? database.progress : {} }) }),
    where: () => ({ get: async () => ({ docs: name === 'bands' ? [] : [{ data: () => database.timetable || ({ type: 'performance', dailyTimetables: [{ date: '2026-11-15', startTime: '10:00', cools: [{ id: 'cool', startTime: '10:00', entries: [{ id: 'entry', type: 'custom', customEvent: { id: 'entry', duration: 10 } }] }] }] }) }] }) }),
  }),
  runTransaction: async (callback: (transaction: { get: () => Promise<unknown>; set: (_ref: unknown, data: typeof database.progress) => void }) => Promise<unknown>) => callback({
    get: async () => ({ data: () => database.progress }),
    set: (_ref, data) => { database.progress = data; },
  }),
}) }));

// @ts-expect-error Server helper is plain JavaScript and has no type declarations.
import handler from '../../api/_lib/stakeholderProgress.js';

function response() {
  const result = { code: 0, body: null as unknown, setHeader: () => {}, status(code: number) { this.code = code; return this; }, json(body: unknown) { this.body = body; return this; } };
  return result;
}

beforeEach(() => { database.progress = undefined; database.timetable = undefined; });

it('requires the stakeholder password and saves one actual time with a version', async () => {
  const req = { method: 'POST', headers: {}, body: { action: 'apply', eventId: 'event', password: 'wrong', timetableType: 'performance', date: '2026-11-15', coolId: 'cool', entryId: 'entry', field: 'start', actualTime: '10:05', expectedVersion: 0 } };
  const denied = response();
  await handler(req, denied);
  expect(denied.code).toBe(401);

  const accepted = response();
  await handler({ ...req, body: { ...req.body, password: 'secret' } }, accepted);
  expect(accepted.code).toBe(200);
  expect(database.progress?.records['performance|2026-11-15|entry']).toEqual({ actualStart: '10:05' });
  expect(database.progress?.version).toBe(1);

  const stale = response();
  await handler({ ...req, body: { ...req.body, password: 'secret' } }, stale);
  expect(stale.code).toBe(409);
});

it('rejects an adjustment beyond the next cool without saving progress', async () => {
  database.timetable = { type: 'performance', dailyTimetables: [{ date: '2026-11-15', startTime: '10:00', cools: [
    { id: 'cool', startTime: '10:00', entries: [{ id: 'entry', type: 'custom', customEvent: { id: 'entry', duration: 10 }, startTime: '10:00', endTime: '10:10' }] },
    { id: 'next', startTime: '10:15', entries: [] },
  ] }] };
  const req = { method: 'POST', headers: {}, body: { action: 'apply', eventId: 'event', password: 'secret', timetableType: 'performance', date: '2026-11-15', coolId: 'cool', entryId: 'entry', field: 'end', actualTime: '10:15', expectedVersion: 0 } };
  const denied = response();
  await handler(req, denied);
  expect(denied.code).toBe(422);
  expect(denied.body).toMatchObject({ error: { code: 'COOL_BOUNDARY' } });
  expect(database.progress).toBeUndefined();
});
