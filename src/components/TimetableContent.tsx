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
  timetableType: 'performance' | 'rehearsal';
  rehearsalType: 'rehearsal-day' | 'cool-pre-rehearsal' | 'day-start-rehearsal' | 'none';
  linkedRehearsalDailyTimetable?: DailyTimetable;
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
  timetableType,
  rehearsalType,
  linkedRehearsalDailyTimetable,
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
              const getCoolEndTime = (targetCool?: DailyTimetable['cools'][number]) => {
                if (!targetCool || targetCool.entries.length === 0) return undefined;
                return targetCool.entries[targetCool.entries.length - 1]?.endTime;
              };

              // クール直前リハの本番表示では、同じクールのリハ終了時刻を継続元として優先
              const linkedRehearsalEndTime =
                rehearsalType === 'cool-pre-rehearsal' && timetableType === 'performance'
                  ? getCoolEndTime(linkedRehearsalDailyTimetable?.cools?.[coolIndex])
                  : undefined;

              // 前のクール終了時刻（通常の継続元）
              const previousCoolEndTimeInSameTable = coolIndex > 0
                ? getCoolEndTime(currentTimetable.cools?.[coolIndex - 1])
                : currentTimetable.startTime;

              const previousCoolEndTime = linkedRehearsalEndTime || previousCoolEndTimeInSameTable;
              const overlapBaselineTime = linkedRehearsalEndTime || previousCoolEndTimeInSameTable;

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
                    overlapBaselineTime={overlapBaselineTime}
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
