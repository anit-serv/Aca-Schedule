import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { addColumn } from '../utils/customFieldsUtils';
import { CustomColumnManager } from './CustomColumnManager';
import type { Band, Timetable } from '../types';

afterEach(cleanup);

it('端の移動ボタンを無効にし、3点メニューから公開状態を反転する', () => {
  let fields = addColumn(undefined, 'performance', { id: 'a', name: '担当', bindingType: 'sequence' });
  fields = addColumn(fields, 'performance', { id: 'b', name: '音響', bindingType: 'sequence' });
  const onChange = vi.fn();
  render(<CustomColumnManager customFields={fields} timetableType="performance" onCustomFieldsChange={onChange} />);
  expect((screen.getByRole('button', { name: '担当を上へ移動' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '音響を下へ移動' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '担当の設定' }));
  fireEvent.mouseEnter(screen.getByRole('menuitem', { name: /一般公開/ }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'オンにする' }));
  expect(onChange.mock.calls[0][0].performance.columns[0].isPublic).toBe(true);
});

it('サブメニューをホバーした項目の高さに合わせる', () => {
  const fields = addColumn(undefined, 'performance', {
    id: 'shift', name: '音響', bindingType: 'sequence',
    shift: { candidates: ['山田'], split: { mode: 'per-cool', value: 1 }, slotsByDate: {} },
  });
  render(<CustomColumnManager customFields={fields} timetableType="performance" onCustomFieldsChange={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '音響の設定' }));
  const sharedItem = screen.getByRole('menuitem', { name: /本番・リハ共通/ });
  Object.defineProperty(sharedItem, 'offsetTop', { configurable: true, value: 124 });
  fireEvent.mouseEnter(sharedItem);
  expect((screen.getByRole('menu', { name: '本番・リハ共通の操作' }) as HTMLElement).style.top).toBe('124px');
  const visibilityItem = screen.getByRole('menuitem', { name: /一般公開/ });
  Object.defineProperty(visibilityItem, 'offsetTop', { configurable: true, value: 84 });
  fireEvent.mouseEnter(visibilityItem);
  expect((screen.getByRole('menu', { name: '一般公開の操作' }) as HTMLElement).style.top).toBe('84px');
});

it('同名の列がある場合は確認後に既存列を共通化する', () => {
  let fields = addColumn(undefined, 'performance', { id: 'p', name: '担当', bindingType: 'sequence' });
  fields = addColumn(fields, 'rehearsal', { id: 'r', name: '担当', bindingType: 'sequence' });
  const onChange = vi.fn();
  render(<CustomColumnManager customFields={fields} timetableType="performance" onCustomFieldsChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: '担当の設定' }));
  fireEvent.mouseEnter(screen.getByRole('menuitem', { name: /本番・リハ共通/ }));
  fireEvent.click(screen.getByRole('menuitem', { name: '共通にする' }));
  expect(screen.getByRole('dialog', { name: '同名の列を共通にしますか？' })).toBeTruthy();
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '共通列にする' }));
  const updated = onChange.mock.calls[0][0];
  expect(updated.performance.columns[0].sharedColumnId).toBe('r');
  expect(updated.rehearsal.columns[0].sharedColumnId).toBe('p');
  expect(updated.rehearsal.columns).toHaveLength(1);
});

it('列メニューから全クールにシフト枠を作成する', () => {
  const fields = addColumn(undefined, 'performance', { id: 'p', name: '受付', bindingType: 'sequence' });
  const timetable: Timetable = { id: 'timetable', eventId: 'event', type: 'performance', createdAt: new Date(), updatedAt: new Date(), dailyTimetables: [{ date: '2026-11-01', startTime: '10:00', entries: [], cools: [
    { id: 'first', number: 1, entries: Array.from({ length: 5 }, (_, index) => ({ id: `e${index}`, type: 'custom' as const, order: index })) },
    { id: 'second', number: 2, entries: [{ id: 'e5', type: 'custom' as const, order: 0 }] },
  ] }] };
  const bands = [
    { id: 'a', members: ['山田', '佐藤'] },
    { id: 'b', members: ['佐藤', '鈴木'] },
  ] as Band[];
  const onChange = vi.fn();
  render(<CustomColumnManager customFields={fields} timetableType="performance" timetable={timetable} bands={bands} onCustomFieldsChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: '受付の設定' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'シフトモードを作成' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '山田' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '佐藤' }));
  fireEvent.change(screen.getByPlaceholderText('名前を入力'), { target: { value: ' 田中 ' } });
  fireEvent.click(screen.getByRole('button', { name: '追加' }));
  fireEvent.click(screen.getByRole('button', { name: 'シフトを作成' }));
  const shift = onChange.mock.calls[0][0].performance.columns[0].shift;
  expect(shift.candidates).toEqual(['山田', '佐藤', '田中']);
  expect(shift.slotsByDate['2026-11-01'].first.map((slot: { size: number }) => slot.size)).toEqual([3, 2]);
  expect(shift.slotsByDate['2026-11-01'].second.map((slot: { size: number }) => slot.size)).toEqual([1]);
});
