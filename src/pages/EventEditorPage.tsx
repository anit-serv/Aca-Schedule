import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { BandManagement } from '../components/BandManagement';
import { TimetableEditing } from '../components/TimetableEditing';
import { EventSettingsModal } from '../components/EventSettingsModal';
import { UndoRedoButtons } from '../components/UndoRedoButtons';
import { SkipNotificationDialog } from '../components/SkipNotificationDialog';
import { timetableService, eventService, collaboratorService } from '../services/firestore';
import { timetableToCSV, downloadCSV } from '../utils/timetableExport';
import { generateUUID } from '../utils/generateUUID';
import { useAuth } from '../hooks/useAuth';
import { useMobileDetect } from '../hooks/useMobileDetect';
import { MobileHeader } from '../components/mobile/MobileHeader';
import { MobileTabBar } from '../components/mobile/MobileTabBar';
import { type SheetHeight } from '../components/mobile/MobileBottomSheet';
import { MobileBandManagement } from '../components/mobile/MobileBandManagement';
import { MobileTimetableView } from '../components/mobile/MobileTimetableView';
import {
  getFirstCoolStartTime,
  isSameDailyTimetable,
  recalculateRehearsalCoolTimes,
} from '../utils/timetableTimeUtils';
import type { Band, EventSettings, Timetable, DailyTimetable, Cool, TimetableEntry } from '../types';
import { useEventEditorData } from '../hooks/useEventEditorData';
import { useTimetableChangeHandlers } from '../hooks/useTimetableChangeHandlers';
import { useEditorUndo } from '../hooks/useEditorUndo';

