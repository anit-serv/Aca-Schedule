import { useMemo, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { SortableTimetableRow } from './SortableTimetableRow';
import { Icon } from './Icon';
import type { TimetableEntry, Band, ConstraintViolation, CustomColumn } from '../types';

interface TimetableDropZoneProps {
  entries: TimetableEntry[];
  isReadOnly?: boolean;
  bands: Band[];
  overEntryId: string | null;
  reserveInsertionSpace?: boolean;
  onRemoveEntry: (entryId: string) => void;
  onTransitionTimeChange?: (entryId: string, transitionTime: number) => void;
  violations?: ConstraintViolation[]; // 制約違反
  bandNumbers: Map<string, number>; // エントリーIDとバンド番号のマッピング
  searchQuery?: string; // 検索クエリ
  customMode?: boolean;
  customColumns?: CustomColumn[];
  enteringColumnIds?: ReadonlySet<string>;
  renderCustomCell?: (entry: TimetableEntry, column: CustomColumn, index: number) => ReactNode;
  returningEntryId?: string | null;
}

export const TimetableDropZone = ({ 
  entries, 
  isReadOnly = false,
  bands, 
  overEntryId, 
  reserveInsertionSpace = false,
  onRemoveEntry,
  onTransitionTimeChange,
  violations = [],
  bandNumbers,
  searchQuery = '',
  customMode = false,
  customColumns = [],
  enteringColumnIds,
  renderCustomCell,
  returningEntryId = null,
}: TimetableDropZoneProps) => {
  const { setNodeRef } = useDroppable({
    id: 'timetable-droppable',
    disabled: isReadOnly,
  });

  // bandsが更新されたときに強制的に再レンダリング
  // このタイムテーブルに関連するバンドのupdatedAtの合計をシグネチャとして使用
  const bandsSignature = useMemo(() => {
    return entries
      .filter(entry => entry.type === 'band' && entry.bandId)
      .map(entry => {
        const band = bands.find(b => b.id === entry.bandId);
        return band ? band.updatedAt.getTime() : 0;
      })
      .reduce((sum, time) => sum + time, 0);
  }, [bands, entries]);

  return (
    <div ref={setNodeRef} className="flex-1 bg-emerald-50/50 rounded-lg min-h-[400px] border border-emerald-100">
      <table className="w-full">
        <thead className="sticky top-0 z-10 bg-emerald-100 shadow-sm">
          <tr>
            <th className="px-3 py-3 text-center text-sm font-semibold text-emerald-800 w-16">#</th>
            <th className="px-4 py-3 text-left text-sm font-semibold text-emerald-800 w-24"><span className="pl-4">開始</span></th>
            <th className="mode-optional-cell w-24 text-left text-sm font-semibold text-emerald-800"><span className="mode-optional-content">終了</span></th>
            <th className="mode-optional-cell w-20 text-left text-sm font-semibold text-emerald-800"><span className="mode-optional-content">時間</span></th>
            <th className="px-4 py-3 text-left text-sm font-semibold text-emerald-800"><span className="mode-band-name-label inline-block pl-7">バンド名</span></th>
            <th className="mode-optional-cell w-20" aria-label="削除操作" />
            <AnimatePresence>{customMode && customColumns.map(column => <motion.th key={column.id} initial={enteringColumnIds?.has(column.id) ? { width: 0, opacity: 0 } : false} animate={{ width: 160, opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={{ duration: 0.26 }} className="relative min-w-0 overflow-hidden whitespace-nowrap border-l border-emerald-200 p-0 text-left text-sm font-semibold text-emerald-800"><span className="absolute inset-y-0 left-0 flex w-40 items-center px-3"><Icon name={column.bindingType === 'sequence' ? 'push_pin' : 'music_note'} className="mr-1 text-sm align-middle" />{column.name}</span></motion.th>)}</AnimatePresence>
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 ? (
            <>
              {/* 空のタイムテーブルの場合のドロップターゲット */}
              {overEntryId === 'timetable-droppable' && (
                <tr className={reserveInsertionSpace ? 'h-14' : 'h-1'}>
                  <td colSpan={6 + (customMode ? customColumns.length : 0)} className="p-0">
                    <div className={reserveInsertionSpace ? 'h-14 bg-emerald-100/60' : 'h-1 bg-emerald-500 shadow-lg shadow-emerald-500/50'}></div>
                  </td>
                </tr>
              )}
              <tr>
                <td colSpan={6 + (customMode ? customColumns.length : 0)} className="px-4 py-12 text-center text-gray-500">
                  {customMode ? 'エントリーがありません。通常モードでバンドを配置してください' : '右のバンドバンクからドラッグ＆ドロップでバンドを配置してください'}
                </td>
              </tr>
            </>
          ) : (
            <SortableContext
              items={entries.map((e) => `entry-${e.id}`)}
              strategy={verticalListSortingStrategy}
            >
              {entries.map((entry, index) => {
                const band = entry.bandId ? bands.find((b) => b.id === entry.bandId) : null;
                const entryId = `entry-${entry.id}`;
                const isDropTarget = overEntryId === entryId;
                const isDropTargetAfter = overEntryId === `${entryId}-after`;
                // 最後のエントリーで、timetable-droppableが検出された場合、最後のエントリーの後ろをハイライト
                const isLastEntryAndTimetableEnd = index === entries.length - 1 && overEntryId === 'timetable-droppable';
                // バンド情報が更新されたときに確実に再レンダリングするため、keyにbandsSignatureを含める
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
                    isDropTarget={isDropTarget}
                    isDropTargetAfter={isDropTargetAfter || isLastEntryAndTimetableEnd}
                    reserveInsertionSpace={reserveInsertionSpace}
                    onRemove={() => onRemoveEntry(entry.id)}
                    isReadOnly={isReadOnly}
                    onTransitionTimeChange={onTransitionTimeChange}
                    violations={entryViolations}
                    bandNumber={bandNumber}
                    searchQuery={searchQuery}
                    customMode={customMode}
                    customColumns={customColumns}
                  renderCustomCell={renderCustomCell}
                  returningToBank={entry.id === returningEntryId}
                  />
                );
              })}
            </SortableContext>
          )}
        </tbody>
      </table>
    </div>
  );
};
