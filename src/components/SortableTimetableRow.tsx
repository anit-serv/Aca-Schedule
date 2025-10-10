import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useState, useEffect, useMemo } from 'react';
import type { Band, TimetableEntry } from '../types';

interface SortableTimetableRowProps {
  id: string;
  entry: TimetableEntry;
  band: Band | null | undefined;
  isDropTarget?: boolean;
  onRemove: () => void;
  isReadOnly?: boolean; // クール直前リハーサルなどで編集を制限
  onTransitionTimeChange?: (entryId: string, transitionTime: number) => void;
}

export const SortableTimetableRow = ({
  id,
  entry,
  band,
  isDropTarget = false,
  onRemove,
  isReadOnly = false,
  onTransitionTimeChange,
}: SortableTimetableRowProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  const [showTransitionModal, setShowTransitionModal] = useState(false);
  const [transitionInput, setTransitionInput] = useState((entry.transitionTime || 0).toString());

  // バンド情報が更新されたときに転換時間入力をリセット
  useEffect(() => {
    setTransitionInput((entry.transitionTime || 0).toString());
  }, [entry.transitionTime]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // バンド情報をメモ化して、確実に最新の情報を使用
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
    return band?.performanceDuration || entry.customEvent?.duration || 0;
  }, [band?.performanceDuration, entry.customEvent?.duration]);

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

  return (
    <>
      {isDropTarget && (
        <tr className="h-1">
          <td colSpan={5} className="p-0">
            <div className="h-1 bg-blue-500 shadow-lg shadow-blue-500/50"></div>
          </td>
        </tr>
      )}
      <tr
        ref={setNodeRef}
        style={style}
        className={`border-b border-gray-600 hover:bg-gray-650 ${
          isDragging ? 'bg-gray-600' : entry.type === 'custom' ? 'bg-purple-900/20' : ''
        }`}
      >
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
            className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-white"
          >
            ⋮⋮
          </div>
          <div>
            <div className={`font-medium ${entry.type === 'custom' ? 'text-purple-300' : ''}`}>
              {bandName}
            </div>
            {bandMembers && bandMembers.length > 0 && (
              <div className="text-xs text-gray-400 mt-1">
                {bandMembers.slice(0, 3).join(', ')}
                {bandMembers.length > 3 && ` 他${bandMembers.length - 3}名`}
              </div>
            )}
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
        <td colSpan={5} className="p-0">
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
              <h3 className="text-lg font-bold mb-4">転換時間の設定</h3>
              <p className="text-sm text-gray-400 mb-4">
                このエントリーの前に挿入される転換時間（分単位）を設定します。
              </p>
              <div className="mb-4">
                <label className="block text-sm text-gray-400 mb-2">転換時間（分）</label>
                <input
                  type="number"
                  min="0"
                  max="60"
                  value={transitionInput}
                  onChange={(e) => setTransitionInput(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                  autoFocus
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => {
                    setShowTransitionModal(false);
                    setTransitionInput((entry.transitionTime || 0).toString());
                  }}
                  className="px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded text-white"
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
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white"
                >
                  設定
                </button>
              </div>
            </div>
          </div>
        </td>
      </tr>
    )}
  </>
  );
};