export const EventEditorPage = () => {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const isMobile = useMobileDetect();
  const isMobileByViewport = typeof window !== 'undefined'
    ? window.matchMedia('(max-width: 1023px)').matches
    : false;
  const shouldUseMobileLayout = isMobile || isMobileByViewport;
  
  // データ読み込み（バンド・イベント設定・タイムテーブル）
  const {
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
    lastSavedPerformanceHashRef,
    lastSavedRehearsalHashRef,
  } = useEventEditorData(eventId);

  // 設定メニューの表示状態
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // 共有パネルの表示状態
  const [showSharePanel, setShowSharePanel] = useState(false);
  const [shareUrlCopied, setShareUrlCopied] = useState(false);
  // 共同編集者関連の状態
  const [collaboratorEmail, setCollaboratorEmail] = useState('');
  const [collaboratorError, setCollaboratorError] = useState('');
  const [isCollaboratorProcessing, setIsCollaboratorProcessing] = useState(false);
  const [showTransferConfirm, setShowTransferConfirm] = useState(false);
  const [showCollaboratorDetail, setShowCollaboratorDetail] = useState(false);
  const [showOwnerTransferNotification, setShowOwnerTransferNotification] = useState(false);

  // モバイル用: ボトムシートの状態
  const [bottomSheetHeight, setBottomSheetHeight] = useState<SheetHeight>('third');
  // モバイル用: 設定メニュー（アクションシート風）
  const [showMobileSettings, setShowMobileSettings] = useState(false);
  // モバイル用: 選択中バンドID（タップ to プレース）
  const [selectedBandId, setSelectedBandId] = useState<string | null>(null);

  // オーナー権限移譲リクエストがある場合、自動的に通知モーダルを表示
  useEffect(() => {
    if (
      eventSettings?.pendingOwnerEmail
      && currentUser?.email
      && eventSettings.pendingOwnerEmail.toLowerCase() === currentUser.email.toLowerCase()
      && eventSettings.ownerId !== currentUser.uid
    ) {
      setShowOwnerTransferNotification(true);
    }
  }, [eventSettings?.pendingOwnerEmail, currentUser?.email, currentUser?.uid, eventSettings?.ownerId]);

  // 設定メニューの外側をクリックしたときに閉じる
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (showSettingsMenu && !target.closest('.settings-menu-container')) {
        setShowSettingsMenu(false);
      }
      if (showSharePanel && !target.closest('.share-panel-container')) {
        setShowSharePanel(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showSettingsMenu, showSharePanel]);

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

  // イベント削除ハンドラー
  const handleDeleteEvent = async () => {
    if (!eventId) return;

    const confirmed = window.confirm(
      `イベント「${eventSettings?.name}」を削除してもよろしいですか?\n\nこの操作は取り消せません。関連する全てのバンドとタイムテーブルも削除されます。`
    );

    if (!confirmed) return;

    setIsDeleting(true);
    try {
      await eventService.deleteEvent(eventId);
      alert('イベントを削除しました');
      navigate('/');
    } catch (error) {
      console.error('[イベント削除] エラー:', error);
      alert('イベントの削除に失敗しました');
      setIsDeleting(false);
    }
  };

  // バンドデータの変更を処理
  const handleBandsChange = async (updatedBands: Band[]) => {
    // ローカル状態を即座に更新（楽観的更新）
    setBands(updatedBands);
  };

  // タイムテーブル変更ハンドラー（本番・リハーサル）
  const { handlePerformanceTimetableChange, handleRehearsalTimetableChange } = useTimetableChangeHandlers({
    performanceTimetable,
    rehearsalTimetable,
    eventSettings,
    bands,
    lastSavedPerformanceHashRef,
    lastSavedRehearsalHashRef,
  });

  // Undo/Redo配線
  const {
    canUndo,
    canRedo,
    undo,
    redo,
    skippedOps,
    clearSkipped,
    handleBandUndoRecord,
    handleCustomFieldsUndoRecord,
    handlePerformanceTimetableChangeWithUndo,
    handleRehearsalTimetableChangeWithUndo,
  } = useEditorUndo({
    performanceTimetableRef,
    rehearsalTimetableRef,
    eventSettingsRef,
    bandsRef,
    setBands,
    setEventSettings,
    handlePerformanceTimetableChange,
    handleRehearsalTimetableChange,
  });

  // タイムテーブルと日付を同期する関数
  const syncTimetableWithDates = async (
    timetable: Timetable | null,
    oldDates: string[],
    newDates: string[]
  ) => {
    if (!timetable || !eventId) return;
    
    const updatedDailyTimetables: DailyTimetable[] = [];
    
    // 日付のマッピングを作成（変更された日付を追跡）
    const dateMapping = new Map<string, string>();
    
    // 既存の日付と新しい日付を比較
    oldDates.forEach((oldDate, index) => {
      if (newDates[index]) {
        dateMapping.set(oldDate, newDates[index]);
      }
    });
    
    // 既存のタイムテーブルを新しい日付に移行
    timetable.dailyTimetables.forEach((dailyTimetable) => {
      const newDate = dateMapping.get(dailyTimetable.date);
      if (newDate) {
        // 日付が変更された場合、新しい日付でコピー
        updatedDailyTimetables.push({
          ...dailyTimetable,
          date: newDate,
        });
      } else if (newDates.includes(dailyTimetable.date)) {
        // 日付が変更されていない場合はそのまま維持
        updatedDailyTimetables.push(dailyTimetable);
      }
      // 削除された日付のタイムテーブルは含めない
    });
    
    // 新しく追加された日付に空のタイムテーブルを作成
    newDates.forEach((newDate) => {
      if (!updatedDailyTimetables.some(dt => dt.date === newDate)) {
        updatedDailyTimetables.push({
          date: newDate,
          startTime: '10:00',
          cools: [],
          entries: [],
        });
      }
    });
    
    // タイムテーブルを更新
    await timetableService.updateTimetable(timetable.id, {
      dailyTimetables: updatedDailyTimetables,
    });
  };

  // イベント設定の保存
  const handleSaveEventSettings = async (settings: EventSettings) => {
    try {
      // idを除いた更新データを作成
      const { id, ...updateData } = settings;
      await eventService.updateEvent(id, updateData);
      
      // 日付が変更された場合、タイムテーブルを同期
      if (eventSettings && eventId) {
        // 本番タイムテーブルの同期
        await syncTimetableWithDates(
          performanceTimetable,
          eventSettings.performanceDates,
          settings.performanceDates
        );
        
        // リハーサルタイムテーブルの同期
        if (settings.rehearsalType !== 'none') {
          const oldRehearsalDates = eventSettings.rehearsalType === 'cool-pre-rehearsal' || eventSettings.rehearsalType === 'day-start-rehearsal'
            ? eventSettings.performanceDates
            : eventSettings.rehearsalDates || [];
          const newRehearsalDates = settings.rehearsalType === 'cool-pre-rehearsal' || settings.rehearsalType === 'day-start-rehearsal'
            ? settings.performanceDates
            : settings.rehearsalDates || [];
          
          await syncTimetableWithDates(
            rehearsalTimetable,
            oldRehearsalDates,
            newRehearsalDates
          );
        }
      }
      
      setEventSettings(settings);
      console.log('[イベント設定] 保存成功:', settings);
    } catch (error) {
      console.error('[イベント設定] 保存エラー:', error);
      alert('イベント設定の保存に失敗しました。');
    }
  };

  const needsInitialTimetableSync =
    eventSettings?.rehearsalType === 'cool-pre-rehearsal' &&
    !!performanceTimetable &&
    !!rehearsalTimetable;
  const needsRehearsalTimetable = !!eventSettings && eventSettings.rehearsalType !== 'none';
  const isWaitingTimetableSubscriptions =
    !performanceTimetableLoaded ||
    (needsRehearsalTimetable && !rehearsalTimetableLoaded);
  const isWaitingInitialTimetableSync = needsInitialTimetableSync && !hasCompletedInitialTimetableSync;
  const isEditorLoading = isLoading || !bandsLoaded || isWaitingTimetableSubscriptions || isWaitingInitialTimetableSync;

  // ローディング中
  if (isEditorLoading) {
    return (
      <div className={`bg-gray-50 text-gray-900 flex items-center justify-center ${shouldUseMobileLayout ? 'h-screen px-4' : 'min-h-screen'}`}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto mb-4"></div>
          <p className="text-lg text-gray-500">
            {isWaitingInitialTimetableSync ? 'タイムテーブルを準備しています...' : 'イベントを読み込んでいます...'}
          </p>
        </div>
      </div>
    );
  }

  // エラー表示
  if (error || !eventSettings) {
    const errorConfig = error === 'not-found'
      ? {
          icon: 'search',
          title: 'イベントが見つかりませんでした',
          message: 'このイベントは存在しないか、アクセス権限がありません。',
        }
      : error === 'quota-exceeded'
        ? {
            icon: 'hourglass_empty',
            title: 'アクセスが集中しています',
            message: 'Firestoreの利用上限に達しました。しばらく待ってから再度お試しください。',
          }
        : {
            icon: 'warning',
            title: '読み込みエラー',
            message: 'イベント情報の読み込みに失敗しました。もう一度お試しください。',
          };

    return (
      <div className={`bg-gray-50 text-gray-900 flex items-center justify-center ${shouldUseMobileLayout ? 'h-screen px-4' : 'min-h-screen'}`}>
        <div className="max-w-md w-full mx-auto p-6">
          <div className="text-center">
            <div className="text-6xl mb-4"><Icon name={errorConfig.icon} className="text-6xl" /></div>
            <h1 className="text-2xl font-bold mb-2">{errorConfig.title}</h1>
            <p className="text-gray-500 mb-6">{errorConfig.message}</p>
            <button
              onClick={() => navigate('/')}
              className="px-6 py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-md font-medium transition-colors"
            >
              マイイベントに戻る
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 編集権限チェック: オーナーまたは承認済み共同編集者のみ編集可能
  const isOwner = currentUser && eventSettings.ownerId === currentUser.uid;
  const isCollaborator = currentUser?.email && eventSettings.collaboratorEmails?.some(
    email => email.toLowerCase() === currentUser.email!.toLowerCase()
  );
  const canEdit = isOwner || isCollaborator;

  if (!canEdit) {
    return (
      <div className={`bg-gray-50 text-gray-900 flex items-center justify-center ${shouldUseMobileLayout ? 'h-screen px-4' : 'min-h-screen'}`}>
        <div className="max-w-md w-full mx-auto p-6">
          <div className="text-center">
            <div className="text-6xl mb-4">{'\uD83D\uDD12'}</div>
            <h1 className="text-2xl font-bold mb-2">アクセス権限がありません</h1>
            <p className="text-gray-500 mb-6">
              {currentUser
                ? 'このイベントの編集権限がありません。オーナーに共同編集者として招待してもらってください。'
                : 'ログインしてください。'}
            </p>
            <button
              onClick={() => navigate('/')}
              className="px-6 py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-md font-medium transition-colors"
            >
              マイイベントに戻る
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ========== モバイルレイアウト ==========
  if (shouldUseMobileLayout) {
    return (
      <div className="bg-gray-50 text-gray-900 fixed inset-0 font-sans flex flex-col overflow-hidden">
        {/* モバイルヘッダー */}
        <MobileHeader
          eventSettings={eventSettings}
          mode={mode}
          onBack={() => navigate('/')}
          onShareToggle={() => setShowSharePanel(!showSharePanel)}
          onSettingsToggle={() => setShowMobileSettings(true)}
          isPublic={eventSettings.isPublic}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={() => void undo()}
          onRedo={() => void redo()}
        />

        {/* メインコンテンツ */}
        <main className="flex-1 overflow-hidden">
          {mode === 'band-management' ? (
            <MobileBandManagement
              bands={bands}
              eventSettings={eventSettings}
              onBandsChange={handleBandsChange}
              onUndoRecord={handleBandUndoRecord}
              isLoading={isEditorLoading}
            />
          ) : (
            <MobileTimetableView
              bands={bands}
              eventSettings={eventSettings}
              performanceTimetable={performanceTimetable}
              rehearsalTimetable={rehearsalTimetable}
              onPerformanceTimetableChange={handlePerformanceTimetableChangeWithUndo}
              onRehearsalTimetableChange={handleRehearsalTimetableChangeWithUndo}
              onCustomFieldsUndoRecord={handleCustomFieldsUndoRecord}
              selectedBandId={selectedBandId}
              onBandPlaced={() => setSelectedBandId(null)}
              onOpenBandBank={() => setBottomSheetHeight(bottomSheetHeight === 'closed' ? 'half' : 'closed')}
              onEventSettingsChange={(updates) => {
                setEventSettings(prev => prev ? { ...prev, ...updates } : null);
              }}
              bottomSheetHeight={bottomSheetHeight}
              onBottomSheetHeightChange={setBottomSheetHeight}
              onSelectBand={setSelectedBandId}
              isLoading={isEditorLoading}
            />
          )}
        </main>

        {/* モバイルタブバー */}
        <MobileTabBar mode={mode} onModeChange={setMode} />

        {/* 共有パネル（モバイル用フルスクリーン） */}
        {showSharePanel && (
          <div className="fixed inset-0 bg-black/40 z-50" onClick={() => setShowSharePanel(false)}>
            <div
              className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-xl max-h-[85vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 pt-4 pb-2">
                <h3 className="text-base font-bold text-gray-900">共有設定</h3>
                <button
                  onClick={() => setShowSharePanel(false)}
                  className="p-1 rounded-full hover:bg-gray-100 text-gray-400"
                >
                  <Icon name="close" className="text-xl" />
                </button>
              </div>
              <div className="px-4 pb-6 space-y-4">
                {/* 公開トグル */}
                {currentUser && eventSettings.ownerId === currentUser.uid && (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-700">閲覧用ページを公開</p>
                      <p className="text-xs text-gray-400 mt-0.5">リンクを知っている人が閲覧できます</p>
                    </div>
                    <button
                      onClick={async () => {
                        const newValue = !eventSettings.isPublic;
                        try {
                          await eventService.updateEvent(eventSettings.id, { isPublic: newValue });
                          setEventSettings(prev => prev ? { ...prev, isPublic: newValue } : null);
                        } catch (error) {
                          console.error('共有設定の更新に失敗:', error);
                          alert('共有設定の更新に失敗しました。');
                        }
                      }}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        eventSettings.isPublic ? 'bg-emerald-500' : 'bg-gray-300'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow ${
                          eventSettings.isPublic ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                )}

                {/* URL表示・コピー */}
                {eventSettings.isPublic && (
                  <div>
                    <p className="text-xs text-gray-500 mb-1.5">共有URL</p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        readOnly
                        value={`${window.location.origin}/share/${eventSettings.id}`}
                        className="flex-1 bg-gray-50 border border-gray-200 rounded px-2 py-1.5 text-xs text-gray-700 font-mono truncate"
                        onClick={(e) => (e.target as HTMLInputElement).select()}
                      />
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(`${window.location.origin}/share/${eventSettings.id}`);
                          setShareUrlCopied(true);
                          setTimeout(() => setShareUrlCopied(false), 2000);
                        }}
                        className="px-3 py-1.5 rounded text-xs font-medium bg-emerald-500 text-white"
                      >
                        {shareUrlCopied ? <><Icon name="check" className="text-sm align-middle mr-0.5" />コピー済</> : 'コピー'}
                      </button>
                    </div>
                  </div>
                )}

                {/* 共同編集者数 */}
                {((eventSettings.collaboratorEmails?.length ?? 0) + (eventSettings.pendingCollaboratorEmails?.length ?? 0)) > 0 && (
                  <button
                    onClick={() => { setShowSharePanel(false); setShowCollaboratorDetail(true); }}
                    className="w-full flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2.5"
                  >
                    <span className="text-sm text-gray-700">
                      共同編集者 ({(eventSettings.collaboratorEmails?.length ?? 0) + (eventSettings.pendingCollaboratorEmails?.length ?? 0)}人)
                    </span>
                    <Icon name="chevron_right" className="text-base text-gray-400" />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* モバイル設定アクションシート */}
        {showMobileSettings && (
          <div className="fixed inset-0 bg-black/40 z-50" onClick={() => setShowMobileSettings(false)}>
            <div
              className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-10 h-1 rounded-full bg-gray-300 mx-auto mt-2" />
              <div className="py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))]">
                {mode === 'timetable-editing' && (
                  <>
                    <button
                      onClick={() => {
                        setShowMobileSettings(false);
                        if (performanceTimetable) {
                          const csvContent = timetableToCSV(performanceTimetable, bands, eventSettings?.name || 'イベント');
                          const filename = `${eventSettings?.name || 'イベント'}_本番タイムテーブル.csv`;
                          downloadCSV(csvContent, filename);
                        }
                      }}
                      className="w-full text-left px-5 py-3 text-sm text-gray-700 active:bg-gray-50"
                    >
                      <Icon name="download" className="text-base align-middle mr-1" />本番タイムテーブルをCSV出力
                    </button>
                    {eventSettings?.rehearsalType !== 'none' && (
                      <button
                        onClick={() => {
                          setShowMobileSettings(false);
                          if (rehearsalTimetable) {
                            const csvContent = timetableToCSV(rehearsalTimetable, bands, eventSettings?.name || 'イベント');
                            const filename = `${eventSettings?.name || 'イベント'}_リハーサルタイムテーブル.csv`;
                            downloadCSV(csvContent, filename);
                          }
                        }}
                        className="w-full text-left px-5 py-3 text-sm text-gray-700 active:bg-gray-50"
                      >
                        <Icon name="download" className="text-base align-middle mr-1" />リハーサルタイムテーブルをCSV出力
                      </button>
                    )}
                    <div className="border-t border-gray-100 mx-4" />
                  </>
                )}
                <button
                  onClick={() => {
                    setShowMobileSettings(false);
                    setShowSettingsModal(true);
                  }}
                  className="w-full text-left px-5 py-3 text-sm text-gray-700 active:bg-gray-50"
                >
                  <Icon name="settings" className="text-base align-middle mr-1" />イベント設定
                </button>
                <button
                  onClick={() => {
                    setShowMobileSettings(false);
                    handleDeleteEvent();
                  }}
                  disabled={isDeleting}
                  className="w-full text-left px-5 py-3 text-sm text-red-600 active:bg-gray-50 disabled:opacity-50"
                >
                  <Icon name="delete" className="text-base align-middle mr-1" />{isDeleting ? '削除中...' : 'イベントを削除'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* イベント設定モーダル（共通） */}
        {showSettingsModal && (
          <EventSettingsModal
            eventSettings={eventSettings}
            onClose={() => setShowSettingsModal(false)}
            onSave={handleSaveEventSettings}
          />
        )}

        {/* 共同編集者詳細モーダル（共通） */}
        {showCollaboratorDetail && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100]" onClick={() => setShowCollaboratorDetail(false)}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold text-gray-900">共同編集者の管理</h3>
                <button
                  onClick={() => setShowCollaboratorDetail(false)}
                  className="p-1 rounded-full hover:bg-gray-100 text-gray-400"
                >
                  <Icon name="close" className="text-xl" />
                </button>
              </div>
              {/* 共同編集者一覧 */}
              <div className="mb-4">
                <p className="text-sm text-gray-500 mb-2">承認済みの共同編集者</p>
                {(eventSettings.collaboratorEmails?.length ?? 0) > 0 ? (
                  <div className="space-y-2">
                    {eventSettings.collaboratorEmails!.map((email) => (
                      <div key={email} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                            {email[0].toUpperCase()}
                          </div>
                          <span className="text-sm text-gray-700 truncate">{email}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">承認済みの共同編集者はいません</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* オーナー権限移譲通知モーダル（共通） */}
        {showOwnerTransferNotification && eventSettings.pendingOwnerEmail && currentUser?.email
          && eventSettings.pendingOwnerEmail.toLowerCase() === currentUser.email.toLowerCase()
          && eventSettings.ownerId !== currentUser.uid && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200]">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold text-gray-900"><Icon name="mail" className="text-base align-middle mr-1" />オーナー権限の移譲リクエスト</h3>
                <button
                  onClick={() => setShowOwnerTransferNotification(false)}
                  className="p-1 rounded-full hover:bg-gray-100 text-gray-400"
                >
                  <Icon name="close" className="text-xl" />
                </button>
              </div>
              <p className="text-sm text-gray-600 mb-4">
                このイベントのオーナー権限があなたに移譲されようとしています。承認しますか？
              </p>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    if (!currentUser?.email) return;
                    setIsCollaboratorProcessing(true);
                    try {
                      await collaboratorService.acceptOwnerTransfer(eventSettings.id, currentUser.uid, currentUser.email);
                      window.location.reload();
                    } catch (error) {
                      console.error('オーナー権限の承認に失敗:', error);
                      alert('承認に失敗しました。');
                    } finally {
                      setIsCollaboratorProcessing(false);
                    }
                  }}
                  className="flex-1 px-3 py-2 bg-emerald-500 text-white rounded-lg text-sm font-medium"
                  disabled={isCollaboratorProcessing}
                >
                  承認する
                </button>
                <button
                  onClick={async () => {
                    setIsCollaboratorProcessing(true);
                    try {
                      await collaboratorService.declineOwnerTransfer(eventSettings.id);
                      setEventSettings(prev => prev ? { ...prev, pendingOwnerEmail: undefined } : null);
                      setShowOwnerTransferNotification(false);
                    } catch (error) {
                      console.error('拒否に失敗:', error);
                    } finally {
                      setIsCollaboratorProcessing(false);
                    }
                  }}
                  className="flex-1 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium"
                  disabled={isCollaboratorProcessing}
                >
                  拒否する
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ========== PCレイアウト（既存） ==========
  return (
    // 全体を囲むコンテナ。ライトテーマの背景色とテキスト色を設定
    <div className="bg-gray-50 text-gray-900 h-screen font-sans flex flex-col overflow-hidden">
      {/* ヘッダーセクション */}
      <header className="bg-white shadow-sm border-b border-gray-200 flex-shrink-0">
        <nav className="max-w-7xl mx-auto px-6 py-3 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/')}
              className="text-gray-400 hover:text-gray-700 transition-colors text-sm"
              title="マイイベントに戻る"
            >
              <Icon name="arrow_back" className="text-sm align-middle mr-1" />戻る
            </button>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{eventSettings.name}</h1>
              <p className="text-sm text-gray-500">{eventSettings.year}年 @ {eventSettings.venue}</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setMode('band-management')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors duration-200 ${
                mode === 'band-management'
                  ? 'bg-emerald-500 text-white' // アクティブなボタンのスタイル
                  : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' // 非アクティブなボタンのスタイル
              }`}
            >
              バンド管理
            </button>
            <button
              onClick={() => setMode('timetable-editing')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors duration-200 ${
                mode === 'timetable-editing'
                  ? 'bg-emerald-500 text-white' // アクティブなボタンのスタイル
                  : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' // 非アクティブなボタンのスタイル
              }`}
            >
              タイムテーブル編集
            </button>
            
            {/* Undo/Redo ボタン */}
            <div className="border-l border-gray-200 pl-2 ml-1">
              <UndoRedoButtons
                canUndo={canUndo}
                canRedo={canRedo}
                onUndo={() => void undo()}
                onRedo={() => void redo()}
              />
            </div>

            {/* 共有ボタン */}
            <div className="relative share-panel-container">
              <button
                onClick={() => setShowSharePanel(!showSharePanel)}
                className={`p-2 rounded-md transition-colors duration-200 ${
                  eventSettings.isPublic
                    ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                    : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                }`}
                title="共有設定"
              >
                <Icon name="share" className="text-xl" />
              </button>
              
              {/* 共有パネル */}
              {showSharePanel && (
                <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-lg border border-gray-200 z-50 p-4">
                  <h3 className="text-sm font-bold text-gray-900 mb-3">共有設定</h3>
                  
                  {/* 公開トグル（オーナーのみ） */}
                  {currentUser && eventSettings.ownerId === currentUser.uid && (
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-sm text-gray-700">閲覧用ページを公開</p>
                      <p className="text-xs text-gray-400 mt-0.5">リンクを知っている人が閲覧できます</p>
                    </div>
                    <button
                      onClick={async () => {
                        const newValue = !eventSettings.isPublic;
                        try {
                          await eventService.updateEvent(eventSettings.id, { isPublic: newValue });
                          setEventSettings(prev => prev ? { ...prev, isPublic: newValue } : null);
                        } catch (error) {
                          console.error('共有設定の更新に失敗:', error);
                          alert('共有設定の更新に失敗しました。');
                        }
                      }}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                        eventSettings.isPublic ? 'bg-emerald-500' : 'bg-gray-300'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow ${
                          eventSettings.isPublic ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                  )}
                  
                  {/* 注意書き */}
                  {eventSettings.isPublic && (
                    <div className="bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mb-3">
                      <p className="text-xs text-amber-700">
                        <Icon name="warning" className="text-sm align-middle mr-1" />バンド名を含むタイムテーブル情報が公開されます
                      </p>
                    </div>
                  )}
                  
                  {/* URL表示・コピー */}
                  {eventSettings.isPublic && (
                    <div className="mb-3">
                      <p className="text-xs text-gray-500 mb-1.5">共有URL</p>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          readOnly
                          value={`${window.location.origin}/share/${eventSettings.id}`}
                          className="flex-1 bg-gray-50 border border-gray-200 rounded px-2 py-1.5 text-xs text-gray-700 font-mono truncate"
                          onClick={(e) => (e.target as HTMLInputElement).select()}
                        />
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(`${window.location.origin}/share/${eventSettings.id}`);
                            setShareUrlCopied(true);
                            setTimeout(() => setShareUrlCopied(false), 2000);
                          }}
                          className="px-3 py-1.5 rounded text-xs font-medium bg-emerald-500 hover:bg-emerald-600 text-white transition-colors whitespace-nowrap"
                        >
                          {shareUrlCopied ? <><Icon name="check" className="text-sm align-middle mr-0.5" />コピー済</> : 'コピー'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 共同編集者の追加（オーナーのみ） */}
                  {currentUser && eventSettings.ownerId === currentUser.uid && (
                    <div className="border-t border-gray-200 pt-3 mt-1">
                      <h4 className="text-sm font-bold text-gray-900 mb-2">共同編集者を追加</h4>

                      {/* 招待フォーム */}
                      <div className="flex gap-2 mb-2">
                        <input
                          type="email"
                          value={collaboratorEmail}
                          onChange={(e) => { setCollaboratorEmail(e.target.value); setCollaboratorError(''); }}
                          placeholder="example@email.com"
                          className="flex-1 bg-gray-50 border border-gray-200 rounded px-2 py-1.5 text-xs text-gray-700 placeholder-gray-400"
                          disabled={isCollaboratorProcessing}
                        />
                        <button
                          onClick={async () => {
                            const email = collaboratorEmail.trim().toLowerCase();
                            if (!email) return;
                            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                              setCollaboratorError('有効なメールアドレスを入力してください');
                              return;
                            }
                            if (currentUser.email && email === currentUser.email.toLowerCase()) {
                              setCollaboratorError('自分自身は追加できません');
                              return;
                            }
                            if (eventSettings.collaboratorEmails?.includes(email) || eventSettings.pendingCollaboratorEmails?.includes(email)) {
                              setCollaboratorError('既に追加されています');
                              return;
                            }
                            setIsCollaboratorProcessing(true);
                            try {
                              await collaboratorService.addCollaborator(eventSettings.id, email);
                              setEventSettings(prev => prev ? {
                                ...prev,
                                pendingCollaboratorEmails: [...(prev.pendingCollaboratorEmails || []), email],
                              } : null);
                              setCollaboratorEmail('');
                              setCollaboratorError('');
                            } catch (error) {
                              console.error('共同編集者の追加に失敗:', error);
                              setCollaboratorError('追加に失敗しました');
                            } finally {
                              setIsCollaboratorProcessing(false);
                            }
                          }}
                          className="px-3 py-1.5 rounded text-xs font-medium bg-emerald-500 hover:bg-emerald-600 text-white transition-colors whitespace-nowrap disabled:opacity-50"
                          disabled={isCollaboratorProcessing || !collaboratorEmail.trim()}
                        >
                          追加
                        </button>
                      </div>
                      {collaboratorError && (
                        <p className="text-xs text-red-500 mb-2">{collaboratorError}</p>
                      )}

                      {/* 共同編集者一覧（承認済み + 招待中） */}
                      {((eventSettings.collaboratorEmails?.length ?? 0) + (eventSettings.pendingCollaboratorEmails?.length ?? 0)) > 0 && (
                        <div className="space-y-1.5 mb-3">
                          {eventSettings.collaboratorEmails?.map((email) => (
                            <div key={email} className="flex items-center gap-2 bg-gray-50 rounded px-2 py-1.5">
                              <span className="text-xs text-gray-700 truncate flex-1">{email}</span>
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-700 flex-shrink-0">
                                承認済み
                              </span>
                            </div>
                          ))}
                          {eventSettings.pendingCollaboratorEmails?.map((email) => (
                            <div key={email} className="flex items-center gap-2 bg-gray-50 rounded px-2 py-1.5">
                              <span className="text-xs text-gray-700 truncate flex-1">{email}</span>
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 flex-shrink-0">
                                招待中
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* 詳細リンク */}
                      <button
                        onClick={() => { setShowSharePanel(false); setShowCollaboratorDetail(true); }}
                        className="flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-700 transition-colors"
                      >
                        <Icon name="group" className="text-sm" />
                        <span className="underline">
                          {((eventSettings.collaboratorEmails?.length ?? 0) + (eventSettings.pendingCollaboratorEmails?.length ?? 0)) > 0
                            ? `${(eventSettings.collaboratorEmails?.length ?? 0) + (eventSettings.pendingCollaboratorEmails?.length ?? 0)}人の共同編集者を管理`
                            : '共同編集者の管理'}
                        </span>
                      </button>
                    </div>
                  )}

                  {/* 共同編集者向けの表示（オーナー以外） */}
                  {currentUser && eventSettings.ownerId !== currentUser.uid && (
                    <div>
                      {/* 公開状態の表示（読み取り専用） */}
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <p className="text-sm text-gray-700">閲覧用ページ</p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {eventSettings.isPublic ? '公開中' : '非公開'}
                          </p>
                        </div>
                        <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                          eventSettings.isPublic ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {eventSettings.isPublic ? '公開' : '非公開'}
                        </span>
                      </div>

                      {/* 公開URLの表示 */}
                      {eventSettings.isPublic && (
                        <div className="mb-3">
                          <p className="text-xs text-gray-500 mb-1.5">共有URL</p>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              readOnly
                              value={`${window.location.origin}/share/${eventSettings.id}`}
                              className="flex-1 bg-gray-50 border border-gray-200 rounded px-2 py-1.5 text-xs text-gray-700 font-mono truncate"
                              onClick={(e) => (e.target as HTMLInputElement).select()}
                            />
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(`${window.location.origin}/share/${eventSettings.id}`);
                                setShareUrlCopied(true);
                                setTimeout(() => setShareUrlCopied(false), 2000);
                              }}
                              className="px-3 py-1.5 rounded text-xs font-medium bg-emerald-500 hover:bg-emerald-600 text-white transition-colors whitespace-nowrap"
                            >
                              {shareUrlCopied ? <><Icon name="check" className="text-sm align-middle mr-0.5" />コピー済</> : 'コピー'}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* 共同編集者一覧（読み取り専用） */}
                      {((eventSettings.collaboratorEmails?.length ?? 0) + (eventSettings.pendingCollaboratorEmails?.length ?? 0)) > 0 && (
                        <div className="border-t border-gray-200 pt-3 mt-1 mb-3">
                          <h4 className="text-sm font-bold text-gray-900 mb-2">共同編集者</h4>
                          <div className="space-y-1.5">
                            {eventSettings.collaboratorEmails?.map((email) => (
                              <div key={email} className="flex items-center gap-2 bg-gray-50 rounded px-2 py-1.5">
                                <span className="text-xs text-gray-700 truncate flex-1">{email}</span>
                                {currentUser.email && email.toLowerCase() === currentUser.email.toLowerCase() && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700 flex-shrink-0">
                                    あなた
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 共同編集を辞退 */}
                      <div className="border-t border-gray-200 pt-3 mt-1">
                        <button
                          onClick={async () => {
                            if (!currentUser?.email) return;
                            if (!confirm('このイベントの共同編集を辞退しますか？')) return;
                            setIsCollaboratorProcessing(true);
                            try {
                              await collaboratorService.declineCollaboration(eventSettings.id, currentUser.email);
                              // ホーム画面に戻る
                              window.location.href = '/';
                            } catch (error) {
                              console.error('共同編集の辞退に失敗:', error);
                              alert('辞退に失敗しました');
                            } finally {
                              setIsCollaboratorProcessing(false);
                            }
                          }}
                          className="text-xs text-gray-500 hover:text-red-500 transition-colors underline"
                          disabled={isCollaboratorProcessing}
                        >
                          共同編集を辞退する
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 共同編集者詳細モーダル */}
              {showCollaboratorDetail && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100]" onClick={() => setShowCollaboratorDetail(false)}>
                  <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 p-6" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-base font-bold text-gray-900">共同編集者の管理</h3>
                      <button
                        onClick={() => setShowCollaboratorDetail(false)}
                        className="p-1 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        <Icon name="close" className="text-xl" />
                      </button>
                    </div>

                    {/* オーナー権限移譲の保留通知（移譲先ユーザーに表示） */}
                    {eventSettings.pendingOwnerEmail
                      && currentUser?.email
                      && eventSettings.pendingOwnerEmail.toLowerCase() === currentUser.email.toLowerCase()
                      && eventSettings.ownerId !== currentUser.uid && (
                      <div className="bg-blue-50 border border-blue-200 rounded-md px-3 py-3 mb-4">
                        <p className="text-sm font-bold text-blue-800 mb-2"><Icon name="mail" className="text-base align-middle mr-1" />オーナー権限の移譲リクエスト</p>
                        <p className="text-xs text-blue-700 mb-3">このイベントのオーナー権限があなたに移譲されようとしています。</p>
                        <div className="flex gap-2">
                          <button
                            onClick={async () => {
                              if (!currentUser?.email) return;
                              setIsCollaboratorProcessing(true);
                              try {
                                await collaboratorService.acceptOwnerTransfer(
                                  eventSettings.id,
                                  currentUser.uid,
                                  currentUser.email
                                );
                                window.location.reload();
                              } catch (error) {
                                console.error('オーナー権限の承認に失敗:', error);
                                alert('オーナー権限の承認に失敗しました。');
                              } finally {
                                setIsCollaboratorProcessing(false);
                              }
                            }}
                            className="px-3 py-1.5 rounded text-xs font-medium bg-blue-500 hover:bg-blue-600 text-white transition-colors"
                            disabled={isCollaboratorProcessing}
                          >
                            承認する
                          </button>
                          <button
                            onClick={async () => {
                              setIsCollaboratorProcessing(true);
                              try {
                                await collaboratorService.declineOwnerTransfer(eventSettings.id);
                                setEventSettings(prev => prev ? { ...prev, pendingOwnerEmail: undefined } : null);
                              } catch (error) {
                                console.error('オーナー権限の拒否に失敗:', error);
                                alert('オーナー権限の拒否に失敗しました。');
                              } finally {
                                setIsCollaboratorProcessing(false);
                              }
                            }}
                            className="px-3 py-1.5 rounded text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
                            disabled={isCollaboratorProcessing}
                          >
                            拒否する
                          </button>
                        </div>
                      </div>
                    )}

                    {/* 共同編集者一覧 */}
                    <div className="mb-4">
                      <p className="text-sm text-gray-500 mb-2">承認済みの共同編集者</p>
                      {(eventSettings.collaboratorEmails?.length ?? 0) > 0 ? (
                        <div className="space-y-2">
                          {eventSettings.collaboratorEmails!.map((email) => (
                            <div key={email} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                                  {email[0].toUpperCase()}
                                </div>
                                <span className="text-sm text-gray-700 truncate">{email}</span>
                              </div>
                              {currentUser && eventSettings.ownerId === currentUser.uid && (
                                <button
                                  onClick={async () => {
                                    if (!confirm(`${email} を共同編集者から削除しますか？`)) return;
                                    setIsCollaboratorProcessing(true);
                                    try {
                                      await collaboratorService.removeCollaborator(eventSettings.id, email);
                                      setEventSettings(prev => prev ? {
                                        ...prev,
                                        collaboratorEmails: (prev.collaboratorEmails || []).filter(e => e !== email),
                                      } : null);
                                    } catch (error) {
                                      console.error('共同編集者の削除に失敗:', error);
                                      alert('削除に失敗しました');
                                    } finally {
                                      setIsCollaboratorProcessing(false);
                                    }
                                  }}
                                  className="ml-2 p-1 rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                                  disabled={isCollaboratorProcessing}
                                  title="削除"
                                >
                                  <Icon name="close" className="text-base" />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400">承認済みの共同編集者はいません</p>
                      )}
                    </div>

                    {/* 招待中の共同編集者一覧 */}
                    {(eventSettings.pendingCollaboratorEmails?.length ?? 0) > 0 && (
                      <div className="mb-4">
                        <p className="text-sm text-gray-500 mb-2">招待中</p>
                        <div className="space-y-2">
                          {eventSettings.pendingCollaboratorEmails!.map((email) => (
                            <div key={email} className="flex items-center justify-between bg-amber-50 rounded-lg px-3 py-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <div className="w-7 h-7 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                                  {email[0].toUpperCase()}
                                </div>
                                <span className="text-sm text-gray-700 truncate">{email}</span>
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 flex-shrink-0">
                                  招待中
                                </span>
                              </div>
                              {currentUser && eventSettings.ownerId === currentUser.uid && (
                                <button
                                  onClick={async () => {
                                    if (!confirm(`${email} への招待を取り消しますか？`)) return;
                                    setIsCollaboratorProcessing(true);
                                    try {
                                      await collaboratorService.removeCollaborator(eventSettings.id, email);
                                      setEventSettings(prev => prev ? {
                                        ...prev,
                                        pendingCollaboratorEmails: (prev.pendingCollaboratorEmails || []).filter(e => e !== email),
                                      } : null);
                                    } catch (error) {
                                      console.error('招待の取り消しに失敗:', error);
                                      alert('取り消しに失敗しました');
                                    } finally {
                                      setIsCollaboratorProcessing(false);
                                    }
                                  }}
                                  className="ml-2 p-1 rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                                  disabled={isCollaboratorProcessing}
                                  title="招待取り消し"
                                >
                                  <Icon name="close" className="text-base" />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* オーナー権限移譲（オーナーのみ） */}
                    {currentUser && eventSettings.ownerId === currentUser.uid && (
                      <div className="border-t border-gray-200 pt-4">
                        <h4 className="text-sm font-bold text-gray-900 mb-2">オーナー権限の移譲</h4>
                        {(eventSettings.collaboratorEmails?.length ?? 0) === 0 ? (
                          <p className="text-xs text-gray-400">承認済みの共同編集者がいると、オーナー権限を移譲できます。</p>
                        ) : eventSettings.pendingOwnerEmail ? (
                          <div className="bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                            <p className="text-xs text-amber-700 mb-2">
                              <span className="font-bold">{eventSettings.pendingOwnerEmail}</span> に移譲リクエスト中
                            </p>
                            <button
                              onClick={async () => {
                                setIsCollaboratorProcessing(true);
                                try {
                                  await collaboratorService.cancelOwnerTransfer(eventSettings.id);
                                  setEventSettings(prev => prev ? { ...prev, pendingOwnerEmail: undefined } : null);
                                } catch (error) {
                                  console.error('移譲キャンセルに失敗:', error);
                                  alert('キャンセルに失敗しました');
                                } finally {
                                  setIsCollaboratorProcessing(false);
                                }
                              }}
                              className="px-3 py-1.5 rounded text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
                              disabled={isCollaboratorProcessing}
                            >
                              キャンセル
                            </button>
                          </div>
                        ) : showTransferConfirm ? (
                          <div>
                            <p className="text-xs text-gray-400 mb-2">移譲先の共同編集者を選択してください。相手が承認すると、あなたは共同編集者になります。</p>
                            <div className="space-y-1.5 mb-3">
                              {eventSettings.collaboratorEmails!.map((email) => (
                                <button
                                  key={email}
                                  onClick={async () => {
                                    if (!confirm(`${email} にオーナー権限を移譲しますか？\n相手が承認すると、あなたは共同編集者になります。`)) return;
                                    setIsCollaboratorProcessing(true);
                                    try {
                                      await collaboratorService.initiateOwnerTransfer(eventSettings.id, email, currentUser.email!);
                                      setEventSettings(prev => prev ? { ...prev, pendingOwnerEmail: email } : null);
                                      setShowTransferConfirm(false);
                                    } catch (error) {
                                      console.error('移譲リクエストに失敗:', error);
                                      alert('移譲リクエストに失敗しました');
                                    } finally {
                                      setIsCollaboratorProcessing(false);
                                    }
                                  }}
                                  className="w-full flex items-center gap-2 bg-gray-50 hover:bg-amber-50 hover:border-amber-300 border border-gray-200 rounded-lg px-3 py-2 text-left transition-colors"
                                  disabled={isCollaboratorProcessing}
                                >
                                  <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                                    {email[0].toUpperCase()}
                                  </div>
                                  <span className="text-sm text-gray-700 truncate">{email}</span>
                                </button>
                              ))}
                            </div>
                            <button
                              onClick={() => setShowTransferConfirm(false)}
                              className="px-3 py-1.5 rounded text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
                            >
                              やめる
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setShowTransferConfirm(true)}
                            className="text-xs text-gray-500 hover:text-amber-600 transition-colors underline"
                          >
                            共同編集者にオーナー権限を移譲
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            
            {/* 設定メニュー */}
            <div className="relative settings-menu-container">
              <button
                onClick={() => setShowSettingsMenu(!showSettingsMenu)}
                className="p-2 rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors duration-200"
                title="設定"
              >
                <Icon name="settings" className="text-xl" />
              </button>
              
              {/* ドロップダウンメニュー */}
              {showSettingsMenu && (
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg border border-gray-200 z-50">
                  {/* エクスポート機能（タイムテーブル編集モードのみ） */}
                  {mode === 'timetable-editing' && (
                    <>
                      <button
                        onClick={() => {
                          setShowSettingsMenu(false);
                          if (performanceTimetable) {
                            const csvContent = timetableToCSV(performanceTimetable, bands, eventSettings?.name || 'イベント');
                            const filename = `${eventSettings?.name || 'イベント'}_本番タイムテーブル.csv`;
                            downloadCSV(csvContent, filename);
                          }
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors duration-200"
                      >
                        <Icon name="download" className="text-base align-middle mr-1" />本番タイムテーブルをCSV出力
                      </button>
                      {eventSettings?.rehearsalType !== 'none' && (
                        <button
                          onClick={() => {
                            setShowSettingsMenu(false);
                            if (rehearsalTimetable) {
                              const csvContent = timetableToCSV(rehearsalTimetable, bands, eventSettings?.name || 'イベント');
                              const filename = `${eventSettings?.name || 'イベント'}_リハーサルタイムテーブル.csv`;
                              downloadCSV(csvContent, filename);
                            }
                          }}
                          className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors duration-200"
                        >
                          <Icon name="download" className="text-base align-middle mr-1" />リハーサルタイムテーブルをCSV出力
                        </button>
                      )}
                      <div className="border-t border-gray-100" />
                    </>
                  )}
                  
                  <button
                    onClick={() => {
                      setShowSettingsMenu(false);
                      setShowSettingsModal(true);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors duration-200"
                  >
                    イベント設定
                  </button>
                  <button
                    onClick={() => {
                      setShowSettingsMenu(false);
                      handleDeleteEvent();
                    }}
                    disabled={isDeleting}
                    className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-50 rounded-b-md transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isDeleting ? '削除中...' : 'イベントを削除'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </nav>
      </header>

      {/* メインコンテンツ */}
      <main className="flex-1 overflow-hidden">
        <div className="h-full">
          {mode === 'band-management' ? (
            <BandManagement
              bands={bands}
              eventSettings={eventSettings}
              onBandsChange={handleBandsChange}
              onUndoRecord={handleBandUndoRecord}
            />
          ) : (
            <TimetableEditing
              bands={bands}
              eventSettings={eventSettings}
              performanceTimetable={performanceTimetable}
              rehearsalTimetable={rehearsalTimetable}
              onPerformanceTimetableChange={handlePerformanceTimetableChangeWithUndo}
              onRehearsalTimetableChange={handleRehearsalTimetableChangeWithUndo}
              onEventSettingsChange={(updates) => {
                setEventSettings(prev => prev ? { ...prev, ...updates } : null);
              }}
              onUndoRecord={handleCustomFieldsUndoRecord}
            />
          )}
        </div>
      </main>

      {/* イベント設定モーダル */}
      {showSettingsModal && (
        <EventSettingsModal
          eventSettings={eventSettings}
          onClose={() => setShowSettingsModal(false)}
          onSave={handleSaveEventSettings}
        />
      )}

      {/* オーナー権限移譲リクエスト通知モーダル */}
      {showOwnerTransferNotification && eventSettings.pendingOwnerEmail && currentUser?.email
        && eventSettings.pendingOwnerEmail.toLowerCase() === currentUser.email.toLowerCase()
        && eventSettings.ownerId !== currentUser.uid && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200]">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-gray-900"><Icon name="mail" className="text-base align-middle mr-1" />オーナー権限の移譲リクエスト</h3>
              <button
                onClick={() => setShowOwnerTransferNotification(false)}
                className="p-1 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                title="後で対応する"
              >
                <Icon name="close" className="text-xl" />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              このイベントのオーナー権限があなたに移譲されようとしています。承認するとあなたがオーナーになります。
            </p>
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  if (!currentUser?.email) return;
                  setIsCollaboratorProcessing(true);
                  try {
                    await collaboratorService.acceptOwnerTransfer(
                      eventSettings.id,
                      currentUser.uid,
                      currentUser.email
                    );
                    window.location.reload();
                  } catch (error) {
                    console.error('オーナー権限の承認に失敗:', error);
                    alert('オーナー権限の承認に失敗しました。');
                  } finally {
                    setIsCollaboratorProcessing(false);
                  }
                }}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500 hover:bg-emerald-600 text-white transition-colors"
                disabled={isCollaboratorProcessing}
              >
                承認する
              </button>
              <button
                onClick={async () => {
                  setIsCollaboratorProcessing(true);
                  try {
                    await collaboratorService.declineOwnerTransfer(eventSettings.id);
                    setEventSettings(prev => prev ? { ...prev, pendingOwnerEmail: undefined } : null);
                    setShowOwnerTransferNotification(false);
                  } catch (error) {
                    console.error('オーナー権限の拒否に失敗:', error);
                    alert('オーナー権限の拒否に失敗しました。');
                  } finally {
                    setIsCollaboratorProcessing(false);
                  }
                }}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
                disabled={isCollaboratorProcessing}
              >
                辞退する
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-3 text-center">×ボタンで後から対応することもできます</p>
          </div>
        </div>
      )}

      {/* スキップ通知ダイアログ */}
      {skippedOps.length > 0 && (
        <SkipNotificationDialog skippedOps={skippedOps} onClose={clearSkipped} />
      )}
    </div>
  );
};
