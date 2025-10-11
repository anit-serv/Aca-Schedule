import { useMemo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { SortableTimetableRow } from './SortableTimetableRow';
import type { TimetableEntry, Band, ConstraintViolation } from '../types';

interface TimetableDropZoneProps {
  entries: TimetableEntry[];
  bands: Band[];
  overEntryId: string | null;
  onRemoveEntry: (entryId: string) => void;
  onTransitionTimeChange?: (entryId: string, transitionTime: number) => void;
  violations?: ConstraintViolation[]; // 制約違反
  bandNumbers: Map<string, number>; // エントリーIDとバンド番号のマッピング
}

export const TimetableDropZone = ({ 
  entries, 
  bands, 
  overEntryId, 
  onRemoveEntry,
  onTransitionTimeChange,
  violations = [],
  bandNumbers,
}: TimetableDropZoneProps) => {
  const { setNodeRef } = useDroppable({
    id: 'timetable-droppable',
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
    <div ref={setNodeRef} className="bg-gray-700 rounded-lg overflow-hidden min-h-[400px]">
      <table className="w-full">
        <thead className="bg-gray-600 sticky top-0">
          <tr>
            <th className="px-3 py-3 text-center text-sm font-semibold w-16">#</th>
            <th className="px-4 py-3 text-left text-sm font-semibold w-24">開始</th>
            <th className="px-4 py-3 text-left text-sm font-semibold w-24">終了</th>
            <th className="px-4 py-3 text-left text-sm font-semibold w-20">時間</th>
            <th className="px-4 py-3 text-left text-sm font-semibold">バンド名</th>
            <th className="px-4 py-3 text-left text-sm font-semibold w-20">操作</th>
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-12 text-center text-gray-400">
                右のバンドバンクからドラッグ＆ドロップでバンドを配置してください
              </td>
            </tr>
          ) : (
            <SortableContext
              items={entries.map((e) => `entry-${e.id}`)}
              strategy={verticalListSortingStrategy}
            >
              {entries.map((entry) => {
                const band = entry.bandId ? bands.find((b) => b.id === entry.bandId) : null;
                const entryId = `entry-${entry.id}`;
                const isDropTarget = overEntryId === entryId;
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
                    onRemove={() => onRemoveEntry(entry.id)}
                    onTransitionTimeChange={onTransitionTimeChange}
                    violations={entryViolations}
                    bandNumber={bandNumber}
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
