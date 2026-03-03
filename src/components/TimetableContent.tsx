import type { Band, DailyTimetable, ConstraintViolation } from '../types';
import { CoolSection } from './CoolSection';
import { TimetableDropZone } from './TimetableDropZone';
import { CoolGapDropZone } from './CoolGapDropZone';

interface TimetableContentProps {
  currentTimetable: DailyTimetable;
  bands: Band[];
  overEntryId: string | null;
  violations: ConstraintViolation[];
  bandNumbers: Map<string, number>;
  isReadOnly: boolean;
  rehearsalType: 'rehearsal-day' | 'cool-pre-rehearsal' | 'day-start-rehearsal' | 'none';
  onRemoveEntry: (entryId: string, coolIndex?: number) => void;
  onDeleteCool: (coolIndex: number) => void;
  onMoveCoolUp: (coolIndex: number) => void;
  onMoveCoolDown: (coolIndex: number) => void;
  onTransitionTimeChange: (entryId: string, transitionTime: number) => void;
  onCoolStartTimeChange: (coolIndex: number, startTime: string | undefined) => void;
  searchQuery?: string;
}

export const TimetableContent = ({
  currentTimetable,
  bands,
  overEntryId,
  violations,
  bandNumbers,
  isReadOnly,
  rehearsalType,
  onRemoveEntry,
  onDeleteCool,
  onMoveCoolUp,
  onMoveCoolDown,
  onTransitionTimeChange,
  onCoolStartTimeChange,
  searchQuery = '',
}: TimetableContentProps) => {
  return (
    <div className="flex-1 bg-white rounded-lg px-6 overflow-y-auto min-w-0 shadow">
      <div>
        {currentTimetable.cools && currentTimetable.cools.length > 0 ? (
          <div>
            {currentTimetable.cools.map((cool, coolIndex) => {
              // 前のクールの終了時刻を取得（デフォルト値として使用）
              // 第1クールの場合は本番/リハーサル開始時刻を使用
              const previousCoolEndTime = coolIndex > 0
                ? (() => {
                    const prevCool = currentTimetable.cools![coolIndex - 1];
                    if (prevCool.entries.length > 0) {
                      const lastEntry = prevCool.entries[prevCool.entries.length - 1];
                      return lastEntry.endTime;
                    }
                    return undefined;
                  })()
                : currentTimetable.startTime; // 第1クールの場合は開始時刻を使用

              // 次のクールの開始時刻を取得（警告表示用）
              const nextCoolStartTime = coolIndex < currentTimetable.cools!.length - 1
                ? currentTimetable.cools![coolIndex + 1].startTime
                : undefined;

              const isFirstCool = coolIndex === 0;
              const isLastCool = coolIndex === currentTimetable.cools!.length - 1;

              return (
                <div key={cool.id}>
                  {/* クールの前のギャップ（最初のクールのみ、上部パディング付き） */}
                  {isFirstCool && (
                    <div className="pt-6">
                      <CoolGapDropZone
                        id={`cool-gap-before-${coolIndex}`}
                      />
                    </div>
                  )}

                  <CoolSection
                    cool={cool}
                    coolIndex={coolIndex}
                    totalCools={currentTimetable.cools!.length}
                    bands={bands}
                    overEntryId={overEntryId}
                    onRemoveEntry={(entryId) => onRemoveEntry(entryId, coolIndex)}
                    onDeleteCool={onDeleteCool}
                    onMoveCoolUp={onMoveCoolUp}
                    onMoveCoolDown={onMoveCoolDown}
                    isReadOnly={isReadOnly}
                    rehearsalType={rehearsalType}
                    onTransitionTimeChange={onTransitionTimeChange}
                    onCoolStartTimeChange={onCoolStartTimeChange}
                    previousCoolEndTime={previousCoolEndTime}
                    nextCoolStartTime={nextCoolStartTime}
                    dailyStartTime={currentTimetable.startTime}
                    violations={violations.filter(v => v.coolId === cool.id)}
                    bandNumbers={bandNumbers}
                    searchQuery={searchQuery}
                  />

                  {/* クールの後のギャップ */}
                  {!isLastCool ? (
                    <CoolGapDropZone
                      id={`cool-gap-after-${coolIndex}`}
                    />
                  ) : (
                    <div className="pb-6 min-h-[100px]">
                      <CoolGapDropZone
                        id={`cool-gap-after-${coolIndex}`}
                        className="h-full min-h-[76px]"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <TimetableDropZone
            entries={currentTimetable.entries}
            bands={bands}
            overEntryId={overEntryId}
            onRemoveEntry={onRemoveEntry}
            onTransitionTimeChange={onTransitionTimeChange}
            violations={violations}
            bandNumbers={bandNumbers}
            searchQuery={searchQuery}
          />
        )}
      </div>
    </div>
  );
};
