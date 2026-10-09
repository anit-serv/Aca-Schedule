import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Band, EventSettings, Timetable } from '../types';
import { useRehearsalSync } from './useRehearsalSync';

const { syncCoolPreRehearsal } = vi.hoisted(() => ({ syncCoolPreRehearsal: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../services/firestore', () => ({ timetableService: { syncCoolPreRehearsal } }));

afterEach(() => { cleanup(); syncCoolPreRehearsal.mockReset().mockResolvedValue(undefined); });

const date = '2026-11-15';
const bandEntry = (id: string, bandId: string, order: number) => ({ id, type: 'band' as const, bandId, order });
const timetable = (type: 'performance' | 'rehearsal', entries: ReturnType<typeof bandEntry>[]): Timetable => ({
  id: type, eventId: 'event', type, rehearsalInitialized: type === 'rehearsal',
  createdAt: new Date(), updatedAt: new Date(),
  dailyTimetables: [{ date, startTime: '10:00', entries: [], cools: [{ id: `${type}-cool`, number: 1, entries }] }],
});

it('別日リハのバンド追加や削除に反応して自動で配置しない', async () => {
  const performance = timetable('performance', []);
  const rehearsal = timetable('rehearsal', [bandEntry('r1', 'A', 0)]);
  const settings = { id: 'event', rehearsalType: 'rehearsal-day', rehearsalDates: [date] } as EventSettings;
  const props = {
    eventId: 'event', eventSettings: settings, bands: [{ id: 'A' } as Band],
    performanceTimetable: performance, rehearsalTimetable: rehearsal,
    hasCompletedInitialTimetableSync: true, setHasCompletedInitialTimetableSync: vi.fn(),
    isInitialTimetableSyncInFlightRef: { current: false },
  };
  const { rerender } = renderHook(value => useRehearsalSync(value), { initialProps: props });
  await act(async () => {
    rerender({ ...props, bands: [...props.bands, { id: 'B' } as Band],
      rehearsalTimetable: timetable('rehearsal', []) });
  });
  expect(syncCoolPreRehearsal).not.toHaveBeenCalled();
});

it('クール直前リハは保存時点の最新配置を使い、削除済みカードを戻さない', async () => {
  const performance = timetable('performance', [bandEntry('pa', 'A', 0), bandEntry('pb', 'B', 1)]);
  const staleRehearsal = timetable('rehearsal', [bandEntry('ra', 'A', 0), bandEntry('rb', 'B', 1)]);
  const latestRehearsal = timetable('rehearsal', [bandEntry('rb', 'B', 0)]);
  const settings = { id: 'event', rehearsalType: 'cool-pre-rehearsal', rehearsalDuration: 5 } as EventSettings;
  syncCoolPreRehearsal.mockImplementation(async (_performanceId, _rehearsalId, buildUpdates) => {
    const updates = buildUpdates(performance, latestRehearsal);
    expect(updates?.dailyTimetables?.[0].cools[0].entries.map((entry: { bandId: string }) => entry.bandId)).toEqual(['B']);
  });
  const props = {
    eventId: 'event', eventSettings: settings, bands: [] as Band[],
    performanceTimetable: performance, rehearsalTimetable: staleRehearsal,
    hasCompletedInitialTimetableSync: false, setHasCompletedInitialTimetableSync: vi.fn(),
    isInitialTimetableSyncInFlightRef: { current: false },
  };
  renderHook(value => useRehearsalSync(value), { initialProps: props });
  await waitFor(() => expect(syncCoolPreRehearsal).toHaveBeenCalledTimes(1));
});

it('空のクール直前リハに本番バンドを自動追加しない', async () => {
  const performance = timetable('performance', [bandEntry('pa', 'A', 0)]);
  const rehearsal = { ...timetable('rehearsal', []), rehearsalInitialized: false };
  const settings = { id: 'event', rehearsalType: 'cool-pre-rehearsal', rehearsalDuration: 5 } as EventSettings;
  syncCoolPreRehearsal.mockImplementation(async (_performanceId, _rehearsalId, buildUpdates) => {
    const updates = buildUpdates(performance, rehearsal);
    expect(updates?.dailyTimetables?.[0].cools[0].entries).toEqual([]);
  });
  renderHook(value => useRehearsalSync(value), { initialProps: {
    eventId: 'event', eventSettings: settings, bands: [] as Band[],
    performanceTimetable: performance, rehearsalTimetable: rehearsal,
    hasCompletedInitialTimetableSync: false, setHasCompletedInitialTimetableSync: vi.fn(),
    isInitialTimetableSyncInFlightRef: { current: false },
  } });
  await waitFor(() => expect(syncCoolPreRehearsal).toHaveBeenCalledTimes(1));
});
