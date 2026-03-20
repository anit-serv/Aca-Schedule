import { useState, useEffect, useMemo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { SortableTimetableRow } from './SortableTimetableRow';
import { DesktopClockTimePicker } from './DesktopClockTimePicker';
import type { Cool, Band, ConstraintViolation } from '../types';

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
  rehearsalType?: 'rehearsal-day' | 'cool-pre-rehearsal' | 'day-start-rehearsal' | 'none'; // リハーサルのタイプ
  onTransitionTimeChange?: (entryId: string, transitionTime: number) => void;
  onCoolStartTimeChange?: (coolIndex: number, startTime: string | undefined) => void;
  previousCoolEndTime?: string; // 前のクールの終了時刻（デフォルト値として使用）
  overlapBaselineTime?: string; // 開始時刻の重なり判定に使う基準時刻
  nextCoolStartTime?: string; // 次のクールの開始時刻（警告表示用）
  dailyStartTime: string; // その日の開始時刻（最小値として使用）
  violations?: ConstraintViolation[]; // このクール内の制約違反
  bandNumbers: Map<string, number>; // エントリーIDとバンド番号のマッピング
  searchQuery?: string; // 検索クエリ
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
  rehearsalType = 'none',
  onTransitionTimeChange,
  onCoolStartTimeChange,
  previousCoolEndTime,
  overlapBaselineTime,
  nextCoolStartTime,
  dailyStartTime,
  violations = [],
  bandNumbers,
  searchQuery = '',
}: CoolSectionProps) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [startTimeInput, setStartTimeInput] = useState(cool.startTime || '');
  
  const { setNodeRef } = useDroppable({
    id: `cool-droppable-${coolIndex}`,
  });

  // クールヘッダー全体をドロップ可能に（先頭に追加）
  const { setNodeRef: setHeaderRef } = useDroppable({
    id: `cool-header-${coolIndex}`,
  });

  // 列ヘッダーをドロップ可能に
  const { setNodeRef: setColumnHeaderRef } = useDroppable({
    id: `cool-column-header-${coolIndex}`,
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

  const handleStartTimeCommit = (value: string | undefined) => {
    if (!onCoolStartTimeChange) return;

    if (!value || value.trim() === '') {
      setStartTimeInput('');
      onCoolStartTimeChange(coolIndex, undefined);
      return;
    }

    // 開始時刻がdailyStartTimeより前でないか検証
    const timeToMinutes = (time: string): number => {
      const [hours, minutes] = time.split(':').map(Number);
      return hours * 60 + minutes;
    };

    const inputMinutes = timeToMinutes(value);
    const minMinutes = timeToMinutes(dailyStartTime);

    if (inputMinutes < minMinutes) {
      alert(`開始時刻は${dailyStartTime}以降に設定してください。`);
      setStartTimeInput(cool.startTime || '');
      return;
    }

    setStartTimeInput(value);
    onCoolStartTimeChange(coolIndex, value);
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

  // 開始時刻が前タイムラインと重なるかどうかを判定
  const isOverlappingPreviousTimeline = (): boolean => {
    if (!cool.startTime || !overlapBaselineTime) return false;

    const timeToMinutes = (time: string): number => {
      const [hours, minutes] = time.split(':').map(Number);
      return hours * 60 + minutes;
    };

    return timeToMinutes(cool.startTime) < timeToMinutes(overlapBaselineTime);
  };

  const showWarning = isTimeExceeded();
  const showOverlapWarning = isOverlappingPreviousTimeline();

  // 別日リハーサルイベントの場合は常にクール名を表示、それ以外は複数クールかつ編集可能な場合のみ表示
  const shouldShowCoolHeader = rehearsalType === 'rehearsal-day' || (totalCools > 1 && !isReadOnly);

  return (
    <div className={`bg-emerald-50/50 rounded-lg overflow-hidden border border-emerald-100 ${(showWarning || showOverlapWarning) ? 'ring-2 ring-red-500' : ''}`}>
      {shouldShowCoolHeader && (
        <div className="relative">
          {/* クール名ヘッダーの上に表示する線は削除（ドロップ可能だがハイライトなし） */}
          <div ref={setHeaderRef} className="bg-emerald-100 px-4 py-2 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="font-semibold text-emerald-800">第{cool.number}クール</div>
            {!isReadOnly && (
            <div className="flex items-center gap-2 text-sm">
              <label htmlFor={`cool-start-time-${coolIndex}`} className="text-gray-600">
                開始時刻:
              </label>
              <div className="flex items-center gap-1">
                <DesktopClockTimePicker
                  id={`cool-start-time-${coolIndex}`}
                  value={startTimeInput}
                  onChange={handleStartTimeCommit}
                  allowClear
                  inputClassName="bg-white text-gray-900 px-2 py-1 rounded border border-gray-300 focus:border-emerald-500 focus:outline-none min-w-[96px] text-sm"
                  placeholder="未設定"
                />
              </div>
              {!startTimeInput && previousCoolEndTime && (
                <span className="text-gray-500 text-xs">
                  ({previousCoolEndTime} から継続)
                </span>
              )}
              {!startTimeInput && !previousCoolEndTime && (
                <span className="text-gray-500 text-xs">(前のクールから継続)</span>
              )}
              {showWarning && (
                <span className="text-red-400 text-xs flex items-center gap-1">
                  ⚠️ 次のクール開始時刻を超過
                </span>
              )}
              {showOverlapWarning && (
                <span className="text-red-400 text-xs flex items-center gap-1">
                  ⚠️ 前のタイムラインと時刻が重複
                </span>
              )}
            </div>
            )}
          </div>
          {!isReadOnly && (
          <div className="relative">
            <button
              onClick={handleMenuToggle}
              className="px-2 py-1 text-gray-700 hover:bg-gray-300 rounded transition-colors"
              title="メニュー"
            >
              ⋮
            </button>
            
            {isMenuOpen && (
              <div className="absolute right-0 mt-1 w-40 bg-white border border-gray-200 rounded shadow-lg z-10">
                <button
                  onClick={handleMoveUp}
                  disabled={coolIndex === 0}
                  className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-100 ${
                    coolIndex === 0 ? 'text-gray-400 cursor-not-allowed' : 'text-gray-700'
                  }`}
                >
                  ↑ 上に移動
                </button>
                <button
                  onClick={handleMoveDown}
                  disabled={coolIndex === totalCools - 1}
                  className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-100 ${
                    coolIndex === totalCools - 1 ? 'text-gray-400 cursor-not-allowed' : 'text-gray-700'
                  }`}
                >
                  ↓ 下に移動
                </button>
                <div className="border-t border-gray-200"></div>
                <button
                  onClick={handleDeleteClick}
                  className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-gray-100 transition-colors"
                >
                  🗑 削除
                </button>
              </div>
            )}
          </div>
          )}
          </div>
        </div>
      )}
      <div ref={setNodeRef} className={cool.entries.length === 0 ? "min-h-[100px]" : ""}>
        <table className="w-full">
          <thead ref={setColumnHeaderRef} className="bg-emerald-100/70">
            <tr>
              <th className="px-3 py-2 text-center text-sm font-semibold text-emerald-800 w-16">#</th>
              <th className="px-4 py-2 text-left text-sm font-semibold text-emerald-800 w-24">開始</th>
              <th className="px-4 py-2 text-left text-sm font-semibold text-emerald-800 w-24">終了</th>
              <th className="px-4 py-2 text-left text-sm font-semibold text-emerald-800 w-20">時間</th>
              <th className="px-4 py-2 text-left text-sm font-semibold text-emerald-800">バンド名</th>
              <th className="px-4 py-2 text-left text-sm font-semibold text-emerald-800 w-20">操作</th>
            </tr>
          </thead>
          <SortableContext
            items={cool.entries.map(e => `entry-${e.id}`)}
            strategy={verticalListSortingStrategy}
          >
          <tbody>
            {cool.entries.length === 0 ? (
              <>
                {/* 空のクールの場合のドロップターゲット */}
                {(overEntryId === `cool-droppable-${coolIndex}` ||
                  overEntryId === `cool-header-${coolIndex}` ||
                  overEntryId === `cool-column-header-${coolIndex}` ||
                  overEntryId === `cool-gap-before-${coolIndex}` ||
                  overEntryId === `cool-gap-after-${coolIndex}`) && (
                  <tr className="h-1">
                    <td colSpan={6} className="p-0">
                      <div className="h-1 bg-emerald-500 shadow-lg shadow-emerald-500/50"></div>
                    </td>
                  </tr>
                )}
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    バンドをドラッグ＆ドロップで配置
                  </td>
                </tr>
              </>
            ) : (
              <>
                {cool.entries.map((entry, entryIndex) => {
                  const band = entry.bandId ? bands.find((b) => b.id === entry.bandId) : null;
                  const entryId = `entry-${entry.id}`;
                  const isDropTarget = overEntryId === entryId;
                  const isDropTargetAfter = overEntryId === `${entryId}-after`;
                  
                  // クールヘッダーまたは列ヘッダー、または前のギャップにドロップした場合、最初のエントリーの前をハイライト
                  const isFirstEntryAndHeaderDrop = entryIndex === 0 && (
                    overEntryId === `cool-header-${coolIndex}` || 
                    overEntryId === `cool-column-header-${coolIndex}` ||
                    overEntryId === `cool-gap-before-${coolIndex}`
                  );
                  
                  // 最後のエントリーで、cool-droppableまたはcool-gap-afterが検出された場合、最後のエントリーの後ろをハイライト
                  const isLastEntryAndCoolEnd = entryIndex === cool.entries.length - 1 && (
                    overEntryId === `cool-droppable-${coolIndex}` ||
                    overEntryId === `cool-gap-after-${coolIndex}`
                  );
                  
                  // バンド情報が更新されたときに確実に再レンダリングするため、keyにbandsSignatureを含める
                  // これにより、バンド情報が変更されるとkeyが変わり、コンポーネントが再マウントされる
                  const rowKey = `${entry.id}-${bandsSignature}`;
                  
                  // このエントリーの制約違反をフィルタ
                  const entryViolations = violations.filter(v => v.entryId === entry.id);
                  
                  // このエントリーのバンド番号を取得
                  const bandNumber = bandNumbers.get(entry.id);
                  
                  return (
                    <SortableTimetableRow
                      key={rowKey}
                      id={entryId}
                      entry={entry}
                      band={band}
                      isDropTarget={isDropTarget || isFirstEntryAndHeaderDrop}
                      isDropTargetAfter={isDropTargetAfter || isLastEntryAndCoolEnd}
                      onRemove={() => onRemoveEntry(entry.id)}
                      isReadOnly={isReadOnly}
                      onTransitionTimeChange={onTransitionTimeChange}
                      violations={entryViolations}
                      bandNumber={bandNumber}
                      searchQuery={searchQuery}
                    />
                  );
                })}
                {/* クールの最後にドロップできるようにする（エントリーがない場合のみ表示） */}
                {/* エントリーがある場合は最後のエントリーの-afterとして表示される */}
                {cool.entries.length === 0 && (overEntryId === `cool-droppable-${coolIndex}` ||
                  overEntryId === `cool-gap-after-${coolIndex}`) && (
                  <tr className="h-1">
                    <td colSpan={6} className="p-0">
                      <div className="h-1 bg-emerald-500 shadow-lg shadow-emerald-500/50"></div>
                    </td>
                  </tr>
                )}
              </>
            )}
          </tbody>
          </SortableContext>
        </table>
      </div>
    </div>
  );
};
