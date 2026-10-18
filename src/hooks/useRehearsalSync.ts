import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { timetableService } from '../services/firestore';
import { filterCoolPreRehearsalEntries } from '../utils/coolPreRehearsal';
import { getFirstCoolStartTime, recalculateRehearsalCoolTimes } from '../utils/timetableTimeUtils';
import { minimumCoolBreakMinutes } from '../utils/coolBreak';
import type { Band, Cool, DailyTimetable, EventSettings, Timetable } from '../types';

interface UseRehearsalSyncParams {
  eventId: string | undefined;
  eventSettings: EventSettings | null;
  bands: Band[];
  performanceTimetable: Timetable | null;
  rehearsalTimetable: Timetable | null;
  hasCompletedInitialTimetableSync: boolean;
  setHasCompletedInitialTimetableSync: Dispatch<SetStateAction<boolean>>;
  isInitialTimetableSyncInFlightRef: MutableRefObject<boolean>;
}

/** クール直前リハのクール構造だけを本番に合わせる。手動配置は維持する。 */
export const useRehearsalSync = ({
  eventId,
  eventSettings,
  performanceTimetable,
  rehearsalTimetable,
  hasCompletedInitialTimetableSync,
  setHasCompletedInitialTimetableSync,
  isInitialTimetableSyncInFlightRef,
}: UseRehearsalSyncParams) => {
  const lastSyncedPerformanceRef = useRef('');
  const performanceSignature = JSON.stringify(performanceTimetable?.dailyTimetables ?? []);

  useEffect(() => {
    if (!eventId || !eventSettings || !performanceTimetable || !rehearsalTimetable) return;
    if (eventSettings.rehearsalType !== 'cool-pre-rehearsal') return;
    if (hasCompletedInitialTimetableSync && lastSyncedPerformanceRef.current === performanceSignature) return;
    if (isInitialTimetableSyncInFlightRef.current) return;

    isInitialTimetableSyncInFlightRef.current = true;
    let cancelled = false;
    const releaseTimeoutId = window.setTimeout(() => {
      if (!cancelled) setHasCompletedInitialTimetableSync(true);
      isInitialTimetableSyncInFlightRef.current = false;
    }, 8000);

    const sync = async () => {
      await timetableService.syncCoolPreRehearsal(
        performanceTimetable.id,
        rehearsalTimetable.id,
        (latestPerformance, latestRehearsal) => {
          const days = new Map(latestRehearsal.dailyTimetables.map(day => [day.date, day]));
          let changed = !latestRehearsal.rehearsalInitialized;

          for (const performanceDay of latestPerformance.dailyTimetables) {
            const rehearsalDay: DailyTimetable = days.get(performanceDay.date) ?? {
              date: performanceDay.date, startTime: '10:00', cools: [], entries: [],
            };
            const unifiedStartTime = performanceDay.startTime
              || getFirstCoolStartTime(performanceDay)
              || getFirstCoolStartTime(rehearsalDay)
              || rehearsalDay.startTime
              || '10:00';

            const cools: Cool[] = performanceDay.cools.map((performanceCool, index) => {
              const existing = rehearsalDay.cools?.[index];
              return {
                id: existing?.id || performanceCool.id,
                number: performanceCool.number,
                ...(existing?.startTime ? { startTime: existing.startTime } : {}),
                // 本番にあるバンドだけを許可するが、バンクから自動追加しない。
                entries: filterCoolPreRehearsalEntries(existing?.entries || [], performanceDay, index)
                  .map((entry, order) => ({ ...entry, order })),
              };
            });
            const updatedDay: DailyTimetable = {
              ...rehearsalDay,
              startTime: unifiedStartTime,
              cools: recalculateRehearsalCoolTimes(
                cools, unifiedStartTime, eventSettings.rehearsalDuration || 0, performanceDay.cools, minimumCoolBreakMinutes(rehearsalDay),
              ),
            };
            if (JSON.stringify(rehearsalDay) !== JSON.stringify(updatedDay)) {
              days.set(updatedDay.date, updatedDay);
              changed = true;
            }
          }

          return changed ? { dailyTimetables: [...days.values()], rehearsalInitialized: true } : null;
        },
      );
      if (!cancelled) {
        lastSyncedPerformanceRef.current = performanceSignature;
        setHasCompletedInitialTimetableSync(true);
      }
    };

    sync().catch(error => {
      console.error('[クール直前リハ自動同期] 失敗:', error);
      if (!cancelled) setHasCompletedInitialTimetableSync(true);
    }).finally(() => {
      window.clearTimeout(releaseTimeoutId);
      isInitialTimetableSyncInFlightRef.current = false;
    });

    return () => {
      cancelled = true;
      window.clearTimeout(releaseTimeoutId);
      isInitialTimetableSyncInFlightRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, eventSettings?.rehearsalType, eventSettings?.rehearsalDuration,
    performanceTimetable?.id, rehearsalTimetable?.id, performanceSignature, hasCompletedInitialTimetableSync]);
};
