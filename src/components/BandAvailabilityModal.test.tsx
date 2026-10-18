import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Band, EventSettings, Timetable } from '../types';
import { BandAvailabilityModal } from './BandAvailabilityModal';

afterEach(cleanup);

it('grays out time outside the day, shows precise coverage, and closes a removed range editor', () => {
  const date = '2026-11-15';
  const band = {
    id: 'band', name: 'テストバンド', performanceDuration: 10, performanceCount: 1,
    toriPriority: 1, costume: false, bandMaster: '', members: [],
    availableTimeSlots: [{ date, timeRanges: [{ startTime: '10:07', endTime: '11:03' }] }],
    createdAt: new Date(), updatedAt: new Date(),
  } as Band;
  const settings = { id: 'event', performanceDates: [date], rehearsalType: 'none' } as EventSettings;
  const timetable: Timetable = {
    id: 'timetable', eventId: 'event', type: 'performance',
    dailyTimetables: [{ date, startTime: '10:00', endTime: '12:00', entries: [], cools: [] }],
    createdAt: new Date(), updatedAt: new Date(),
  };
  const onUpdate = vi.fn();

  render(<BandAvailabilityModal band={band} eventSettings={settings} performanceTimetable={timetable}
    rehearsalTimetable={null} onClose={() => {}} onUpdate={onUpdate} />);

  expect(screen.getByRole('button', { name: '09:45〜10:00 選択不可' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('button', { name: '12:00〜12:15 選択不可' }).hasAttribute('disabled')).toBe(true);

  const partialCell = screen.getByRole('button', { name: '10:00〜10:15 一部選択済み' });
  const fill = partialCell.querySelector('span[aria-hidden="true"]') as HTMLElement;
  expect(fill.style.left).toBe(`${(7 / 15) * 100}%`);
  expect(fill.style.width).toBe(`${(8 / 15) * 100}%`);

  fireEvent.click(screen.getByRole('button', { name: '10:07〜11:03を分単位で編集' }));
  expect(screen.getByText('時計の分針を動かすか、±1分ボタンで細かく調整できます。')).toBeTruthy();
  expect(screen.getByRole('button', { name: '10:07' })).toBeTruthy();

  fireEvent.keyDown(screen.getByRole('button', { name: '11:15〜11:30 未選択' }), { key: 'Enter' });
  expect(screen.getByText('時間帯を分単位で調整')).toBeTruthy();
  fireEvent.keyDown(partialCell, { key: 'Enter' });
  expect(screen.queryByText('時間帯を分単位で調整')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  expect(onUpdate.mock.calls[0][0][0].timeRanges).toEqual([
    { startTime: '10:15', endTime: '11:03' },
    { startTime: '11:15', endTime: '11:30' },
  ]);
});

it('rehearsal backup mode paints purple over normal time and the normal mode can paint back', () => {
  const date = '2026-11-14';
  const band = {
    id: 'band', name: 'テストバンド', performanceDuration: 10, performanceCount: 1,
    toriPriority: 1, costume: false, bandMaster: '', members: [],
    availableTimeSlots: [{ date, timeRanges: [{ startTime: '10:00', endTime: '10:30' }] }],
    backupRehearsalTimeSlots: [],
    createdAt: new Date(), updatedAt: new Date(),
  } as Band;
  const settings = { id: 'event', performanceDates: [], rehearsalType: 'rehearsal-day', rehearsalDates: [date] } as unknown as EventSettings;
  const rehearsal: Timetable = {
    id: 'rehearsal', eventId: 'event', type: 'rehearsal',
    dailyTimetables: [{ date, startTime: '10:00', endTime: '11:00', entries: [], cools: [] }],
    createdAt: new Date(), updatedAt: new Date(),
  };
  const onUpdate = vi.fn();
  const { container } = render(<BandAvailabilityModal band={band} eventSettings={settings} performanceTimetable={null}
    rehearsalTimetable={rehearsal} onClose={() => {}} onUpdate={onUpdate} />);
  const mode = container.querySelector('[role="switch"]') as HTMLElement;
  fireEvent.click(mode);
  expect(mode.getAttribute('aria-checked')).toBe('true');
  fireEvent.keyDown(container.querySelector('[data-availability-time="10:00"]') as HTMLElement, { key: 'Enter' });
  fireEvent.click([...container.querySelectorAll('button')].find(button => button.textContent === '保存') as HTMLElement);
  expect(onUpdate).toHaveBeenCalledWith(
    [{ date, timeRanges: [{ startTime: '10:15', endTime: '10:30' }] }],
    [{ date, timeRanges: [{ startTime: '10:00', endTime: '10:15' }] }],
  );
});

it('uses performance and rehearsal labels and each timetable’s time bounds for a member', () => {
  const date = '2026-11-15';
  const makeTimetable = (type: 'performance' | 'rehearsal', startTime: string, endTime: string) => ({
    id: type, eventId: 'event', type, createdAt: new Date(), updatedAt: new Date(),
    dailyTimetables: [{ date, startTime, endTime, entries: [], cools: [] }],
  }) as Timetable;
  render(<BandAvailabilityModal memberName="山田" memberTimeSlots={[]} dateTabs={[
    { date, type: 'performance' }, { date, type: 'rehearsal' },
  ]} performanceTimetable={makeTimetable('performance', '10:00', '12:00')}
    rehearsalTimetable={makeTimetable('rehearsal', '08:00', '09:00')}
    onClose={() => {}} onUpdateMember={() => {}} />);
  expect(screen.getByText('本番')).toBeTruthy();
  expect(screen.getByText('リハ')).toBeTruthy();
  expect(screen.getByRole('button', { name: '09:45〜10:00 選択不可' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByText('リハ'));
  expect(screen.queryByRole('switch', { name: '予備出演可能時間の入力モード' })).toBeNull();
  expect(screen.queryByText('予備出演可能時間（紫）')).toBeNull();
  expect(screen.getByRole('button', { name: '08:00〜08:15 未選択' }).hasAttribute('disabled')).toBe(false);
  expect(screen.getByRole('button', { name: '09:00〜09:15 選択不可' }).hasAttribute('disabled')).toBe(true);
});
