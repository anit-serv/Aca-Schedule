import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DesktopClockTimePicker } from './DesktopClockTimePicker';

afterEach(cleanup);

it('shows the clock beside the trigger on its first visible frame', () => {
  render(<DesktopClockTimePicker value="10:00" onChange={vi.fn()} />);
  const trigger = screen.getByRole('button', { name: '10:00' });
  vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
    left: 200, top: 100, right: 288, bottom: 130, width: 88, height: 30,
    x: 200, y: 100, toJSON: () => ({}),
  });

  fireEvent.click(trigger);

  const popup = screen.getByRole('button', { name: 'キャンセル' }).closest('.fixed') as HTMLElement;
  expect(popup.style.left).toBe('200px');
  expect(popup.style.top).toBe('138px');
});
