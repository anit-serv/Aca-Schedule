import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface DesktopClockTimePickerProps {
  id?: string;
  value?: string;
  onChange: (value: string | undefined) => void;
  disabled?: boolean;
  allowClear?: boolean;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
}

const parseTime = (time?: string): { hour: number; minute: number } | null => {
  if (!time) return null;
  const [h, m] = time.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { hour: h, minute: m };
};

const formatTime = (hour: number, minute: number) => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

const angleFromIndex = (index: number, total: number) => (Math.PI * 2 * index) / total;

const normalizeTopClockAngle = (radians: number) => {
  let angle = radians;
  while (angle < 0) angle += Math.PI * 2;
  while (angle >= Math.PI * 2) angle -= Math.PI * 2;
  return angle;
};

const clockAngleFromPoint = (x: number, y: number, centerX: number, centerY: number) => {
  const dx = x - centerX;
  const dy = y - centerY;
  const base = Math.atan2(dy, dx);
  // 12時方向を0にし、時計回りで増加
  return normalizeTopClockAngle(base + Math.PI / 2);
};

const handStyleFromAngle = (angle: number, length: number) => ({
  width: `${length}px`,
  transform: `translateY(-50%) rotate(${(angle * 180) / Math.PI - 90}deg)`,
});

const OUTER_HOURS = [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0];
const INNER_HOURS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const MINUTE_TICKS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

const polarStyle = (index: number, total: number, radius: number) => {
  const angle = (Math.PI * 2 * index) / total - Math.PI / 2;
  const x = Math.cos(angle) * radius;
  const y = Math.sin(angle) * radius;

  return {
    left: `calc(50% + ${x}px)`,
    top: `calc(50% + ${y}px)`,
  };
};

