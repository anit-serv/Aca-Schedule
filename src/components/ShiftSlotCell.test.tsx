import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ShiftSlotCell } from './ShiftSlotCell';
import type { Band, CustomColumn } from '../types';

afterEach(cleanup);

it('枠内の出演メンバーを担当候補から除き、配置変更後の重複を警告する', () => {
  const column: CustomColumn = { id: 'shift', name: '受付', bindingType: 'sequence', order: 0,
    shift: { candidates: ['山田', '佐藤'], split: { mode: 'per-cool', value: 1 }, slotsByDate: {} } };
  const band = { id: 'band', members: ['山田'] } as Band;
  const onAction = vi.fn();
  render(<ShiftSlotCell column={column} slot={{ id: 'slot', size: 1, assignee: '山田' }} slotIndex={0}
    slots={[{ id: 'slot', size: 1, assignee: '山田' }]} entries={[{ type: 'band', bandId: 'band' }]}
    bands={[band]} readOnly={false} onAction={onAction} />);
  expect(screen.getByTitle('この枠の出演メンバーと担当者が重複しています')).toBeTruthy();
  expect(screen.getByTitle('この枠の出演メンバーと担当者が重複しています').className).toContain('h-full');
  fireEvent.click(screen.getByTitle('この枠の出演メンバーと担当者が重複しています'));
  expect(within(screen.getByRole('dialog')).queryByRole('button', { name: '山田' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '佐藤' }));
  expect(onAction).toHaveBeenCalledWith({ type: 'assign', index: 0, assignee: '佐藤' });
});

it('一部重なる他列の担当者を候補から除く', () => {
  const column: CustomColumn = { id: 'shift', name: '受付', bindingType: 'sequence', order: 0,
    shift: { candidates: ['山田', '佐藤'], split: { mode: 'per-cool', value: 1 }, slotsByDate: {} } };
  render(<ShiftSlotCell column={column} slot={{ id: 'slot', size: 2, assignee: '山田' }} slotIndex={0}
    slots={[{ id: 'slot', size: 2, assignee: '山田' }]} entries={[{ type: 'custom' }, { type: 'custom' }]}
    bands={[]} otherAssignments={['山田']} readOnly={false} onAction={vi.fn()} />);
  fireEvent.click(screen.getByTitle('重なる枠の他のシフト列と担当者が重複しています'));
  expect(within(screen.getByRole('dialog')).queryByRole('button', { name: '山田' })).toBeNull();
  expect(screen.getByRole('button', { name: '佐藤' })).toBeTruthy();
  expect(screen.getByText('現在の担当者は重なる枠の他のシフト列にも割り当てられています。')).toBeTruthy();
});

it('枠の境界をドラッグして隣の枠との行数を変更する', () => {
  const column: CustomColumn = { id: 'shift', name: '受付', bindingType: 'sequence', order: 0,
    shift: { candidates: ['山田'], split: { mode: 'per-cool', value: 2 }, slotsByDate: {} } };
  const slots = [{ id: 'first', size: 2 }, { id: 'second', size: 2 }];
  const onAction = vi.fn();
  const { container } = render(<table><tbody>
    <tr data-entry-id="one"><td rowSpan={2} className="relative"><ShiftSlotCell column={column} slot={slots[0]} slotIndex={0}
      slots={slots} entries={[{ type: 'custom' }, { type: 'custom' }]} bands={[]} readOnly={false} onAction={onAction} /></td><td>1</td></tr>
    <tr data-entry-id="two"><td>2</td></tr>
    <tr data-entry-id="three"><td rowSpan={2}>次の枠</td><td>3</td></tr>
    <tr data-entry-id="four"><td>4</td></tr>
  </tbody></table>);
  container.querySelectorAll('tr[data-entry-id]').forEach((row, index) => {
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ bottom: (index + 1) * 20 } as DOMRect);
  });
  const cell = container.querySelector('td[rowspan]')!;
  vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue({ left: 10, width: 140 } as DOMRect);
  const handle = screen.getByRole('separator', { name: '受付の枠の境界を移動' });
  fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientY: 40 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientY: 60 });
  fireEvent.pointerUp(handle, { pointerId: 1, clientY: 60 });
  expect(onAction).toHaveBeenCalledWith({ type: 'boundary-move', index: 0, delta: 1 });
  expect(screen.queryByRole('dialog')).toBeNull();
});
