import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Band, CustomFieldsSettings, EventSettings, Timetable } from '../types';
import { addColumn, setColumnShared, setColumnShift } from '../utils/customFieldsUtils';
import { MemberManagement } from './MemberManagement';

afterEach(cleanup);

it('shows shared candidate columns once and saves a member’s availability and candidacy together', async () => {
  let fields = addColumn(undefined, 'performance', { id: 'p', name: '音響', bindingType: 'sequence' });
  fields = addColumn(fields, 'rehearsal', { id: 'r', name: '音響', bindingType: 'sequence' });
  fields = setColumnShared(fields, 'performance', 'p', true, 'r');
  fields = setColumnShift(fields, 'performance', 'p', {
    candidates: ['山田'], split: { mode: 'per-cool', value: 1 }, slotsByDate: {},
  });
  fields.shiftAvailability = { 佐藤: [] };
  const settings = { customFields: fields, performanceDates: ['2026-11-15'], rehearsalDates: [], rehearsalType: 'none' } as unknown as EventSettings;
  const timetable: Timetable = {
    id: 'performance', eventId: 'event', type: 'performance',
    dailyTimetables: [{ date: '2026-11-15', startTime: '10:00', endTime: '12:00', cools: [], entries: [] }],
    createdAt: new Date(), updatedAt: new Date(),
  };
  const bands = [{ id: 'band', members: ['山田', '佐藤'] }] as Band[];
  const onChange = vi.fn(async (fields: CustomFieldsSettings) => { void fields; });
  render(<MemberManagement eventSettings={settings} bands={bands} performanceTimetable={timetable}
    rehearsalTimetable={null} onCustomFieldsChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: /佐藤.*0回/ }));
  const column = screen.getByRole('checkbox', { name: '本番・リハ共通 · 音響' });
  expect((column as HTMLInputElement).checked).toBe(false);
  fireEvent.click(column);
  fireEvent.click(screen.getByRole('button', { name: '時間帯を編集' }));
  expect(screen.getByText('担当可能時間帯設定: 佐藤')).toBeTruthy();
  expect(screen.getByText('本番')).toBeTruthy();
  expect((screen.getByRole('button', { name: '09:45〜10:00 選択不可' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '12:00〜12:15 選択不可' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.mouseDown(screen.getByRole('button', { name: '10:00〜10:15 未選択' }));
  fireEvent.mouseUp(window);
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  fireEvent.click(screen.getByRole('button', { name: '変更を保存' }));
  await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  const updated = onChange.mock.calls[0][0];
  expect(updated.performance.columns[0].shift?.candidates).toContain('佐藤');
  expect(updated.rehearsal.columns[0].shift?.candidates).toContain('佐藤');
  expect(updated.shiftAvailability?.['佐藤'][0].timeRanges).toEqual([{ startTime: '10:00', endTime: '10:15' }]);
});

it('adds a member without a band or candidate column and persists the roster', async () => {
  const settings = { customFields: { performance: { columns: [], dailyData: {} }, rehearsal: { columns: [], dailyData: {} } },
    performanceDates: [], rehearsalDates: [], rehearsalType: 'none' } as unknown as EventSettings;
  const onChange = vi.fn(async (fields: CustomFieldsSettings) => { void fields; });
  const { rerender } = render(<MemberManagement eventSettings={settings} bands={[]} performanceTimetable={null}
    rehearsalTimetable={null} onCustomFieldsChange={onChange} />);
  fireEvent.change(screen.getByPlaceholderText('名前を入力'), { target: { value: ' 新メンバー ' } });
  fireEvent.click(screen.getByRole('button', { name: '追加' }));
  await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  expect(onChange.mock.calls[0][0].members).toEqual(['新メンバー']);
  rerender(<MemberManagement eventSettings={{ ...settings, customFields: onChange.mock.calls[0][0] }} bands={[]}
    performanceTimetable={null} rehearsalTimetable={null} onCustomFieldsChange={onChange} />);
  expect(screen.getByRole('button', { name: /新メンバー.*0回/ })).toBeTruthy();
  expect(screen.getByText('登録メンバー')).toBeTruthy();
});
