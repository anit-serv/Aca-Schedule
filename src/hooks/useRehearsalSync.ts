import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { timetableService } from '../services/firestore';
import { generateUUID } from '../utils/generateUUID';
import {
  getFirstCoolStartTime,
  isSameDailyTimetable,
  recalculateRehearsalCoolTimes,
} from '../utils/timetableTimeUtils';
import type { Band, Cool, DailyTimetable, EventSettings, Timetable, TimetableEntry } from '../types';

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

/**
 * リハーサルタイムテーブルの自動同期処理（副作用専用フック）。
 * - バンドが追加されたときにリハーサルタイムテーブルへ自動追加する
 * - クール直前リハーサルの場合、本番タイムテーブルの変更を監視してリハーサルタイムテーブルを同期する
 */
export const useRehearsalSync = ({
  eventId,
  eventSettings,
  bands,
  performanceTimetable,
  rehearsalTimetable,
  hasCompletedInitialTimetableSync,
  setHasCompletedInitialTimetableSync,
  isInitialTimetableSyncInFlightRef,
}: UseRehearsalSyncParams) => {
  // バンドが追加されたときにリハーサルタイムテーブルに自動追加
  useEffect(() => {
    if (!eventId || !eventSettings || !rehearsalTimetable) return;

    const addNewBandsToRehearsalTimetable = async () => {
      // リハーサルタイムテーブルが未作成、またはリハーサルが無効な場合はスキップ
      if (eventSettings.rehearsalType === 'none' || bands.length === 0) {
        return;
      }

      // クール直前リハーサルの場合は自動追加しない（本番と同期する）
      if (eventSettings.rehearsalType === 'cool-pre-rehearsal') {
        return;
      }

      // 当日一括リハーサルの場合は自動追加しない（ユーザーが手動でリハ順を編集する）
      if (eventSettings.rehearsalType === 'day-start-rehearsal') {
        return;
      }

      console.log('[リハーサル自動追加] バンド数:', bands.length);

      // 各日付のリハーサルタイムテーブルに新しいバンドを追加
      const rehearsalType = eventSettings.rehearsalType;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dates = (['cool-pre-rehearsal', 'day-start-rehearsal'] as const).includes(rehearsalType as any)
        ? eventSettings.performanceDates
        : eventSettings.rehearsalDates || [];

      if (dates.length === 0) {
        console.log('[リハーサル自動追加] 日付が設定されていません');
        return;
      }

      // リハーサルタイムテーブルに既に配置されているバンドIDを取得
      const placedBandIds = new Set<string>();
      rehearsalTimetable.dailyTimetables.forEach((dt) => {
        dt.cools?.forEach((cool) => {
          cool.entries.forEach((entry) => {
            if (entry.type === 'band' && entry.bandId) {
              placedBandIds.add(entry.bandId);
            }
          });
        });
        dt.entries?.forEach((entry) => {
          if (entry.type === 'band' && entry.bandId) {
            placedBandIds.add(entry.bandId);
          }
        });
      });

      // まだ配置されていない新しいバンドを見つける
      const newBands = bands.filter(band => !placedBandIds.has(band.id));

      if (newBands.length === 0) {
        console.log('[リハーサル自動追加] 新しいバンドなし');
        return;
      }

      console.log('[リハーサル自動追加] 新しいバンド:', newBands.map(b => b.name));

      const sortedDates = [...dates].sort();
      const dailyTimetableByDate = new Map(
        rehearsalTimetable.dailyTimetables.map((dt) => [dt.date, dt] as const)
      );
      let hasChanges = false;

      for (const date of dates) {
        let dailyTimetable = dailyTimetableByDate.get(date);

        // その日のタイムテーブルが存在しない場合は作成
        if (!dailyTimetable) {
          // 基本となるクール番号を計算
          let baseCoolNumber = 1;
          for (const d of sortedDates) {
            if (d === date) break;
            const dt = dailyTimetableByDate.get(d);
            if (dt && dt.cools && dt.cools.length > 0) {
              baseCoolNumber += dt.cools.length;
            }
          }

          dailyTimetable = {
            date,
            startTime: '10:00',
            cools: [{
              id: generateUUID(),
              number: baseCoolNumber,
              entries: [],
            }],
            entries: [],
          };
          hasChanges = true;
        }

        // 当日リハーサル(クール直前/当日一括)の場合は本番タイムテーブルのバンドのみ
        let bandsToAdd = newBands;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((['cool-pre-rehearsal', 'day-start-rehearsal'] as const).includes(eventSettings.rehearsalType as any) && performanceTimetable) {
          const performanceDailyTimetable = performanceTimetable.dailyTimetables.find(
            (dt) => dt.date === date
          );

          if (performanceDailyTimetable) {
            const performanceBandIds = new Set<string>();

            performanceDailyTimetable.cools?.forEach((cool) => {
              cool.entries.forEach((entry) => {
                if (entry.type === 'band' && entry.bandId) {
                  performanceBandIds.add(entry.bandId);
                }
              });
            });

            performanceDailyTimetable.entries?.forEach((entry) => {
              if (entry.type === 'band' && entry.bandId) {
                performanceBandIds.add(entry.bandId);
              }
            });

            bandsToAdd = newBands.filter(band => performanceBandIds.has(band.id));
          }
        }

        if (bandsToAdd.length === 0) {
          console.log(`[リハーサル自動追加] ${date}: 追加するバンドなし`);
          continue;
        }

        console.log(`[リハーサル自動追加] ${date}: ${bandsToAdd.length}バンド追加`);

        // クール構造がない場合は作成
        if (!dailyTimetable.cools || dailyTimetable.cools.length === 0) {
          // 基本となるクール番号を計算
          let baseCoolNumber = 1;
          for (const d of sortedDates) {
            if (d === date) break;
            const dt = dailyTimetableByDate.get(d);
            if (dt && dt.cools && dt.cools.length > 0) {
              baseCoolNumber += dt.cools.length;
            }
          }

          dailyTimetable = {
            ...dailyTimetable,
            cools: [{
              id: generateUUID(),
              number: baseCoolNumber,
              entries: [],
            }],
          };
          hasChanges = true;
        }

        // 新しいバンドをエントリーとして作成
        const newEntries = bandsToAdd.map((band) => ({
          id: generateUUID(),
          type: 'band' as const,
          bandId: band.id,
          startTime: '',
          endTime: '',
          order: dailyTimetable!.cools![0].entries.length,
        }));

        // 第1クールに追加
        const updatedCools = [...dailyTimetable.cools];
        updatedCools[0] = {
          ...updatedCools[0],
          entries: [...updatedCools[0].entries, ...newEntries],
        };

        const updatedDailyTimetable = {
          ...dailyTimetable,
          cools: updatedCools,
        };

        dailyTimetableByDate.set(date, updatedDailyTimetable);
        hasChanges = true;
      }

      if (!hasChanges) {
        return;
      }

      const mergedDailyTimetables = [...dailyTimetableByDate.values()];

      try {
        await timetableService.updateTimetable(rehearsalTimetable.id, {
          dailyTimetables: mergedDailyTimetables,
        });
        console.log(`[リハーサル自動追加] 一括保存成功: ${mergedDailyTimetables.length}日分`);
      } catch (error) {
        console.error('[リハーサル自動追加] 一括保存エラー', error);
      }
    };

    addNewBandsToRehearsalTimetable();
    // 依存配列からrehearsalTimetableを削除して、無限ループと重複追加を防ぐ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bands, performanceTimetable, eventSettings, eventId]);

  // クール直前リハーサルの場合、本番タイムテーブルの変更を監視してリハーサルタイムテーブルを同期
  useEffect(() => {
    if (!eventSettings || !performanceTimetable || !rehearsalTimetable) return;
    if (eventSettings.rehearsalType !== 'cool-pre-rehearsal') return;
    if (hasCompletedInitialTimetableSync) return;
    if (isInitialTimetableSyncInFlightRef.current) return;

    isInitialTimetableSyncInFlightRef.current = true;

    // クール直前リハーサルのタイムテーブルを本番と同期（内部用）
    const syncCoolPreRehearsalTimetableInternal = async (performanceDailyTimetable: DailyTimetable) => {
      if (!rehearsalTimetable || !eventSettings) return;

      console.log('[クール直前リハ同期] 開始:', performanceDailyTimetable.date);

      // 本番のクール構造を取得
      const performanceCools = performanceDailyTimetable.cools || [];

      // 本番の各クールに含まれるバンドIDを取得（重複排除）
      const coolBandIds: string[][] = performanceCools.map(cool => {
        const bandIds = new Set<string>();
        cool.entries.forEach(entry => {
          if (entry.type === 'band' && entry.bandId) {
            bandIds.add(entry.bandId);
          }
        });
        return Array.from(bandIds);
      });

      // リハーサルのDailyTimetableを作成/更新
      const rehearsalDailyTimetable = rehearsalTimetable.dailyTimetables.find(
        dt => dt.date === performanceDailyTimetable.date
      ) || {
        date: performanceDailyTimetable.date,
        startTime: '10:00',
        cools: [],
        entries: [],
      };

      const unifiedStartTime = performanceDailyTimetable.startTime
        || getFirstCoolStartTime(performanceDailyTimetable)
        || getFirstCoolStartTime(rehearsalDailyTimetable)
        || rehearsalDailyTimetable.startTime
        || '10:00';

      // リハーサルのクールを本番と同じ数にする
      const rehearsalCools: Cool[] = performanceCools.map((performanceCool, index) => {
        const bandIdsInCool = coolBandIds[index];
        const existingCool = rehearsalDailyTimetable.cools?.[index];

        // このクールのリハーサルエントリを作成（既存IDを優先して保持）
        const rehearsalEntries: TimetableEntry[] = bandIdsInCool.map((bandId, entryIndex) => {
          const existingEntry = existingCool?.entries.find(
            entry => entry.type === 'band' && entry.bandId === bandId
          );
          return {
            id: existingEntry?.id || generateUUID(),
            type: 'band' as const,
            bandId: bandId,
            startTime: existingEntry?.startTime || '',
            endTime: existingEntry?.endTime || '',
            order: entryIndex,
          };
        });

        const rehearsalCool: Cool = {
          id: existingCool?.id || performanceCool.id,
          number: performanceCool.number,
          entries: rehearsalEntries,
        };

        if (existingCool?.startTime) {
          return {
            ...rehearsalCool,
            startTime: existingCool.startTime,
          };
        }

        return rehearsalCool;
      });

      const updatedRehearsalDailyTimetable: DailyTimetable = {
        ...rehearsalDailyTimetable,
        startTime: unifiedStartTime,
        cools: recalculateRehearsalCoolTimes(rehearsalCools, unifiedStartTime, eventSettings.rehearsalDuration || 0, performanceCools),
      };

      if (isSameDailyTimetable(rehearsalDailyTimetable, updatedRehearsalDailyTimetable)) {
        console.log('[クール直前リハ同期] 差分なしのため保存スキップ');
        return;
      }

      // Firestoreに保存
      try {
        await timetableService.updateDailyTimetable(rehearsalTimetable.id, updatedRehearsalDailyTimetable);
        console.log('[クール直前リハ同期] 保存成功');
      } catch (error) {
        console.error('[クール直前リハ同期] エラー:', error);
      }
    };

    let cancelled = false;
    const releaseTimeoutId = window.setTimeout(() => {
      if (!cancelled) {
        console.warn('[クール直前リハ自動同期] 初回同期の待機をタイムアウト解除');
        setHasCompletedInitialTimetableSync(true);
      }
      isInitialTimetableSyncInFlightRef.current = false;
    }, 8000);

    const syncAllDates = async () => {
      console.log('[クール直前リハ自動同期] 開始');
      const performanceDailyTimetables = performanceTimetable.dailyTimetables || [];

      // すべての本番日付について同期
      for (const performanceDailyTimetable of performanceDailyTimetables) {
        await syncCoolPreRehearsalTimetableInternal(performanceDailyTimetable);
      }

      console.log('[クール直前リハ自動同期] 完了');

      if (!cancelled) {
        window.clearTimeout(releaseTimeoutId);
        setHasCompletedInitialTimetableSync(true);
      }
      isInitialTimetableSyncInFlightRef.current = false;
    };

    syncAllDates().catch((error) => {
      console.error('[クール直前リハ自動同期] 失敗:', error);
      if (!cancelled) {
        window.clearTimeout(releaseTimeoutId);
        setHasCompletedInitialTimetableSync(true);
      }
      isInitialTimetableSyncInFlightRef.current = false;
    });

    return () => {
      cancelled = true;
      window.clearTimeout(releaseTimeoutId);
      isInitialTimetableSyncInFlightRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, eventSettings?.rehearsalType, performanceTimetable?.id, rehearsalTimetable?.id, hasCompletedInitialTimetableSync]);
};