export const DesktopClockTimePicker = ({
  id,
  value,
  onChange,
  disabled = false,
  allowClear = false,
  placeholder = '--:--',
  className = '',
  inputClassName = '',
}: DesktopClockTimePickerProps) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const hourFaceRef = useRef<HTMLDivElement>(null);
  const minuteFaceRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<'hour' | 'minute'>('hour');
  const [dragMode, setDragMode] = useState<'hour' | 'minute' | null>(null);
  const [popupStyle, setPopupStyle] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const parsed = useMemo(() => parseTime(value), [value]);

  const now = new Date();
  const [draftHour, setDraftHour] = useState<number>(parsed?.hour ?? now.getHours());
  const [draftMinute, setDraftMinute] = useState<number>(parsed?.minute ?? now.getMinutes());

  useEffect(() => {
    if (!isOpen) {
      setDraftHour(parsed?.hour ?? now.getHours());
      setDraftMinute(parsed?.minute ?? now.getMinutes());
      setStep('hour');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed?.hour, parsed?.minute, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const updatePopupPosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      const popupWidth = 280;
      const popupHeight = 360;
      const margin = 8;

      let left = rect.left;
      if (left + popupWidth > window.innerWidth - margin) {
        left = window.innerWidth - popupWidth - margin;
      }
      if (left < margin) left = margin;

      let top = rect.bottom + margin;
      if (top + popupHeight > window.innerHeight - margin) {
        top = rect.top - popupHeight - margin;
      }
      if (top < margin) top = margin;

      setPopupStyle({ top, left });
    };

    updatePopupPosition();

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(target) &&
        popupRef.current &&
        !popupRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    const handleReposition = () => updatePopupPosition();

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [isOpen]);

  const displayValue = parsed ? formatTime(parsed.hour, parsed.minute) : placeholder;

  const hourSelection = useMemo(() => {
    if (draftHour === 0 || draftHour >= 13) {
      const index = draftHour === 0 ? 11 : draftHour - 13;
      return { index, radius: 92 };
    }

    const index = Math.max(0, Math.min(11, draftHour - 1));
    return { index, radius: 58 };
  }, [draftHour]);

  const hourHandAngle = angleFromIndex(hourSelection.index, 12);
  const minuteHandAngle = angleFromIndex(draftMinute, 60);

  const updateHourFromPoint = useCallback((clientX: number, clientY: number) => {
    const face = hourFaceRef.current;
    if (!face) return;
    const rect = face.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const angle = clockAngleFromPoint(clientX, clientY, centerX, centerY);
    const index = Math.round((angle / (Math.PI * 2)) * 12) % 12;
    const dx = clientX - centerX;
    const dy = clientY - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > 75) {
      setDraftHour(OUTER_HOURS[index]);
    } else {
      setDraftHour(INNER_HOURS[index] % 24);
    }
  }, []);

  const updateMinuteFromPoint = useCallback((clientX: number, clientY: number) => {
    const face = minuteFaceRef.current;
    if (!face) return;
    const rect = face.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const angle = clockAngleFromPoint(clientX, clientY, centerX, centerY);
    const minute = Math.round((angle / (Math.PI * 2)) * 60) % 60;
    setDraftMinute(minute);
  }, []);

  useEffect(() => {
    if (!dragMode) return;

    const onMove = (event: PointerEvent) => {
      if (dragMode === 'hour') {
        updateHourFromPoint(event.clientX, event.clientY);
      } else {
        updateMinuteFromPoint(event.clientX, event.clientY);
      }
    };

    const onUp = () => {
      if (dragMode === 'hour') {
        setStep('minute');
      }
      setDragMode(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragMode, updateHourFromPoint, updateMinuteFromPoint]);

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <div className="flex items-center gap-1">
        <button
          id={id}
          ref={triggerRef}
          type="button"
          disabled={disabled}
          onClick={() => setIsOpen((v) => !v)}
          className={inputClassName || `px-3 py-1.5 bg-white border border-gray-300 rounded text-sm text-gray-900 min-w-[88px] text-left ${
            disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-emerald-400'
          }`}
        >
          {displayValue}
        </button>

        {allowClear && value && !disabled && (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="text-gray-500 hover:text-gray-900 px-1 transition-colors"
            title="時刻をクリア"
          >
            ✕
          </button>
        )}
      </div>

      {isOpen && !disabled && typeof document !== 'undefined' && createPortal(
        <div
          ref={popupRef}
          className="fixed z-[120] w-[280px] rounded-xl border border-gray-200 bg-white shadow-2xl p-3"
          style={{ top: popupStyle.top, left: popupStyle.left }}
        >
          <div className="mb-3 flex items-center justify-center gap-2 text-2xl font-semibold text-gray-800">
            <button
              type="button"
              onClick={() => setStep('hour')}
              className={`${step === 'hour' ? 'text-emerald-600' : 'text-gray-400'}`}
            >
              {String(draftHour).padStart(2, '0')}
            </button>
            <span className="text-gray-400">:</span>
            <button
              type="button"
              onClick={() => setStep('minute')}
              className={`${step === 'minute' ? 'text-emerald-600' : 'text-gray-400'}`}
            >
              {String(draftMinute).padStart(2, '0')}
            </button>
          </div>

          {step === 'hour' ? (
            <div
              ref={hourFaceRef}
              className="relative mx-auto h-56 w-56 rounded-full border border-gray-200 bg-gray-50 touch-none select-none"
              onPointerDown={(e) => {
                updateHourFromPoint(e.clientX, e.clientY);
                setDragMode('hour');
              }}
            >
              <div className="absolute inset-0 rounded-full border border-dashed border-gray-200" style={{ transform: 'scale(0.62)' }} />

              <div
                className="absolute left-1/2 top-1/2 h-[2px] -translate-y-1/2 origin-left bg-emerald-400 rounded-full"
                style={handStyleFromAngle(hourHandAngle, hourSelection.radius)}
              />

              {OUTER_HOURS.map((hour, i) => (
                <button
                  key={`outer-${hour}`}
                  type="button"
                  onClick={() => {
                    setDraftHour(hour);
                    setStep('minute');
                  }}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 h-8 w-8 rounded-full text-xs font-medium ${
                    draftHour === hour ? 'bg-emerald-500 text-white' : 'text-gray-700 hover:bg-emerald-100'
                  }`}
                  style={polarStyle(i, 12, 92)}
                >
                  {String(hour).padStart(2, '0')}
                </button>
              ))}

              {INNER_HOURS.map((hour, i) => (
                <button
                  key={`inner-${hour}`}
                  type="button"
                  onClick={() => {
                    setDraftHour(hour % 24);
                    setStep('minute');
                  }}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 h-7 w-7 rounded-full text-xs font-medium ${
                    draftHour === (hour % 24) ? 'bg-emerald-500 text-white' : 'text-gray-600 hover:bg-emerald-100'
                  }`}
                  style={polarStyle(i, 12, 58)}
                >
                  {hour}
                </button>
              ))}

              <div className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500" />
            </div>
          ) : (
            <div>
              <div
                ref={minuteFaceRef}
                className="relative mx-auto h-56 w-56 rounded-full border border-gray-200 bg-gray-50 touch-none select-none"
                onPointerDown={(e) => {
                  updateMinuteFromPoint(e.clientX, e.clientY);
                  setDragMode('minute');
                }}
              >
                <div
                  className="absolute left-1/2 top-1/2 h-[2px] -translate-y-1/2 origin-left bg-emerald-400 rounded-full"
                  style={handStyleFromAngle(minuteHandAngle, 86)}
                />

                {MINUTE_TICKS.map((minute, i) => (
                  <button
                    key={minute}
                    type="button"
                    onClick={() => setDraftMinute(minute)}
                    className={`absolute -translate-x-1/2 -translate-y-1/2 h-8 w-8 rounded-full text-xs font-medium ${
                      draftMinute === minute ? 'bg-emerald-500 text-white' : 'text-gray-700 hover:bg-emerald-100'
                    }`}
                    style={polarStyle(i, 12, 86)}
                  >
                    {String(minute).padStart(2, '0')}
                  </button>
                ))}

                <div className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500" />
              </div>

              <div className="mt-2 flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setDraftMinute((v) => (v + 59) % 60)}
                  className="px-2 py-1 text-xs rounded border border-gray-200 hover:bg-gray-50"
                >
                  -1分
                </button>
                <button
                  type="button"
                  onClick={() => setDraftMinute((v) => (v + 1) % 60)}
                  className="px-2 py-1 text-xs rounded border border-gray-200 hover:bg-gray-50"
                >
                  +1分
                </button>
              </div>
            </div>
          )}

          <div className="mt-3 flex items-center justify-between">
            <div />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="px-3 py-1.5 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => {
                  onChange(formatTime(draftHour, draftMinute));
                  setIsOpen(false);
                }}
                className="px-3 py-1.5 text-xs rounded bg-emerald-500 text-white hover:bg-emerald-600"
              >
                決定
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
