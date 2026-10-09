import type { MutableRefObject } from 'react';
import { timetableService } from '../services/firestore';
import {
  getFirstCoolStartTime,
  normalizeFirstCoolStartTime,
  isSameDailyTimetable,
  getRehearsalEndTime,
  recalculatePerformanceEntryTimes,
  recalculatePerformanceCoolTimes,
  recalculateRehearsalCoolTimes,
} from '../utils/timetableTimeUtils';
import type { Band, EventSettings, Timetable, DailyTimetable } from '../types';

interface UseTimetableChangeHandlersParams {
  performanceTimetable: Timetable | null;
  rehearsalTimetable: Timetable | null;
  eventSettings: EventSettings | null;
  bands: Band[];
  lastSavedPerformanceHashRef: MutableRefObject<string>;
  lastSavedRehearsalHashRef: MutableRefObject<string>;
}

/**
 * 本番・リハーサルの日別タイムテーブル変更を正規化・再計算してFirestoreに保存するハンドラー群。
 */
export const useTimetableChangeHandlers = ({
  performanceTimetable,
  rehearsalTimetable,
  eventSettings,
  bands,
  lastSavedPerformanceHashRef,
  lastSavedRehearsalHashRef,
}: UseTimetableChangeHandlersParams) => {
  // 日別タイムテーブルの変更を処理（本番用）
  const handlePerformanceTimetableChange = async (updatedDailyTimetable: DailyTimetable) => {
    if (!performanceTimetable || !eventSettings) return;

    let normalizedDailyTimetable = updatedDailyTimetable;
    if (eventSettings.rehearsalType === 'cool-pre-rehearsal') {
      const linkedRehearsalTimetable = rehearsalTimetable?.dailyTimetables.find(
        dt => dt.date === updatedDailyTimetable.date
      );
      const unifiedStartTime = updatedDailyTimetable.startTime
        || getFirstCoolStartTime(updatedDailyTimetable)
        || getFirstCoolStartTime(linkedRehearsalTimetable)
        || linkedRehearsalTimetable?.startTime
        || '10:00';

      const normalized = normalizeFirstCoolStartTime(updatedDailyTimetable, unifiedStartTime);
      normalizedDailyTimetable = {
        ...normalized,
        cools: normalized.cools && normalized.cools.length > 0
          ? recalculatePerformanceCoolTimes(normalized.cools, unifiedStartTime, bands, linkedRehearsalTimetable?.cools)
          : normalized.cools,
      };
    }

    console.log('[本番TT変更] 日付:', normalizedDailyTimetable.date, 'クール数:', normalizedDailyTimetable.cools?.length || 0);

    // クール番号と重複保存の判定に使う表示中のスナップショット
    const updatedDailyTimetables = performanceTimetable.dailyTimetables.map(dt =>
      dt.date === normalizedDailyTimetable.date ? normalizedDailyTimetable : dt
    ).concat(
      // 新しい日付の場合は追加
      performanceTimetable.dailyTimetables.some(dt => dt.date === normalizedDailyTimetable.date)
        ? []
        : [normalizedDailyTimetable]
    );

    // 変更された日付以降の全ての日付のクール番号を再計算
    const sortedDates = [...eventSettings.performanceDates].sort();
    const changedIndex = sortedDates.indexOf(normalizedDailyTimetable.date);

    console.log('[本番TT変更] 変更日付インデックス:', changedIndex, '全日付数:', sortedDates.length);

    if (changedIndex >= 0) {
      let cumulativeCoolCount = 0;

      // 変更された日付までのクール数を計算
      for (let i = 0; i < changedIndex; i++) {
        const dt = updatedDailyTimetables.find(d => d.date === sortedDates[i]);
        if (dt && dt.cools) {
          cumulativeCoolCount += dt.cools.length;
        }
      }

      console.log('[本番TT変更] 変更前の累積クール数:', cumulativeCoolCount);

      // 変更された日付以降のクール番号を再計算
      for (let i = changedIndex; i < sortedDates.length; i++) {
        const date = sortedDates[i];
        const dtIndex = updatedDailyTimetables.findIndex(d => d.date === date);

        if (dtIndex >= 0 && updatedDailyTimetables[dtIndex].cools) {
          const baseNumber = cumulativeCoolCount + 1;
          console.log(`[本番TT変更] ${date}: ベース番号=${baseNumber}, クール数=${updatedDailyTimetables[dtIndex].cools!.length}`);

          updatedDailyTimetables[dtIndex] = {
            ...updatedDailyTimetables[dtIndex],
            cools: updatedDailyTimetables[dtIndex].cools!.map((cool, index) => ({
              ...cool,
              number: baseNumber + index,
            })),
          };
          cumulativeCoolCount += updatedDailyTimetables[dtIndex].cools!.length;
        }
      }
    }

    const updatedTimetable = {
      ...performanceTimetable,
      dailyTimetables: updatedDailyTimetables,
    };

    // 状態の反映は Firestore の onSnapshot に任せる。

    console.log('[本番TT変更] Firestore書き込み開始');

    // 最新のドキュメントを基に変更日だけ保存する。
    try {
      const nextHash = JSON.stringify(updatedTimetable.dailyTimetables);
      if (lastSavedPerformanceHashRef.current === nextHash) {
        console.log('[本番TT変更] 同一内容のため保存スキップ');
        return;
      }

      await timetableService.updateDailyTimetable(
        performanceTimetable.id,
        normalizedDailyTimetable,
        eventSettings.performanceDates
      );
      console.log('[本番TT変更] Firestore日別保存成功');
    } catch (error) {
      console.error('タイムテーブル更新エラー:', error);
      alert('タイムテーブルの更新に失敗しました。');
    }

    // クール直前リハーサルの同期は useEffect 側で一元実行（相互更新ループを防止）
  };

  // 日別タイムテーブルの変更を処理（リハーサル用）
  const handleRehearsalTimetableChange = async (updatedDailyTimetable: DailyTimetable) => {
    if (!rehearsalTimetable || !eventSettings) return;

    let normalizedDailyTimetable = updatedDailyTimetable;
    if (eventSettings.rehearsalType === 'cool-pre-rehearsal') {
      const unifiedStartTime = updatedDailyTimetable.startTime
        || getFirstCoolStartTime(updatedDailyTimetable)
        || '10:00';
      const normalized = normalizeFirstCoolStartTime(updatedDailyTimetable, unifiedStartTime);
      const linkedPerformanceDaily = performanceTimetable?.dailyTimetables.find(
        dt => dt.date === updatedDailyTimetable.date
      );
      normalizedDailyTimetable = {
        ...normalized,
        cools: normalized.cools && normalized.cools.length > 0
          ? recalculateRehearsalCoolTimes(normalized.cools, unifiedStartTime, eventSettings.rehearsalDuration || 0, linkedPerformanceDaily?.cools)
          : normalized.cools,
      };
    }

    console.log('[リハTT変更] 日付:', normalizedDailyTimetable.date, 'クール数:', normalizedDailyTimetable.cools?.length || 0);

    // クール番号と重複保存の判定に使う表示中のスナップショット
    const updatedDailyTimetables = rehearsalTimetable.dailyTimetables.map(dt =>
      dt.date === normalizedDailyTimetable.date ? normalizedDailyTimetable : dt
    ).concat(
      // 新しい日付の場合は追加
      rehearsalTimetable.dailyTimetables.some(dt => dt.date === normalizedDailyTimetable.date)
        ? []
        : [normalizedDailyTimetable]
    );

    // 日付リストを取得
    const dateList = (eventSettings.rehearsalType === 'cool-pre-rehearsal' || eventSettings.rehearsalType === 'day-start-rehearsal')
      ? eventSettings.performanceDates
      : eventSettings.rehearsalDates || [];

    // 変更された日付以降の全ての日付のクール番号を再計算
    const sortedDates = [...dateList].sort();
    const changedIndex = sortedDates.indexOf(normalizedDailyTimetable.date);

    console.log('[リハTT変更] 変更日付インデックス:', changedIndex, '全日付数:', sortedDates.length);

    if (changedIndex >= 0) {
      let cumulativeCoolCount = 0;

      // 変更された日付までのクール数を計算
      for (let i = 0; i < changedIndex; i++) {
        const dt = updatedDailyTimetables.find(d => d.date === sortedDates[i]);
        if (dt && dt.cools) {
          cumulativeCoolCount += dt.cools.length;
        }
      }

      console.log('[リハTT変更] 変更前の累積クール数:', cumulativeCoolCount);

      // 変更された日付以降のクール番号を再計算
      for (let i = changedIndex; i < sortedDates.length; i++) {
        const date = sortedDates[i];
        const dtIndex = updatedDailyTimetables.findIndex(d => d.date === date);

        if (dtIndex >= 0 && updatedDailyTimetables[dtIndex].cools) {
          const baseNumber = cumulativeCoolCount + 1;
          console.log(`[リハTT変更] ${date}: ベース番号=${baseNumber}, クール数=${updatedDailyTimetables[dtIndex].cools!.length}`);

          updatedDailyTimetables[dtIndex] = {
            ...updatedDailyTimetables[dtIndex],
            cools: updatedDailyTimetables[dtIndex].cools!.map((cool, index) => ({
              ...cool,
              number: baseNumber + index,
            })),
          };
          cumulativeCoolCount += updatedDailyTimetables[dtIndex].cools!.length;
        }
      }
    }

    const updatedTimetable = {
      ...rehearsalTimetable,
      dailyTimetables: updatedDailyTimetables,
    };

    // 楽観的更新を削除：onSnapshotによる自動更新に任せる

    console.log('[リハTT変更] Firestore書き込み開始');

    // 最新のドキュメントを基に変更日だけ保存する。
    try {
      const nextHash = JSON.stringify(updatedTimetable.dailyTimetables);
      if (lastSavedRehearsalHashRef.current === nextHash) {
        console.log('[リハTT変更] 同一内容のため保存スキップ');
        return;
      }

      await timetableService.updateDailyTimetable(
        rehearsalTimetable.id,
        normalizedDailyTimetable,
        dateList
      );
      console.log('[リハTT変更] Firestore日別保存成功');
    } catch (error) {
      console.error('タイムテーブル更新エラー:', error);
      alert('タイムテーブルの更新に失敗しました。');
    }

    // クール直前リハーサルでは、開始時刻を「第1クールのリハ開始時刻」に統一して本番へ反映
    if (eventSettings.rehearsalType === 'cool-pre-rehearsal' && performanceTimetable) {
      const unifiedStartTime = normalizedDailyTimetable.startTime
        || getFirstCoolStartTime(normalizedDailyTimetable)
        || '10:00';
      const performanceDt = performanceTimetable.dailyTimetables.find(
        dt => dt.date === normalizedDailyTimetable.date
      );

      if (performanceDt) {
        const normalizedPerformanceDt = normalizeFirstCoolStartTime(performanceDt, unifiedStartTime);
        const updatedPerformanceDt: DailyTimetable = {
          ...normalizedPerformanceDt,
          ...(normalizedPerformanceDt.cools && normalizedPerformanceDt.cools.length > 0
            ? { cools: recalculatePerformanceCoolTimes(normalizedPerformanceDt.cools, unifiedStartTime, bands, normalizedDailyTimetable.cools) }
            : { entries: recalculatePerformanceEntryTimes(normalizedPerformanceDt.entries || [], unifiedStartTime, bands) }
          ),
        };

        if (isSameDailyTimetable(performanceDt, updatedPerformanceDt)) {
          console.log('[リハTT変更] 本番側は差分なしのため同期スキップ');
        } else {
        try {
          await timetableService.updateDailyTimetable(
            performanceTimetable.id, updatedPerformanceDt
          );
          console.log('[リハTT変更] クール直前リハの本番開始時刻を同期:', unifiedStartTime);
        } catch (error) {
          console.error('[リハTT変更] クール直前リハ同期エラー:', error);
        }
        }
      }
    }

    // 当日一括リハーサルの場合、リハーサル終了時刻が本番開始時刻を超えるときのみ自動反映
    if (eventSettings.rehearsalType === 'day-start-rehearsal' && performanceTimetable) {
      const rehearsalEndTime = getRehearsalEndTime(normalizedDailyTimetable);
      if (rehearsalEndTime) {
        const performanceDt = performanceTimetable.dailyTimetables.find(
          dt => dt.date === normalizedDailyTimetable.date
        );
        // リハーサル終了時刻が本番開始時刻を超える場合のみ更新（早く終わった場合は変更しない）
        if (performanceDt && rehearsalEndTime > performanceDt.startTime) {
          const updatedPerformanceDt: DailyTimetable = {
            ...performanceDt,
            startTime: rehearsalEndTime,
            ...(performanceDt.cools && performanceDt.cools.length > 0
              ? { cools: recalculatePerformanceCoolTimes(performanceDt.cools, rehearsalEndTime, bands) }
              : { entries: recalculatePerformanceEntryTimes(performanceDt.entries || [], rehearsalEndTime, bands) }
            ),
          };
          // onSnapshotによる自動更新に任せる（楽観的更新を削除）
          // Firestoreに保存
          try {
            await timetableService.updateDailyTimetable(
              performanceTimetable.id, updatedPerformanceDt
            );
            console.log('[リハTT変更] 本番開始時刻を自動更新:', rehearsalEndTime);
          } catch (error) {
            console.error('[リハTT変更] 本番開始時刻の更新エラー:', error);
          }
        }
      }
    }
  };

  return {
    handlePerformanceTimetableChange,
    handleRehearsalTimetableChange,
  };
};
