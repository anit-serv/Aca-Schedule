import { useState, useEffect, useMemo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableTimetableRow } from './SortableTimetableRow';
import type { Cool, Band } from '../types';

interface CoolSectionProps {
  cool: Cool;
  coolIndex: number;
  totalCools: number;
  bands: Band[];
  overEntryId: string | null;
  onRemoveEntry: (entryId: string) => void;
  onDeleteCool: (coolIndex: number) => void;
  onMoveCoolUp: (coolIndex: number) => void;
  onMoveCoolDown: (coolIndex: number) => void;
  isReadOnly?: boolean; // クール直前リハーサルなどで編集を制限
  onTransitionTimeChange?: (entryId: string, transitionTime: number) => void;
  onCoolStartTimeChange?: (coolIndex: number, startTime: string | undefined) => void;
  previousCoolEndTime?: string; // 前のクールの終了時刻（デフォルト値として使用）
  nextCoolStartTime?: string; // 次のクールの開始時刻（警告表示用）
  dailyStartTime: string; // その日の開始時刻（最小値として使用）
}

export const CoolSection = ({ 
  cool, 
  coolIndex, 
  totalCools,
  bands, 
  overEntryId, 
  onRemoveEntry,
  onDeleteCool,
  onMoveCoolUp,
  onMoveCoolDown,
  isReadOnly = false,
  onTransitionTimeChange,
  onCoolStartTimeChange,
  previousCoolEndTime,
  nextCoolStartTime,
  dailyStartTime,
}: CoolSectionProps) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [startTimeInput, setStartTimeInput] = useState(cool.startTime || '');
  
  const { setNodeRef } = useDroppable({
    id: `cool-droppable-${coolIndex}`,
  });

  // coolの開始時刻が変更されたら入力フィールドも更新
  useEffect(() => {
    setStartTimeInput(cool.startTime || '');
  }, [cool.startTime]);

  // bandsが更新されたときに強制的に再レンダリング
  // このクールに関連するバンドのupdatedAtの合計をシグネチャとして使用
  const bandsSignature = useMemo(() => {
    const signature = cool.entries
      .filter(entry => entry.type === 'band' && entry.bandId)
      .map(entry => {
        const band = bands.find(b => b.id === entry.bandId);
        return band ? band.updatedAt.getTime() : 0;
      })
      .reduce((sum, time) => sum + time, 0);
    return signature;
  }, [bands, cool.entries]);

  // メニュー外をクリックしたときに閉じる
  useEffect(() => {
    if (!isMenuOpen) return;
    
    const handleClickOutside = () => setIsMenuOpen(false);
    document.addEventListener('click', handleClickOutside);
    
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [isMenuOpen]);

  const handleDeleteClick = () => {
    onDeleteCool(coolIndex);
    setIsMenuOpen(false);
  };

  const handleMoveUp = () => {
    onMoveCoolUp(coolIndex);
    setIsMenuOpen(false);
  };

  const handleMoveDown = () => {
    onMoveCoolDown(coolIndex);
    setIsMenuOpen(false);
  };

  const handleMenuToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsMenuOpen(!isMenuOpen);
  };

  const handleStartTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setStartTimeInput(value);
  };

  const handleStartTimeFocus = () => {
    // 現在値が空で、前のクールの終了時刻がある場合、デフォルト値として設定
    if (startTimeInput === '' && previousCoolEndTime) {
      setStartTimeInput(previousCoolEndTime);
    }
  };

  const handleStartTimeBlur = () => {
    if (onCoolStartTimeChange) {
      // 空文字の場合はundefinedに変換（開始時刻未設定）
      if (startTimeInput.trim() === '') {
        onCoolStartTimeChange(coolIndex, undefined);
        return;
      }

      // 開始時刻がdailyStartTimeより前でないか検証
      const timeToMinutes = (time: string): number => {
        const [hours, minutes] = time.split(':').map(Number);
        return hours * 60 + minutes;
      };

      const inputMinutes = timeToMinutes(startTimeInput);
      const minMinutes = timeToMinutes(dailyStartTime);

      if (inputMinutes < minMinutes) {
        // 最小値より前の場合は警告を表示し、元の値に戻す
        alert(`開始時刻は${dailyStartTime}以降に設定してください。`);
        setStartTimeInput(cool.startTime || '');
        return;
      }

      onCoolStartTimeChange(coolIndex, startTimeInput);
    }
  };

  const handleClearStartTime = () => {
    setStartTimeInput('');
    if (onCoolStartTimeChange) {
      onCoolStartTimeChange(coolIndex, undefined);
    }
  };

  // クールの最後のエントリーの終了時刻を取得
  const getLastEntryEndTime = (): string | undefined => {
    if (cool.entries.length === 0) return undefined;
    const lastEntry = cool.entries[cool.entries.length - 1];
    return lastEntry.endTime;
  };

  // 時刻超過警告の判定
  const isTimeExceeded = (): boolean => {
    if (!nextCoolStartTime) return false;
    const lastEndTime = getLastEntryEndTime();
    if (!lastEndTime) return false;
    
    // HH:mm形式の時刻を分単位に変換して比較
    const timeToMinutes = (time: string): number => {
      const [hours, minutes] = time.split(':').map(Number);
      return hours * 60 + minutes;
    };
    
    return timeToMinutes(lastEndTime) > timeToMinutes(nextCoolStartTime);
  };

  const showWarning = isTimeExceeded();

  return (
    <div className={`bg-gray-700 rounded-lg overflow-hidden ${showWarning ? 'ring-2 ring-red-500' : ''}`}>
      {totalCools > 1 && !isReadOnly && (
        <div className="bg-gray-600 px-4 py-2 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="font-semibold">第{cool.number}クール</div>
            <div className="flex items-center gap-2 text-sm">
              <label htmlFor={`cool-start-time-${coolIndex}`} className="text-gray-300">
                開始時刻:
              </label>
              <div className="flex items-center gap-1">
                <input
                  id={`cool-start-time-${coolIndex}`}
                  type="time"
                  value={startTimeInput}
                  onChange={handleStartTimeChange}
                  onFocus={handleStartTimeFocus}
                  onBlur={handleStartTimeBlur}
                  min={dailyStartTime}
                  className="bg-gray-700 text-white px-2 py-1 rounded border border-gray-500 focus:border-blue-400 focus:outline-none"
                  placeholder="未設定"
                  title={`${dailyStartTime}以降の時刻を設定してください`}
                />
                {startTimeInput && (
                  <button
                    onClick={handleClearStartTime}
                    className="text-gray-400 hover:text-white px-1 transition-colors"
                    title="開始時刻をクリア"
                  >
                    ✕
                  </button>
                )}
              </div>
              {!startTimeInput && (
                <span className="text-gray-400 text-xs">(前のクールから継続)</span>
              )}
              {showWarning && (
                <span className="text-red-400 text-xs flex items-center gap-1">
                  ⚠️ 次のクール開始時刻を超過
                </span>
              )}
            </div>
          </div>
          <div className="relative">
            <button
              onClick={handleMenuToggle}
              className="px-2 py-1 text-white hover:bg-gray-500 rounded transition-colors"
              title="メニュー"
            >
              ⋮
            </button>
            
            {isMenuOpen && (
              <div className="absolute right-0 mt-1 w-40 bg-gray-800 border border-gray-600 rounded shadow-lg z-10">
                <button
                  onClick={handleMoveUp}
                  disabled={coolIndex === 0}
                  className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-700 ${
                    coolIndex === 0 ? 'text-gray-500 cursor-not-allowed' : 'text-white'
                  }`}
                >
                  ↑ 上に移動
                </button>
                <button
                  onClick={handleMoveDown}
                  disabled={coolIndex === totalCools - 1}
                  className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-700 ${
                    coolIndex === totalCools - 1 ? 'text-gray-500 cursor-not-allowed' : 'text-white'
                  }`}
                >
                  ↓ 下に移動
                </button>
                <div className="border-t border-gray-600"></div>
                <button
                  onClick={handleDeleteClick}
                  className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-gray-700 transition-colors"
                >
                  🗑 削除
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      <div ref={setNodeRef} className="min-h-[100px]">
        <table className="w-full">
          <thead className="bg-gray-650">
            <tr>
              <th className="px-4 py-2 text-left text-sm font-semibold w-24">開始</th>
              <th className="px-4 py-2 text-left text-sm font-semibold w-24">終了</th>
              <th className="px-4 py-2 text-left text-sm font-semibold w-20">時間</th>
              <th className="px-4 py-2 text-left text-sm font-semibold">バンド名</th>
              <th className="px-4 py-2 text-left text-sm font-semibold w-20">操作</th>
            </tr>
          </thead>
          <tbody>
            {cool.entries.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  バンドをドラッグ＆ドロップで配置
                </td>
              </tr>
            ) : (
              <>
                {cool.entries.map((entry) => {
                  const band = entry.bandId ? bands.find((b) => b.id === entry.bandId) : null;
                  const entryId = `entry-${entry.id}`;
                  const isDropTarget = overEntryId === entryId;
                  // バンド情報が更新されたときに確実に再レンダリングするため、keyにbandsSignatureを含める
                  // これにより、バンド情報が変更されるとkeyが変わり、コンポーネントが再マウントされる
                  const rowKey = `${entry.id}-${bandsSignature}`;
                  
                  return (
                    <SortableTimetableRow
                      key={rowKey}
                      id={entryId}
                      entry={entry}
                      band={band}
                      isDropTarget={isDropTarget}
                      onRemove={() => onRemoveEntry(entry.id)}
                      isReadOnly={isReadOnly}
                      onTransitionTimeChange={onTransitionTimeChange}
                    />
                  );
                })}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
