import { forwardRef, useState, type InputHTMLAttributes } from 'react';
import { Icon } from './Icon';

type PasswordFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(function PasswordField(
  { className = '', ...props }, ref,
) {
  const [visible, setVisible] = useState(false);

  return <div className="relative">
    <input {...props} ref={ref} type={visible ? 'text' : 'password'} className={`${className} pr-11`} />
    <button
      type="button"
      onClick={() => setVisible(value => !value)}
      aria-label={visible ? 'パスワードを隠す' : 'パスワードを表示'}
      aria-pressed={visible}
      className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-gray-500 hover:text-gray-700"
    >
      <Icon name={visible ? 'visibility' : 'visibility_off'} className="text-xl" />
    </button>
  </div>;
});
