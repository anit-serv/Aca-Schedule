import { useState, useMemo } from 'react';
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  type DragOverEvent,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import type { Band, EventSettings, Timetable, DailyTimetable, TimetableEntry } from '../types';
import { BandBankItem } from './BandBankItem.tsx';
import { SortableTimetableRow } from './SortableTimetableRow.tsx';

interface TimetableEditingProps {
  bands: Band[];
  eventSettings: EventSettings;
  timetable: Timetable | null;
  onTimetableChange: (timetable: DailyTimetable) => void;
}

export const TimetableEditing = ({
  bands,
  eventSettings,
  timetable,
  onTimetableChange,
}: TimetableEditingProps) => {
  const [selectedDate, setSelectedDate] = useState(eventSettings.performanceDates[0] || '');
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [overEntryId, setOverEntryId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  // 現在選択されている日のタイムテーブルを取得
  const currentTimetable = useMemo(() => {
    const dailyTimetable = timetable?.dailyTimetables.find(dt => dt.date === selectedDate);
    if (!dailyTimetable) {
      return {
        date: selectedDate,
        startTime: '10:00',
        entries: [],
      };
    }
    return dailyTimetable;
  }, [timetable, selectedDate]);

  // 各バンドの配置回数を計算（全日程を対象）
  const bandUsageCount = useMemo(() => {
    const counts: Record<string, number> = {};
    timetable?.dailyTimetables.forEach((dailyTimetable) => {
      dailyTimetable.entries.forEach((entry) => {
        if (entry.type === 'band' && entry.bandId) {
          counts[entry.bandId] = (counts[entry.bandId] || 0) + 1;
        }
      });
    });
    return counts;
  }, [timetable]);

  // 未配置バンドのリスト
  const unplacedBands = useMemo(() => {
    return bands
      .map((band) => ({
        ...band,
        placedCount: bandUsageCount[band.id] || 0,
      }))
      .filter((band) => band.placedCount < band.performanceCount);
  }, [bands, bandUsageCount]);

  // 時刻を計算
  const calculateTimes = (entries: TimetableEntry[], startTime: string) => {
    let currentTime = startTime;
    return entries.map((entry, index) => {
      const band = entry.bandId ? bands.find((b) => b.id === entry.bandId) : null;
      const duration = band?.performanceDuration || entry.customEvent?.duration || 0;

      const [hours, minutes] = currentTime.split(':').map(Number);
      const startMinutes = hours * 60 + minutes;
      const endMinutes = startMinutes + duration;
      const endHours = Math.floor(endMinutes / 60);
      const endMins = endMinutes % 60;

      const calculatedEntry = {
        ...entry,
        startTime: currentTime,
        endTime: `${endHours.toString().padStart(2, '0')}:${endMins.toString().padStart(2, '0')}`,
        order: index,
      };

      currentTime = calculatedEntry.endTime!;
      return calculatedEntry;
    });
  };

  // ドラッグ開始
  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(event.active.id as string);
  };

  // ドラッグ中
  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event;
    
    // バンドバンクからのドラッグ中にタイムテーブル上のエントリーにホバーしている場合
    if (over && (over.id as string).startsWith('entry-')) {
      setOverEntryId(over.id as string);
    } else {
      setOverEntryId(null);
    }
  };

  // ドラッグ終了
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragId(null);
    setOverEntryId(null);

    const activeId = active.id as string;

    // バンドバンクからタイムテーブルへの追加
    if (activeId.startsWith('band-')) {
      // ドロップ先がない、またはタイムテーブル関連以外へのドロップはキャンセル
      if (!over) return;
      
      const overId = over.id as string;
      
      // タイムテーブル関連の要素のみを許可
      if (!overId.startsWith('entry-') && overId !== 'timetable-droppable') {
        return;
      }

      const bandId = activeId.replace('band-', '');
      const band = bands.find((b) => b.id === bandId);
      if (!band) return;

      // タイムテーブルの特定の位置に挿入する場合
      if (overId.startsWith('entry-')) {
        const targetIndex = currentTimetable.entries.findIndex((e) => `entry-${e.id}` === overId);
        
        const newEntry: TimetableEntry = {
          id: crypto.randomUUID(),
          type: 'band',
          bandId: band.id,
          order: targetIndex,
        };

        const updatedEntries = [...currentTimetable.entries];
        updatedEntries.splice(targetIndex, 0, newEntry);
        const calculatedEntries = calculateTimes(updatedEntries, currentTimetable.startTime);

        onTimetableChange({
          ...currentTimetable,
          entries: calculatedEntries,
        });
      } else {
        // タイムテーブルの最後に追加（空のテーブルや timetable-droppable へのドロップ）
        const newEntry: TimetableEntry = {
          id: crypto.randomUUID(),
          type: 'band',
          bandId: band.id,
          order: currentTimetable.entries.length,
        };

        const updatedEntries = [...currentTimetable.entries, newEntry];
        const calculatedEntries = calculateTimes(updatedEntries, currentTimetable.startTime);

        onTimetableChange({
          ...currentTimetable,
          entries: calculatedEntries,
        });
      }
      return;
    }

    // タイムテーブル内での並び替え
    if (!over) return;
    
    const overId = over.id as string;
    
    if (activeId.startsWith('entry-') && overId.startsWith('entry-')) {
      const oldIndex = currentTimetable.entries.findIndex((e) => `entry-${e.id}` === activeId);
      const newIndex = currentTimetable.entries.findIndex((e) => `entry-${e.id}` === overId);

      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

      const reorderedEntries = arrayMove(currentTimetable.entries, oldIndex, newIndex);
      const calculatedEntries = calculateTimes(reorderedEntries, currentTimetable.startTime);

      onTimetableChange({
        ...currentTimetable,
        entries: calculatedEntries,
      });
    }
  };

  // エントリを削除
  const handleRemoveEntry = (entryId: string) => {
    const updatedEntries = currentTimetable.entries.filter((e) => e.id !== entryId);
    const calculatedEntries = calculateTimes(updatedEntries, currentTimetable.startTime);

    onTimetableChange({
      ...currentTimetable,
      entries: calculatedEntries,
    });
  };

  // ドラッグ中のアイテムを取得
  const activeBand = activeDragId?.startsWith('band-')
    ? bands.find((b) => `band-${b.id}` === activeDragId)
    : null;

  const activeEntry = activeDragId?.startsWith('entry-')
    ? currentTimetable.entries.find((e) => `entry-${e.id}` === activeDragId)
    : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-[calc(100vh-8rem)] gap-4">
        {/* 左ペイン: ナビゲーション */}
        <div className="w-64 bg-gray-800 rounded-lg p-4 overflow-y-auto">
          <h3 className="text-lg font-bold mb-4">日付選択</h3>
          <div className="space-y-2">
            {eventSettings.performanceDates.map((date) => {
              const dateObj = new Date(date);
              const formattedDate = `${dateObj.getMonth() + 1}/${dateObj.getDate()}`;

              return (
                <button
                  key={date}
                  onClick={() => setSelectedDate(date)}
                  className={`w-full px-4 py-2 rounded-md text-left transition-colors ${
                    selectedDate === date
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {formattedDate}
                </button>
              );
            })}
          </div>
        </div>

        {/* 中央ペイン: タイムテーブル */}
        <div className="flex-1 bg-gray-800 rounded-lg p-6 overflow-y-auto">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xl font-bold">タイムテーブル</h3>
            <div className="text-sm text-gray-400">
              開始時刻: {currentTimetable.startTime}
            </div>
          </div>

          {/* タイムテーブルテーブル */}
          <TimetableDropZone
            entries={currentTimetable.entries}
            bands={bands}
            overEntryId={overEntryId}
            onRemoveEntry={handleRemoveEntry}
          />
        </div>

        {/* 右ペイン: バンドバンク */}
        <BandBankDropZone unplacedBands={unplacedBands} />
      </div>

      {/* ドラッグオーバーレイ */}
      <DragOverlay>
        {activeBand && (
          <div className="bg-blue-600 text-white px-4 py-3 rounded shadow-lg">
            <div className="font-semibold">{activeBand.name}</div>
            <div className="text-sm">{activeBand.performanceDuration}分</div>
          </div>
        )}
        {activeEntry && (
          <div className="bg-gray-700 text-white px-4 py-3 rounded shadow-lg">
            <div className="font-semibold">
              {activeEntry.bandId
                ? bands.find((b) => b.id === activeEntry.bandId)?.name
                : activeEntry.customEvent?.name}
            </div>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
};

// ドロップ可能なタイムテーブル領域コンポーネント
interface TimetableDropZoneProps {
  entries: TimetableEntry[];
  bands: Band[];
  overEntryId: string | null;
  onRemoveEntry: (entryId: string) => void;
}

const TimetableDropZone = ({ entries, bands, overEntryId, onRemoveEntry }: TimetableDropZoneProps) => {
  const { setNodeRef } = useDroppable({
    id: 'timetable-droppable',
  });

  return (
    <div ref={setNodeRef} className="bg-gray-700 rounded-lg overflow-hidden min-h-[400px]">
      <table className="w-full">
        <thead className="bg-gray-600 sticky top-0">
          <tr>
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
              <td colSpan={5} className="px-4 py-12 text-center text-gray-400">
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
                return (
                  <SortableTimetableRow
                    key={entry.id}
                    id={entryId}
                    entry={entry}
                    band={band}
                    isDropTarget={isDropTarget}
                    onRemove={() => onRemoveEntry(entry.id)}
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

// バンドバンク領域コンポーネント
interface BandBankDropZoneProps {
  unplacedBands: (Band & { placedCount: number })[];
}

const BandBankDropZone = ({ unplacedBands }: BandBankDropZoneProps) => {
  const { setNodeRef } = useDroppable({
    id: 'band-bank-droppable',
  });

  return (
    <div ref={setNodeRef} className="w-80 bg-gray-800 rounded-lg p-4 overflow-y-auto">
      <h3 className="text-lg font-bold mb-4">バンドバンク</h3>
      <div className="text-sm text-gray-400 mb-4">
        未配置バンド: {unplacedBands.length}
      </div>

      <div className="space-y-2">
        {unplacedBands.length === 0 ? (
          <div className="text-center text-gray-400 py-8">
            すべてのバンドが配置されました
          </div>
        ) : (
          unplacedBands.map((band) => (
            <BandBankItem
              key={`band-${band.id}`}
              id={`band-${band.id}`}
              band={band}
              placedCount={band.placedCount}
            />
          ))
        )}
      </div>
    </div>
  );
};
