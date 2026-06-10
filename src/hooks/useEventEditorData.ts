import { useState, useEffect, useRef } from 'react';
import { bandService, timetableService, eventService } from '../services/firestore';
import type { Band, EventSettings, Timetable } from '../types';

// モードを定義するための型
export type Mode = 'band-management' | 'timetable-editing';

/**
 * EventEditorPage のデータ読み込み（バンド・イベント設定・タイムテーブル）に関する
 * 状態管理とFirestore購読をまとめたフック。
 */
export const useEventEditorData = (eventId: string | undefined) => {
  // 現在のモードを管理するための状態
  const [mode, setMode] = useState<Mode>('band-management');

  // バンドとイベント設定の状態管理
  const [bands, setBands] = useState<Band[]>([]);
  const [eventSettings, setEventSettings] = useState<EventSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [bandsLoaded, setBandsLoaded] = useState(false);
  const [hasCompletedInitialTimetableSync, setHasCompletedInitialTimetableSync] = useState(false);
  const [performanceTimetableLoaded, setPerformanceTimetableLoaded] = useState(false);
  const [rehearsalTimetableLoaded, setRehearsalTimetableLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // タイムテーブルの状態管理
  const [performanceTimetable, setPerformanceTimetable] = useState<Timetable | null>(null);
  const [rehearsalTimetable, setRehearsalTimetable] = useState<Timetable | null>(null);

  // 初回モード自動判定用
  const initialModeSetRef = useRef(false);

  // ハンドラーのstale closure回避用ref
  const performanceTimetableRef = useRef<Timetable | null>(null);
  const rehearsalTimetableRef = useRef<Timetable | null>(null);
  const eventSettingsRef = useRef<EventSettings | null>(null);
  const bandsRef = useRef<Band[]>([]);
  const isInitialTimetableSyncInFlightRef = useRef(false);
  const initialCreateAttemptedRef = useRef<{ performance: boolean; rehearsal: boolean }>({
    performance: false,
    rehearsal: false,
  });
  const lastSavedPerformanceHashRef = useRef<string>('');
  const lastSavedRehearsalHashRef = useRef<string>('');

  useEffect(() => {
    setHasCompletedInitialTimetableSync(false);
    setPerformanceTimetableLoaded(false);
    setRehearsalTimetableLoaded(false);
    isInitialTimetableSyncInFlightRef.current = false;
    initialCreateAttemptedRef.current = {
      performance: false,
      rehearsal: false,
    };
  }, [eventId]);

  // イベント設定のリアルタイム監視（権限はく奪を即時検出）
  useEffect(() => {
    if (!eventId) {
      setError('not-found');
      setIsLoading(false);
      return;
    }

    console.log('[EventEditorPage] イベントリアルタイム監視開始:', eventId);
    const unsubscribe = eventService.subscribeToEvent(
      eventId,
      (settings) => {
        if (!settings) {
          console.error('[EventEditorPage] イベントが見つかりません:', eventId);
          setError('not-found');
          setIsLoading(false);
          return;
        }
        setEventSettings(settings);
        setIsLoading(false);
      },
      (err) => {
        console.error('[EventEditorPage] イベント監視エラー:', err);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const errorCode = (err as any)?.code;

        // permission-deniedはアクセス権はく奪
        if (errorCode === 'permission-denied' || errorCode === 'not-found') {
          setError('not-found');
        } else if (errorCode === 'resource-exhausted') {
          setError('quota-exceeded');
        } else {
          setError('unknown');
        }
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [eventId]);

  // バンドデータの読み込み
  useEffect(() => {
    if (!eventId) return;

    // リアルタイム監視を設定
    const unsubscribe = bandService.subscribeToBands(
      eventId,
      (fetchedBands) => {
        setBands(fetchedBands);
        setBandsLoaded(true);
        // 初回読み込み時: バンドが1つ以上あればタイムテーブル編集画面を開く
        if (!initialModeSetRef.current) {
          initialModeSetRef.current = true;
          if (fetchedBands.length > 0) {
            setMode('timetable-editing');
          }
        }
      },
      (err) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const errorCode = (err as any)?.code;
        if (errorCode === 'permission-denied') {
          console.warn('[EventEditorPage] バンド監視: 権限はく奪を検出');
          setError('not-found');
        } else if (errorCode === 'resource-exhausted') {
          setError('quota-exceeded');
          setBandsLoaded(true);
        }
      }
    );

    // クリーンアップ
    return () => unsubscribe();
  }, [eventId]);

  // バンドが削除されたときにタイムテーブルからも削除
  useEffect(() => {
    if (!performanceTimetable || !rehearsalTimetable || bands.length === 0) return;

    const cleanupDeletedBands = async () => {
      const bandIds = new Set(bands.map(b => b.id));
      let performanceUpdated = false;
      let rehearsalUpdated = false;

      // 本番タイムテーブルから削除されたバンドを除去
      const updatedPerformanceTimetables = performanceTimetable.dailyTimetables.map(dt => {
        const cleanedCools = dt.cools?.map(cool => ({
          ...cool,
          entries: cool.entries.filter(entry => {
            if (entry.type === 'band' && entry.bandId && !bandIds.has(entry.bandId)) {
              performanceUpdated = true;
              console.log('[バンド削除クリーンアップ] 本番から削除:', entry.bandId);
              return false;
            }
            return true;
          })
        })) || [];

        const cleanedEntries = dt.entries?.filter(entry => {
          if (entry.type === 'band' && entry.bandId && !bandIds.has(entry.bandId)) {
            performanceUpdated = true;
            console.log('[バンド削除クリーンアップ] 本番から削除:', entry.bandId);
            return false;
          }
          return true;
        }) || [];

        return {
          ...dt,
          cools: cleanedCools,
          entries: cleanedEntries
        };
      });

      // リハーサルタイムテーブルから削除されたバンドを除去
      const updatedRehearsalTimetables = rehearsalTimetable.dailyTimetables.map(dt => {
        const cleanedCools = dt.cools?.map(cool => ({
          ...cool,
          entries: cool.entries.filter(entry => {
            if (entry.type === 'band' && entry.bandId && !bandIds.has(entry.bandId)) {
              rehearsalUpdated = true;
              console.log('[バンド削除クリーンアップ] リハーサルから削除:', entry.bandId);
              return false;
            }
            return true;
          })
        })) || [];

        const cleanedEntries = dt.entries?.filter(entry => {
          if (entry.type === 'band' && entry.bandId && !bandIds.has(entry.bandId)) {
            rehearsalUpdated = true;
            console.log('[バンド削除クリーンアップ] リハーサルから削除:', entry.bandId);
            return false;
          }
          return true;
        }) || [];

        return {
          ...dt,
          cools: cleanedCools,
          entries: cleanedEntries
        };
      });

      // 本番タイムテーブルを更新
      if (performanceUpdated) {
        try {
          for (const dt of updatedPerformanceTimetables) {
            await timetableService.updateDailyTimetable(performanceTimetable.id, dt);
          }
          console.log('[バンド削除クリーンアップ] 本番タイムテーブル更新完了');
        } catch (error) {
          console.error('[バンド削除クリーンアップ] 本番更新エラー:', error);
        }
      }

      // リハーサルタイムテーブルを更新
      if (rehearsalUpdated) {
        try {
          for (const dt of updatedRehearsalTimetables) {
            await timetableService.updateDailyTimetable(rehearsalTimetable.id, dt);
          }
          console.log('[バンド削除クリーンアップ] リハーサルタイムテーブル更新完了');
        } catch (error) {
          console.error('[バンド削除クリーンアップ] リハーサル更新エラー:', error);
        }
      }
    };

    cleanupDeletedBands();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bands.length]); // バンド数が変更されたときのみ実行

  // 本番タイムテーブルデータの読み込み
  useEffect(() => {
    if (!eventId) return;

    // リアルタイム監視を設定
    // Firestoreは書き込み時にローカルキャッシュを即座に更新するため、
    // onSnapshotが即座に発火し、UIは瞬時に更新される
    const unsubscribe = timetableService.subscribeTimetable(
      eventId,
      'performance',
      (fetchedTimetable) => {
        setPerformanceTimetable(fetchedTimetable);
        if (fetchedTimetable?.dailyTimetables) {
          lastSavedPerformanceHashRef.current = JSON.stringify(fetchedTimetable.dailyTimetables);
        }
        setPerformanceTimetableLoaded(true);
      },
      (err) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const errorCode = (err as any)?.code;
        if (errorCode === 'permission-denied') {
          console.warn('[EventEditorPage] TT監視: 権限はく奪を検出');
          setError('not-found');
        } else if (errorCode === 'resource-exhausted') {
          setError('quota-exceeded');
          setPerformanceTimetableLoaded(true);
        }
      }
    );

    // クリーンアップ
    return () => unsubscribe();
  }, [eventId]);

  // リハーサルタイムテーブルデータの読み込み
  // 注意: eventSettingsを依存配列に入れるとサブスクリプションが再作成されるため、hasEventSettingsのみ使用
  const hasEventSettings = !!eventSettings;
  useEffect(() => {
    if (!eventId || !hasEventSettings) return;

    if (eventSettings?.rehearsalType === 'none') {
      setRehearsalTimetable(null);
      setRehearsalTimetableLoaded(true);
      return;
    }

    setRehearsalTimetableLoaded(false);

    // リアルタイム監視を設定
    const unsubscribe = timetableService.subscribeTimetable(
      eventId,
      'rehearsal',
      (fetchedTimetable) => {
        setRehearsalTimetable(fetchedTimetable);
        if (fetchedTimetable?.dailyTimetables) {
          lastSavedRehearsalHashRef.current = JSON.stringify(fetchedTimetable.dailyTimetables);
        }
        setRehearsalTimetableLoaded(true);
      },
      (err) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const errorCode = (err as any)?.code;
        if (errorCode === 'permission-denied') {
          console.warn('[EventEditorPage] リハTT監視: 権限はく奪を検出');
          setError('not-found');
        } else if (errorCode === 'resource-exhausted') {
          setError('quota-exceeded');
          setRehearsalTimetableLoaded(true);
        }
      }
    );

    // クリーンアップ
    return () => unsubscribe();
  }, [eventId, hasEventSettings, eventSettings?.rehearsalType]);

  // タイムテーブルが存在しない場合は作成
  useEffect(() => {
    if (!eventId || !eventSettings) return;

    const createInitialTimetables = async () => {
      if (mode === 'timetable-editing') {
        try {
          // 本番用タイムテーブル
          if (performanceTimetable === null && !initialCreateAttemptedRef.current.performance) {
            initialCreateAttemptedRef.current.performance = true;
            const newPerformanceTimetable: Omit<Timetable, 'id'> = {
              eventId: eventId,
              type: 'performance',
              dailyTimetables: [],
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            await timetableService.createTimetable(newPerformanceTimetable);
          }

          // リハーサル用タイムテーブル（リハーサル設定がある場合のみ）
          if (
            rehearsalTimetable === null &&
            eventSettings.rehearsalType !== 'none' &&
            !initialCreateAttemptedRef.current.rehearsal
          ) {
            initialCreateAttemptedRef.current.rehearsal = true;
            const newRehearsalTimetable: Omit<Timetable, 'id'> = {
              eventId: eventId,
              type: 'rehearsal',
              dailyTimetables: [],
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            await timetableService.createTimetable(newRehearsalTimetable);
          }
        } catch (error) {
          console.error('タイムテーブル作成エラー:', error);
        }
      }
    };

    createInitialTimetables();
  }, [performanceTimetable, rehearsalTimetable, mode, eventId, eventSettings]);

  // refを常に最新状態に同期
  performanceTimetableRef.current = performanceTimetable;
  rehearsalTimetableRef.current = rehearsalTimetable;
  eventSettingsRef.current = eventSettings;
  bandsRef.current = bands;

  return {
    mode,
    setMode,
    bands,
    setBands,
    eventSettings,
    setEventSettings,
    isLoading,
    bandsLoaded,
    hasCompletedInitialTimetableSync,
    setHasCompletedInitialTimetableSync,
    performanceTimetableLoaded,
    rehearsalTimetableLoaded,
    error,
    performanceTimetable,
    rehearsalTimetable,
    performanceTimetableRef,
    rehearsalTimetableRef,
    eventSettingsRef,
    bandsRef,
    isInitialTimetableSyncInFlightRef,
    initialCreateAttemptedRef,
    lastSavedPerformanceHashRef,
    lastSavedRehearsalHashRef,
  };
};
