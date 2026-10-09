import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Band, EventSettings, Timetable } from '../types';
import { StakeholderProgressPage } from './StakeholderProgressPage';

const { read, apply } = vi.hoisted(() => ({ read: vi.fn(), apply: vi.fn() }));
vi.mock('../services/stakeholderProgress', () => ({
  progressKey: (type: string, date: string, entryId: string) => `${type}|${date}|${entryId}`,
  stakeholderProgressService: { read, apply },
}));

afterEach(() => { cleanup(); read.mockReset(); apply.mockReset(); });

it('does not require a record when on time, then previews and applies an offset', async () => {
  read.mockResolvedValue({ version: 0, records: {}, history: [] });
  apply.mockResolvedValue({ version: 1, records: { 'performance|2026-11-15|one': { actualStart: '10:05' } }, history: [] });
  const settings = {
    id: 'event', name: 'イベント', venue: '会場', performanceDates: ['2026-11-15'], rehearsalType: 'none',
  } as EventSettings;
  const timetable = {
    id: 'table', eventId: 'event', type: 'performance', dailyTimetables: [
      { date: '2026-11-14', startTime: '10:00', entries: [], cools: [{ id: 'earlier', number: 1, startTime: '10:00', entries: [{ id: 'earlier-band', type: 'band', bandId: 'earlier-band', order: 0 }] }] },
      { date: '2026-11-15', startTime: '10:00', entries: [], cools: [
      { id: 'cool', number: 1, startTime: '10:00', entries: [
        { id: 'one', type: 'band', bandId: 'one', order: 0, startTime: '10:00', endTime: '10:10' },
        { id: 'two', type: 'band', bandId: 'two', order: 1, startTime: '10:15', endTime: '10:25' },
      ] },
    ] }], createdAt: new Date(), updatedAt: new Date(),
  } as Timetable;
  const bands = [{ id: 'one', name: '一組目', performanceDuration: 10 }, { id: 'two', name: '二組目', performanceDuration: 10 }] as Band[];
  render(<StakeholderProgressPage eventId="event" password="secret" settings={settings} bands={bands} performanceTimetable={timetable} rehearsalTimetable={null} />);
  expect(screen.getByRole('row', { name: /一組目/ }).querySelector('td')?.textContent).toBe('2');
  expect(screen.getByRole('row', { name: /二組目/ }).querySelector('td')?.textContent).toBe('3');
  await waitFor(() => expect(screen.getAllByRole('button', { name: /影響を確認する/ })[0].hasAttribute('disabled')).toBe(false));
  expect(screen.queryByText('未記録')).toBeNull();
  expect(screen.queryByLabelText('開始実績の記録候補')).toBeNull();
  fireEvent.click(screen.getAllByRole('button', { name: /影響を確認する/ })[0]);
  expect(screen.getAllByText(/見込みが変わらない場合、入力は不要です/).length).toBeGreaterThan(0);
  expect(apply).not.toHaveBeenCalled();
  fireEvent.change(screen.getAllByRole('spinbutton', { name: '予定からのずれ（分）' })[0], { target: { value: '5' } });
  fireEvent.click(screen.getAllByRole('button', { name: /影響を確認する/ })[0]);
  expect(apply).not.toHaveBeenCalled();
  expect(screen.getAllByText(/10:20/).length).toBeGreaterThan(0);
  fireEvent.click(screen.getAllByRole('button', { name: /この内容を適用/ })[0]);
  await waitFor(() => expect(apply).toHaveBeenCalledWith(expect.objectContaining({ entryId: 'one', actualTime: '10:05', expectedVersion: 0 })));
});

it('shows the transition-time limit before reviewing an early start', async () => {
  read.mockResolvedValue({ version: 0, records: {}, history: [] });
  const date = '2026-11-15';
  const settings = { id: 'event', name: 'イベント', venue: '会場', performanceDates: [date], rehearsalType: 'none' } as EventSettings;
  const timetable = { id: 'table', eventId: 'event', type: 'performance', dailyTimetables: [
    { date, startTime: '10:00', entries: [], cools: [{ id: 'cool', number: 1, startTime: '10:00', entries: [
      { id: 'one', type: 'band', bandId: 'one', order: 0, startTime: '10:00', endTime: '10:10' },
    ] }] },
  ], createdAt: new Date(), updatedAt: new Date() } as Timetable;
  const bands = [{ id: 'one', name: '一組目', performanceDuration: 10 }] as Band[];
  render(<StakeholderProgressPage eventId="event" password="secret" settings={settings} bands={bands} performanceTimetable={timetable} rehearsalTimetable={null} />);
  await waitFor(() => expect(screen.getAllByRole('button', { name: /影響を確認する/ })[0].hasAttribute('disabled')).toBe(false));
  fireEvent.change(screen.getAllByRole('combobox', { name: 'ずれの方向' })[0], { target: { value: 'early' } });
  fireEvent.change(screen.getAllByRole('spinbutton', { name: '予定からのずれ（分）' })[0], { target: { value: '1' } });
  fireEvent.click(screen.getAllByRole('button', { name: /影響を確認する/ })[0]);
  expect(screen.getAllByRole('alert')[0].textContent).toContain('最大0分');
  expect(apply).not.toHaveBeenCalled();
});

it('prefills the current offset separately for start and end when editing again', async () => {
  const date = '2026-11-15';
  read.mockResolvedValue({ version: 2, records: {
    [`performance|${date}|one`]: { actualStart: '10:05', actualEnd: '10:08' },
  }, history: [] });
  const settings = { id: 'event', name: 'イベント', venue: '会場', performanceDates: [date], rehearsalType: 'none' } as EventSettings;
  const timetable = { id: 'table', eventId: 'event', type: 'performance', dailyTimetables: [
    { date, startTime: '10:00', entries: [], cools: [{ id: 'cool', number: 1, startTime: '10:00', entries: [
      { id: 'one', type: 'band', bandId: 'one', order: 0, startTime: '10:00', endTime: '10:10' },
    ] }] },
  ], createdAt: new Date(), updatedAt: new Date() } as Timetable;
  const bands = [{ id: 'one', name: '一組目', performanceDuration: 10 }] as Band[];
  render(<StakeholderProgressPage eventId="event" password="secret" settings={settings} bands={bands} performanceTimetable={timetable} rehearsalTimetable={null} />);
  const offset = () => screen.getAllByRole('spinbutton', { name: '予定からのずれ（分）' })[0] as HTMLInputElement;
  const direction = () => screen.getAllByRole('combobox', { name: 'ずれの方向' })[0] as HTMLSelectElement;
  await waitFor(() => expect(offset().value).toBe('5'));
  expect(direction().value).toBe('late');
  fireEvent.click(screen.getAllByRole('button', { name: '終了時刻のずれ' })[0]);
  expect(offset().value).toBe('2');
  expect(direction().value).toBe('early');
  fireEvent.change(offset(), { target: { value: '4' } });
  fireEvent.click(screen.getAllByRole('button', { name: '開始時刻のずれ' })[0]);
  expect(offset().value).toBe('5');
  expect(direction().value).toBe('late');
});
