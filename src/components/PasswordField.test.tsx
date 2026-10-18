import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { PasswordField } from './PasswordField';

afterEach(cleanup);

it('shows the icon for the current password visibility', () => {
  render(<PasswordField aria-label="パスワード" />);
  expect((screen.getByLabelText('パスワード') as HTMLInputElement).type).toBe('password');
  const toggle = screen.getByRole('button', { name: 'パスワードを表示' });
  expect(toggle.textContent).toContain('visibility_off');
  fireEvent.click(toggle);
  expect((screen.getByLabelText('パスワード') as HTMLInputElement).type).toBe('text');
  expect(screen.getByRole('button', { name: 'パスワードを隠す' }).textContent).toContain('visibility');
});
