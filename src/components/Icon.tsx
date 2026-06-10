interface IconProps {
  /** Material Symbols のアイコン名 (例: "arrow_back", "settings") */
  name: string;
  className?: string;
  filled?: boolean;
}

export const Icon = ({ name, className = '', filled = false }: IconProps) => (
  <span
    className={`material-symbols-outlined ${className}`}
    style={{ fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' 24` }}
    aria-hidden="true"
    translate="no"
  >
    {name}
  </span>
);
