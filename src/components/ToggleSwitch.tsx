interface ToggleSwitchProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  label?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}

export const ToggleSwitch = ({ enabled, onChange, label, icon, disabled = false }: ToggleSwitchProps) => {
  return (
    <label
      className={`flex items-center gap-2 select-none ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      {icon && <span className="text-gray-500">{icon}</span>}
      {label && <span className="text-sm text-gray-600 whitespace-nowrap">{label}</span>}
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        disabled={disabled}
        onClick={() => !disabled && onChange(!enabled)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-white ${
          enabled ? 'bg-emerald-500' : 'bg-gray-300'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transform transition-transform duration-200 ${
            enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
          }`}
        />
      </button>
    </label>
  );
};
