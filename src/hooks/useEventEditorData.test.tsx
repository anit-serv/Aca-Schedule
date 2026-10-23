import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useEventEditorData } from './useEventEditorData';

type ListenerError = (error: Error) => void;
let bandError: ListenerError | undefined;

vi.mock('../services/firestore', () => ({
  bandService: {
    subscribeToBands: vi.fn((_eventId: string, _onData: unknown, onError: ListenerError) => {
      bandError = onError;
      return () => {};
    }),
  },
  eventService: { subscribeToEvent: vi.fn(() => () => {}) },
  timetableService: { subscribeTimetable: vi.fn(() => () => {}) },
}));

afterEach(() => {
  vi.useRealTimers();
  bandError = undefined;
});

it('reports an unexpected band subscription failure instead of waiting indefinitely', () => {
  const { result } = renderHook(() => useEventEditorData('event-1'));
  act(() => bandError?.(Object.assign(new Error('offline'), { code: 'unavailable' })));
  expect(result.current.error).toBe('bands-error');
});

it('reports a timeout when the first Firestore snapshots never arrive', () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useEventEditorData('event-1'));
  act(() => vi.advanceTimersByTime(30_000));
  expect(result.current.error).toBe('timeout:イベント設定');
});
