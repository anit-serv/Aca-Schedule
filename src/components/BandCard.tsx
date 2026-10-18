import { motion } from 'framer-motion';
import type { DraggableAttributes } from '@dnd-kit/core';
import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities';
import type { Band, ConstraintViolation } from '../types';
import { Icon } from './Icon';

interface BandCardProps {
  band: Band;
  mode: 'bank' | 'timetable';
  duration: number;
  placedCount?: number;
  showPlacedCount?: boolean;
  hasBankMenu?: boolean;
  number?: number;
  startTime?: string;
  endTime?: string;
  transitionTime?: number;
  onTransitionClick?: () => void;
  onRemove?: () => void;
  onTimeClick?: (field: 'start' | 'end') => void;
  fixedTime?: boolean;
  isReadOnly?: boolean;
  violations?: ConstraintViolation[];
  dragListeners?: SyntheticListenerMap;
  dragAttributes?: DraggableAttributes;
  preview?: boolean;
  customMode?: boolean;
  width?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  bankWidth?: number;
}

// バンク、実際の行、ドラッグ中のカードで共通の表示。mode だけで形を切り替える。
export const BandCard = ({ band, mode, duration, placedCount, showPlacedCount = false, hasBankMenu = false,
  number, startTime, endTime, transitionTime, onTransitionClick, onRemove, onTimeClick, fixedTime = false,
  isReadOnly = false, violations = [], dragListeners, dragAttributes,
  preview = false, customMode = false, width, sourceWidth, sourceHeight, bankWidth }: BandCardProps) => {
  const timetable = mode === 'timetable';
  const usesBackupRehearsalTime = violations.some(v => v.type === 'backup-rehearsal-used');
  const otherViolations = violations.filter(v => v.type !== 'backup-rehearsal-used');
  const severity = otherViolations.some(v => v.severity === 'high') ? 'high'
    : otherViolations.some(v => v.severity === 'medium') ? 'medium'
    : otherViolations.length ? 'low' : null;
  const violationIcon = severity === 'high' ? 'block' : severity === 'medium' ? 'warning' : 'info';
  const violationColor = severity === 'high' ? 'text-rose-500' : severity === 'medium' ? 'text-amber-500' : 'text-sky-500';
  const renderViolationTooltip = () => (
    <div className="absolute bottom-full right-0 z-50 mb-2 hidden w-80 max-w-[80vw] whitespace-normal rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-900 shadow-2xl group-hover:block">
      <div className="mb-2 font-bold">確認事項 ({violations.length}件)</div>
      {violations.map((violation, index) => <div key={index} className="mb-1 break-words text-gray-600">• {violation.message}</div>)}
    </div>
  );

  return <motion.div
    initial={false}
    data-timetable-band-card={timetable && !preview ? '' : undefined}
    data-custom-mode={customMode}
    animate={preview ? {
      width: timetable ? width : bankWidth ?? sourceWidth,
      height: timetable ? 56 : sourceHeight,
      x: timetable && width && sourceWidth ? -(width - sourceWidth) / 2 : 0,
      borderRadius: timetable ? 4 : 8,
      backgroundColor: timetable ? '#d1fae5' : '#ffffff',
      borderLeftWidth: timetable ? 0 : 4,
      borderLeftColor: timetable ? '#d1fae5' : '#34d399',
    } : undefined}
    transition={preview ? { type: 'spring', stiffness: 280, damping: 26, delay: timetable ? 0.15 : 0 } : undefined}
    className={`relative overflow-visible text-gray-900 ${preview ? 'overflow-hidden border border-gray-200 shadow-lg' : timetable ? 'min-h-14' : 'rounded-lg border border-gray-200 border-l-4 border-l-emerald-400 bg-white p-3 shadow-sm hover:bg-emerald-50 hover:border-emerald-300'}`}
  >
    <motion.div
      initial={false}
      animate={preview ? { opacity: timetable ? 0 : 1, x: timetable ? -24 : 0 } : undefined}
      transition={{ duration: 0.16, delay: preview && timetable ? 0.15 : 0 }}
      className={preview ? 'absolute inset-0 flex items-center px-3' : timetable ? 'hidden' : `flex items-start justify-between ${hasBankMenu && !showPlacedCount ? 'pr-8' : ''}`}
      style={preview ? { pointerEvents: timetable ? 'none' : 'auto' } : undefined}
    >
      <div className="min-w-0 flex-1">
        <div className="group relative min-w-0">
          <div className="truncate font-semibold">{band.name || '(未設定)'}</div>
          {band.members.length > 0 && <div className="absolute bottom-full left-0 z-40 mb-2 hidden w-max max-w-xs rounded-lg border border-gray-200 bg-white p-2 text-xs text-gray-600 shadow-lg group-hover:block">{band.members.join(', ')}</div>}
        </div>
        <div className="mt-1 text-sm text-gray-500">{duration}分</div>
      </div>
      {showPlacedCount && <div className={`ml-2 rounded bg-emerald-500 px-2 py-1 text-xs font-semibold text-white ${hasBankMenu ? 'mr-7' : ''}`}>{Math.max(0, band.performanceCount - (placedCount ?? 0))}/{band.performanceCount}</div>}
    </motion.div>
    <motion.div
      initial={false}
      animate={preview ? { opacity: timetable ? 1 : 0, x: timetable ? 0 : 24 } : undefined}
      transition={{ duration: 0.2, delay: preview && timetable ? 0.15 : 0 }}
      className={preview ? 'band-card-grid absolute inset-0 grid items-center border-b border-gray-200 text-sm' : timetable ? 'band-card-grid grid min-h-14 items-center text-sm' : 'hidden'}
      style={{ gridTemplateColumns: customMode ? '64px 96px 0px 0px minmax(0, 1fr) 0px' : '64px 96px 96px 80px minmax(0, 1fr) 80px', pointerEvents: preview && !timetable ? 'none' : 'auto' }}
    >
      <div className="px-3 text-center font-semibold text-gray-600">{number ?? ''}</div>
      <div className="relative flex items-center gap-1 px-2">
        {fixedTime && <Icon name="lock" className="absolute -left-2 top-1/2 -translate-y-1/2 text-sm leading-none text-emerald-700" />}
        <button type="button" onClick={onTransitionClick} disabled={customMode || isReadOnly || !onTransitionClick} className={`w-5 flex-shrink-0 rounded px-1 text-xs ${customMode || isReadOnly || !onTransitionClick ? 'cursor-default' : 'hover:bg-gray-600'} ${transitionTime ? 'text-yellow-400' : 'text-gray-500'}`} title={transitionTime ? `転換時間: ${transitionTime}分` : customMode ? 'カスタムモードでは転換時間を変更できません' : '転換時間を設定'}><Icon name="schedule" className="align-middle text-sm" /></button>
        <button type="button" onClick={() => onTimeClick?.('start')} disabled={!onTimeClick} className={onTimeClick ? 'rounded hover:bg-emerald-100 underline decoration-dotted' : ''} title="開始時刻を編集">{startTime || (preview ? '—' : '-')}</button>
      </div>
      <div className="mode-card-optional min-w-0 overflow-hidden whitespace-nowrap px-4"><button type="button" onClick={() => onTimeClick?.('end')} disabled={!onTimeClick} className={onTimeClick ? 'rounded hover:bg-emerald-100 underline decoration-dotted' : ''} title="終了時刻を編集">{endTime || (preview ? '—' : '-')}</button></div>
      <div className="mode-card-optional min-w-0 overflow-hidden whitespace-nowrap px-4">{duration}分</div>
      <div className="mode-band-cell flex min-w-0 items-center gap-2 px-4">
        <div {...dragListeners} {...dragAttributes} className={`mode-drag-handle w-5 flex-shrink-0 text-emerald-400 ${dragListeners ? 'cursor-grab active:cursor-grabbing hover:text-emerald-600' : ''}`}>{(dragListeners || preview) && <Icon name="drag_indicator" className="align-middle text-base" />}</div>
        <div className="group relative min-w-0 flex-1">
          <div className="truncate font-medium">{band.name || '(未設定)'}</div>
          {band.members.length > 0 && !preview && <div className="absolute bottom-full left-0 z-40 mb-2 hidden w-max max-w-xs rounded-lg border border-gray-200 bg-white p-2 text-xs text-gray-600 shadow-lg group-hover:block">{band.members.join(', ')}</div>}
        </div>
        {usesBackupRehearsalTime && !preview && <div className="group relative flex-shrink-0 text-violet-600" aria-label="予備出演可能時間帯の確認事項"><Icon name="more_time" className="align-middle text-lg" />{renderViolationTooltip()}</div>}
        {severity && !preview && <div className={`group relative ml-auto flex-shrink-0 ${violationColor}`}><Icon name={violationIcon} className="align-middle text-lg" />{renderViolationTooltip()}</div>}
      </div>
      <div className="mode-card-optional min-w-0 overflow-hidden whitespace-nowrap px-4"><button type="button" onClick={onRemove} disabled={isReadOnly || !onRemove} className={`inline-flex h-8 w-8 items-center justify-center rounded ${isReadOnly ? 'cursor-not-allowed text-gray-400 opacity-50' : 'text-red-600 hover:bg-red-50'}`} title={isReadOnly ? 'クール直前リハーサルでは削除できません' : '削除'} aria-label={`${band.name}を削除`}><Icon name="delete" className="text-xl" /></button></div>
    </motion.div>
  </motion.div>;
};
