import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Band, EventSettings } from '../types';
import { BandManagement } from './BandManagement';

vi.mock('../services/firestore', () => ({ bandService: {
  addBand: vi.fn(async () => {}), updateBand: vi.fn(async () => {}), deleteBand: vi.fn(async () => {}),
} }));
afterEach(cleanup);

it('selects a band from the sidebar and edits its details', async () => {
  const makeBand = (id: string, name: string): Band => ({
    id, name, performanceDuration: 5, performanceCount: 1, toriPriority: 1, costume: false,
    bandMaster: '', members: [], availableTimeSlots: [], backupRehearsalTimeSlots: [],
    createdAt: new Date(), updatedAt: new Date(),
  });
  const bands = [makeBand('a', '一組目'), makeBand('b', '二組目')];
  const settings = { id: 'event', presetDurations: [5, 10], performanceDates: [], rehearsalType: 'none' } as unknown as EventSettings;
  const onBandsChange = vi.fn();
  render(<BandManagement bands={bands} eventSettings={settings} performanceTimetable={null} rehearsalTimetable={null} onBandsChange={onBandsChange} />);
  fireEvent.click(screen.getByRole('button', { name: /二組目.*5分/ }));
  expect(screen.getByRole('button', { name: 'トリ優先度の説明' })).toBeTruthy();
  expect(screen.getByRole('tooltip').textContent).toContain('初期値は最終日');
  fireEvent.change(screen.getByRole('textbox', { name: 'バンドマスター' }), { target: { value: '山田' } });
  await waitFor(() => expect(onBandsChange).toHaveBeenCalled());
  expect(onBandsChange.mock.lastCall?.[0][1].bandMaster).toBe('山田');
  expect(onBandsChange.mock.lastCall?.[0][0].bandMaster).toBe('');
});

it('selects a performance date for priority 3 and defaults to the final date', async () => {
  const band = { id: 'headliner', name: 'トリ', members: [], performanceDuration: 5, performanceCount: 1,
    toriPriority: 3, costume: false, bandMaster: '', availableTimeSlots: [], createdAt: new Date(), updatedAt: new Date() } as Band;
  const settings = { id: 'event', presetDurations: [], performanceDates: ['2026-10-02', '2026-10-03'], rehearsalType: 'none' } as unknown as EventSettings;
  const onBandsChange = vi.fn();
  render(<BandManagement bands={[band]} eventSettings={settings} performanceTimetable={null} rehearsalTimetable={null} onBandsChange={onBandsChange} />);
  const select = screen.getByRole('combobox', { name: 'トリ優先度3の対象日' }) as HTMLSelectElement;
  expect(select.value).toBe('2026-10-03');
  fireEvent.change(select, { target: { value: '2026-10-02' } });
  await waitFor(() => expect(onBandsChange.mock.lastCall?.[0][0].toriTargetDate).toBe('2026-10-02'));
});

it('sets the final performance date when priority changes to 3', async () => {
  const band = { id: 'headliner', name: 'トリ', members: [], performanceDuration: 5, performanceCount: 1,
    toriPriority: 1, costume: false, bandMaster: '', availableTimeSlots: [], createdAt: new Date(), updatedAt: new Date() } as Band;
  const settings = { id: 'event', presetDurations: [], performanceDates: ['2026-10-02', '2026-10-03'], rehearsalType: 'none' } as unknown as EventSettings;
  const onBandsChange = vi.fn();
  render(<BandManagement bands={[band]} eventSettings={settings} performanceTimetable={null} rehearsalTimetable={null} onBandsChange={onBandsChange} />);
  fireEvent.change(screen.getByLabelText('トリ優先度'), { target: { value: '3' } });
  await waitFor(() => expect(onBandsChange.mock.lastCall?.[0][0]).toMatchObject({ toriPriority: 3, toriTargetDate: '2026-10-03' }));
});

it('shows matching member suggestions under the input and adds the selected member', async () => {
  const makeBand = (id: string, name: string, members: string[]): Band => ({
    id, name, members, performanceDuration: 5, performanceCount: 1, toriPriority: 1,
    costume: false, bandMaster: '', availableTimeSlots: [], createdAt: new Date(), updatedAt: new Date(),
  });
  const bands = [makeBand('a', '一組目', []), makeBand('b', '二組目', ['山田', '佐藤'])];
  const settings = { id: 'event', presetDurations: [5], performanceDates: [], rehearsalType: 'none' } as unknown as EventSettings;
  const onBandsChange = vi.fn();
  render(<BandManagement bands={bands} eventSettings={settings} performanceTimetable={null} rehearsalTimetable={null} onBandsChange={onBandsChange} />);
  fireEvent.change(screen.getByRole('combobox', { name: '追加するメンバー名' }), { target: { value: '山' } });
  expect(screen.getByRole('listbox', { name: 'メンバー候補' })).toBeTruthy();
  fireEvent.click(screen.getByRole('option', { name: '山田' }));
  await waitFor(() => expect(onBandsChange).toHaveBeenCalled());
  expect(onBandsChange.mock.lastCall?.[0][0].members).toEqual(['山田']);
  expect(screen.queryByRole('listbox', { name: 'メンバー候補' })).toBeNull();
});

it('edits the displayed band name directly', async () => {
  const band = { id: 'a', name: '旧バンド名', members: [], performanceDuration: 5, performanceCount: 1,
    toriPriority: 1, costume: false, bandMaster: '', availableTimeSlots: [], createdAt: new Date(), updatedAt: new Date() } as Band;
  const settings = { id: 'event', presetDurations: [], performanceDates: [], rehearsalType: 'none' } as unknown as EventSettings;
  const onBandsChange = vi.fn();
  render(<BandManagement bands={[band]} eventSettings={settings} performanceTimetable={null} rehearsalTimetable={null} onBandsChange={onBandsChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'バンド名を直接編集' }));
  const input = screen.getByRole('textbox', { name: '表示中のバンド名を編集' });
  fireEvent.change(input, { target: { value: '新バンド名' } });
  fireEvent.blur(input);
  await waitFor(() => expect(onBandsChange.mock.lastCall?.[0][0].name).toBe('新バンド名'));
});
