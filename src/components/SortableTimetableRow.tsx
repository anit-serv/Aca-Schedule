import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useState, useEffect, useMemo, useRef } from 'react';
import type { Band, TimetableEntry, ConstraintViolation } from '../types';

interface SortableTimetableRowProps {
  id: string;
  entry: TimetableEntry;
  band: Band | null | undefined;
  isDropTarget?: boolean; // 行の前（上）にドロップ
  isDropTargetAfter?: boolean; // 行の後（下）にドロップ
  onRemove: () => void;
  isReadOnly?: boolean; // クール直前リハーサルなどで編集を制限
  onTransitionTimeChange?: (entryId: string, transitionTime: number) => void;
  violations?: ConstraintViolation[]; // この行の制約違反リスト
  bandNumber?: number; // バンド番号（カスタムイベントの場合はundefined）
}

export const SortableTimetableRow = ({
  id,
  entry,
  band,
  isDropTarget = false,
  isDropTargetAfter = false,
  onRemove,
  isReadOnly = false,
  onTransitionTimeChange,
  violations = [],
  bandNumber,
}: SortableTimetableRowProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  const [showTransitionModal, setShowTransitionModal] = useState(false);
  const [transitionInput, setTransitionInput] = useState((entry.transitionTime || 0).toString());
  const [tooltipStyle, setTooltipStyle] = useState<{ top?: number; bottom?: number; left: number }>({ left: 0 });
  const iconRef = useRef<HTMLDivElement>(null);

  // バンド情報が更新されたときに転換時間入力をリセット
  useEffect(() => {
    setTransitionInput((entry.transitionTime || 0).toString());
  }, [entry.transitionTime]);

  // ツールチップの位置を計算
  const handleMouseEnter = () => {
    if (iconRef.current) {
      const rect = iconRef.current.getBoundingClientRect();
      const windowHeight = window.innerHeight;
      const spaceBelow = windowHeight - rect.bottom;
      const spaceAbove = rect.top;
      
      // 下に400px以上の余裕がない場合は上に表示
      if (spaceBelow < 400 && spaceAbove > spaceBelow) {
        setTooltipStyle({
          bottom: windowHeight - rect.top + 4,
          left: rect.left,
        });
      } else {
        setTooltipStyle({
          top: rect.bottom + 4,
          left: rect.left,
        });
      }
    }
  };

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // バンド情報をメモ化して、確実に最新の情報を使用
  // band オブジェクトが変更されたときに再計算されるよう、band 自体を依存配列に含める
  const bandName = useMemo(() => {
    if (entry.type === 'band' && band) {
      return band.name;
    }
    if (entry.type === 'custom' && entry.customEvent) {
      return entry.customEvent.name;
    }
    return '(不明)';
  }, [entry.type, entry.customEvent, band]);

  const bandMembers = useMemo(() => {
    if (!band || band.members.length === 0) return null;
    return band.members;
  }, [band]);

  const performanceDuration = useMemo(() => {
    const duration = band?.performanceDuration || entry.customEvent?.duration || 0;
    return duration;
  }, [band, entry.customEvent?.duration]);

  // 開始時刻と終了時刻から実際の時間を計算
  const duration = (() => {
    if (entry.startTime && entry.endTime) {
      const [startHours, startMinutes] = entry.startTime.split(':').map(Number);
      const [endHours, endMinutes] = entry.endTime.split(':').map(Number);
      const startTotalMinutes = startHours * 60 + startMinutes;
      const endTotalMinutes = endHours * 60 + endMinutes;
      return endTotalMinutes - startTotalMinutes;
    }
    return performanceDuration;
  })();

  // 制約違反の最も重大度の高いものを取得
  const highestSeverityViolation = useMemo(() => {
    if (violations.length === 0) return null;
    
    const severityOrder = { high: 0, medium: 1, low: 2 };
    return violations.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])[0];
  }, [violations]);

  // 違反の重大度に応じた背景色とアイコンを取得
  const getViolationStyle = () => {
    if (!highestSeverityViolation) return { bgColor: '', icon: '' };
    
    switch (highestSeverityViolation.severity) {
      case 'high':
        return { bgColor: 'bg-rose-100/80', icon: '🚫', iconColor: 'text-rose-500' };
      case 'medium':
        return { bgColor: 'bg-amber-100/80', icon: '⚠️', iconColor: 'text-amber-500' };
      case 'low':
        return { bgColor: 'bg-sky-100/80', icon: 'ℹ️', iconColor: 'text-sky-500' };
      default:
        return { bgColor: '', icon: '', iconColor: '' };
    }
  };

  const violationStyle = getViolationStyle();

  return (
    <>
      {isDropTarget && (
        <tr className="h-1">
          <td colSpan={6} className="p-0">
            <div className="h-1 bg-blue-500 shadow-lg shadow-blue-500/50"></div>
          </td>
        </tr>
      )}
      <tr
        ref={setNodeRef}
        style={style}
        data-entry-id={entry.id}
        className={`border-b border-gray-200 hover:bg-emerald-50 ${
          isDragging ? 'bg-emerald-100' : 
          violationStyle.bgColor ? violationStyle.bgColor :
          entry.type === 'custom' ? 'bg-emerald-100/70' : ''
        }`}
      >
      {/* バンド番号列 */}
      <td className="px-3 py-3 text-sm text-center font-semibold text-gray-600">
        {bandNumber !== undefined ? bandNumber : ''}
      </td>
      <td className="px-2 py-3 text-sm">
        <div className="flex items-center gap-1">
          {/* 転換時間アイコン */}
          <button
            onClick={() => setShowTransitionModal(true)}
            className={`text-xs px-1 rounded hover:bg-gray-600 transition-colors ${
              entry.transitionTime && entry.transitionTime > 0
                ? 'text-yellow-400'
                : 'text-gray-500'
            }`}
            title={entry.transitionTime && entry.transitionTime > 0 
              ? `転換時間: ${entry.transitionTime}分` 
              : '転換時間を設定'}
          >
            {entry.transitionTime && entry.transitionTime > 0 ? '🔧' : '⚙️'}
          </button>
          <span>{entry.startTime || '-'}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-sm">{entry.endTime || '-'}</td>
      <td className="px-4 py-3 text-sm">{duration}分</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div
            {...listeners}
            {...attributes}
            className="cursor-grab active:cursor-grabbing text-emerald-400 hover:text-emerald-600"
          >
            ⋮⋮
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              {/* バンド名（ツールチップでメンバー表示） */}
              {bandMembers && bandMembers.length > 0 ? (
                <div className="group relative">
                  <div className={`font-medium ${entry.type === 'custom' ? 'text-emerald-600' : 'text-gray-900'}`}>
                    {bandName}
                  </div>
                  {/* メンバーツールチップ */}
                  <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block z-40 w-max max-w-xs">
                    <div className="bg-white border border-gray-200 rounded-lg p-2 shadow-lg">
                      <div className="text-xs text-gray-600">
                        {bandMembers.join(', ')}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className={`font-medium ${entry.type === 'custom' ? 'text-emerald-600' : 'text-gray-900'}`}>
                  {bandName}
                </div>
              )}
              {highestSeverityViolation && (
                <div 
                  ref={iconRef}
                  className="group relative"
                  onMouseEnter={handleMouseEnter}
                >
                  <span className={`text-lg ${violationStyle.iconColor}`}>
                    {violationStyle.icon}
                  </span>
                  {/* ツールチップ（fixedポジショニングでスクロールコンテナの外に表示） */}
                  <div 
                    className="fixed hidden group-hover:block z-50 w-80"
                    style={tooltipStyle}
                  >
                    <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-2xl max-h-96 overflow-y-auto">
                      <div className="text-xs font-bold mb-2 text-gray-900">
                        制約違反 ({violations.length}件)
                      </div>
                      {violations.map((violation, idx) => (
                        <div key={idx} className="text-xs text-gray-600 mb-1 break-words">
                          • {violation.message}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <button
          onClick={onRemove}
          disabled={isReadOnly}
          className={`px-2 py-1 text-white text-xs rounded transition-colors ${
            isReadOnly 
              ? 'bg-gray-600 cursor-not-allowed opacity-50' 
              : 'bg-red-600 hover:bg-red-700'
          }`}
          title={isReadOnly ? 'クール直前リハーサルでは削除できません' : '削除'}
        >
          削除
        </button>
      </td>
    </tr>
    
    {/* 転換時間設定モーダル */}
    {showTransitionModal && (
      <tr>
        <td colSpan={6} className="p-0">
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
              <h3 className="text-lg font-bold mb-4 text-gray-900">転換時間の設定</h3>
              <p className="text-sm text-gray-500 mb-4">
                このエントリーの前に挿入される転換時間（分単位）を設定します。
              </p>
              <div className="mb-4">
                <label className="block text-sm text-gray-500 mb-2">転換時間（分）</label>
                <input
                  type="number"
                  min="0"
                  max="60"
                  value={transitionInput}
                  onChange={(e) => setTransitionInput(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded text-gray-900"
                  autoFocus
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => {
                    setShowTransitionModal(false);
                    setTransitionInput((entry.transitionTime || 0).toString());
                  }}
                  className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded text-gray-700"
                >
                  キャンセル
                </button>
                <button
                  onClick={() => {
                    const time = parseInt(transitionInput) || 0;
                    if (onTransitionTimeChange) {
                      onTransitionTimeChange(entry.id, time);
                    }
                    setShowTransitionModal(false);
                  }}
                  className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 rounded text-white"
                >
                  設定
                </button>
              </div>
            </div>
          </div>
        </td>
      </tr>
    )}
    {/* 行の後ろ（下）にドロップする場合のハイライト */}
    {isDropTargetAfter && (
      <tr className="h-1">
        <td colSpan={6} className="p-0">
          <div className="h-1 bg-emerald-500 shadow-lg shadow-emerald-500/50"></div>
        </td>
      </tr>
    )}
  </>
  );
};