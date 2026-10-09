import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import type { DailyTimetable, CustomColumn } from '../types';
import { TimetableContent } from './TimetableContent';

afterEach(cleanup);
beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
});

it('keeps the same timetable row and cool controls when custom mode changes', () => {
  const day: DailyTimetable = {
    date: '2026-10-02',
    startTime: '10:00',
    entries: [],
    cools: [{
      id: 'cool-1',
      number: 1,
      startTime: '10:00',
      entries: [{ id: 'entry-1', type: 'custom', customEvent: { id: 'event-1', name: 'MC', duration: 5 }, order: 0, startTime: '10:00', endTime: '10:05' }],
    }, {
      id: 'cool-2', number: 2, entries: [],
    }],
  };
  const column: CustomColumn = { id: 'note', name: 'メモ', bindingType: 'entity', order: 0 };
  const onChange = vi.fn();
  const view = (customMode: boolean) => (
    <DndContext>
      <TimetableContent
        currentTimetable={day}
        bands={[]}
        overEntryId={null}
        violations={[{ id: 'warning-1', type: 'availability-exceeded', severity: 'high', entryId: 'entry-1', coolId: 'cool-1', date: '2026-10-02', message: '[本番] 出演可能時間外' }]}
        bandNumbers={new Map()}
        isReadOnly={customMode}
        timetableType="performance"
        rehearsalType="none"
        onRemoveEntry={onChange}
        onDeleteCool={onChange}
        onMoveCoolUp={onChange}
        onMoveCoolDown={onChange}
        onTransitionTimeChange={onChange}
        onCoolStartTimeChange={onChange}
        customMode={customMode}
        customColumns={[column]}
        renderCustomCell={(_, col) => <td key={col.id} data-testid="custom-cell">内容</td>}
      />
    </DndContext>
  );

  const { container, rerender } = render(view(false));
  const row = container.querySelector('tr[data-entry-id="entry-1"]');
  const coolHeader = container.querySelector('.cool-header-left');
  const startTimeControl = container.querySelector('.mode-cool-control:not(.mode-cool-menu)');
  const menuControl = container.querySelector('.mode-cool-menu');
  expect(row).not.toBeNull();
  expect(row?.className).toContain('bg-rose-100/80');
  expect(coolHeader).not.toBeNull();
  expect(startTimeControl).not.toBeNull();
  expect(menuControl).not.toBeNull();

  rerender(view(true));
  expect(container.querySelector('tr[data-entry-id="entry-1"]')).toBe(row);
  expect(container.querySelector('.cool-header-left')).toBe(coolHeader);
  expect(container.querySelector('.mode-cool-control:not(.mode-cool-menu)')).toBe(startTimeControl);
  expect(container.querySelector('.mode-cool-menu')).toBe(menuControl);
  expect(container.querySelector('[data-custom-mode="true"]')).not.toBeNull();
  expect(row?.className).not.toContain('bg-rose-100/80');
  expect(row?.querySelector('td')?.className).toContain('bg-rose-100/80');
  expect(container.querySelector('[data-testid="custom-cell"]')?.className).not.toContain('bg-rose-100/80');
});
