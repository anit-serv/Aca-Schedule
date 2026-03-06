import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { BandManagement } from '../components/BandManagement';
import { TimetableEditing } from '../components/TimetableEditing';
import { EventSettingsModal } from '../components/EventSettingsModal';
import { bandService, timetableService, eventService, collaboratorService } from '../services/firestore';
import { timetableToCSV, downloadCSV } from '../utils/timetableExport';
import { useAuth } from '../hooks/useAuth';
import { useMobileDetect } from '../hooks/useMobileDetect';
import { MobileHeader } from '../components/mobile/MobileHeader';
import { MobileTabBar } from '../components/mobile/MobileTabBar';
import { MobileBottomSheet, type SheetHeight } from '../components/mobile/MobileBottomSheet';
import { MobileBandManagement } from '../components/mobile/MobileBandManagement';
import { MobileTimetableView } from '../components/mobile/MobileTimetableView';
import { MobileBandBank } from '../components/mobile/MobileBandBank';
import type { Band, EventSettings, Timetable, DailyTimetable, Cool, TimetableEntry } from '../types';

// モードを定義するための型
type Mode = 'band-management' | 'timetable-editing';

export const EventEditorPage = () => {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const isMobile = useMobileDetect();
  
  // 現在のモードを管理するための状態
  const [mode, setMode] = useState<Mode>('band-management');
  
  // バンドとイベント設定の状態管理
  const [bands, setBands] = useState<Band[]>([]);
  const [eventSettings, setEventSettings] = useState<EventSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // タイムテーブルの状態管理
  const [performanceTimetable, setPerformanceTimetable] = useState<Timetable | null>(null);
  const [rehearsalTimetable, setRehearsalTimetable] = useState<Timetable | null>(null);

  // 設定メニューの表示状態
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  // 初回モード自動判定用
  const initialModeSetRef = useRef(false);
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
  const [bottomSheetHeight, setBottomSheetHeight] = useState<SheetHeight>('peek');
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
      },
      (err) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((err as any)?.code === 'permission-denied') {
          console.warn('[EventEditorPage] TT監視: 権限はく奪を検出');
          setError('not-found');
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
    
    // リアルタイム監視を設定
    const unsubscribe = timetableService.subscribeTimetable(
      eventId,
      'rehearsal',
      (fetchedTimetable) => {
        setRehearsalTimetable(fetchedTimetable);
      },
      (err) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((err as any)?.code === 'permission-denied') {
          console.warn('[EventEditorPage] リハTT監視: 権限はく奪を検出');
          setError('not-found');
        }
      }
    );

    // クリーンアップ
    return () => unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, hasEventSettings]);

  // タイムテーブルが存在しない場合は作成
  useEffect(() => {
    if (!eventId || !eventSettings) return;
    
    const createInitialTimetables = async () => {
      if (mode === 'timetable-editing') {
        try {
          // 本番用タイムテーブル
          if (performanceTimetable === null) {
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
          if (rehearsalTimetable === null && eventSettings.rehearsalType !== 'none') {
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
      
      for (const date of dates) {
        let dailyTimetable = rehearsalTimetable.dailyTimetables.find(dt => dt.date === date);
        
        // その日のタイムテーブルが存在しない場合は作成
        if (!dailyTimetable) {
          // 基本となるクール番号を計算
          let baseCoolNumber = 1;
          const sortedDates = [...dates].sort();
          for (const d of sortedDates) {
            if (d === date) break;
            const dt = rehearsalTimetable.dailyTimetables.find(dt => dt.date === d);
            if (dt && dt.cools && dt.cools.length > 0) {
              baseCoolNumber += dt.cools.length;
            }
          }
          
          dailyTimetable = {
            date,
            startTime: '10:00',
            cools: [{
              id: crypto.randomUUID(),
              number: baseCoolNumber,
              entries: [],
            }],
            entries: [],
          };
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
          const sortedDates = [...dates].sort();
          for (const d of sortedDates) {
            if (d === date) break;
            const dt = rehearsalTimetable.dailyTimetables.find(dt => dt.date === d);
            if (dt && dt.cools && dt.cools.length > 0) {
              baseCoolNumber += dt.cools.length;
            }
          }
          
          dailyTimetable = {
            ...dailyTimetable,
            cools: [{
              id: crypto.randomUUID(),
              number: baseCoolNumber,
              entries: [],
            }],
          };
        }
        
        // 新しいバンドをエントリーとして作成
        const newEntries = bandsToAdd.map((band) => ({
          id: crypto.randomUUID(),
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
        
        // Firestoreに直接保存
        try {
          await timetableService.updateDailyTimetable(rehearsalTimetable.id, updatedDailyTimetable);
          console.log(`[リハーサル自動追加] ${date}: 保存成功`);
        } catch (error) {
          console.error(`[リハーサル自動追加] ${date}: 保存エラー`, error);
        }
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

    const syncAllDates = async () => {
      console.log('[クール直前リハ自動同期] 開始');
      
      // すべての本番日付について同期
      for (const performanceDailyTimetable of performanceTimetable.dailyTimetables) {
        await syncCoolPreRehearsalTimetableInternal(performanceDailyTimetable);
      }
      
      console.log('[クール直前リハ自動同期] 完了');
    };

    syncAllDates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [performanceTimetable?.dailyTimetables, eventSettings?.rehearsalType]);

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
      startTime: performanceDailyTimetable.startTime,
      cools: [],
      entries: [],
    };
    
    // リハーサルのクールを本番と同じ数にする
    const rehearsalCools: Cool[] = performanceCools.map((performanceCool, index) => {
      const bandIdsInCool = coolBandIds[index];
      
      // このクールのリハーサルエントリを作成
      const rehearsalEntries: TimetableEntry[] = bandIdsInCool.map(bandId => {
        return {
          id: crypto.randomUUID(),
          type: 'band' as const,
          bandId: bandId,
          startTime: '',
          endTime: '',
          order: 0,
        };
      });
      
      return {
        id: performanceCool.id,
        number: performanceCool.number,
        entries: rehearsalEntries,
      };
    });
    
    const updatedRehearsalDailyTimetable: DailyTimetable = {
      ...rehearsalDailyTimetable,
      cools: rehearsalCools,
    };
    
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

  // リハーサルの最終エントリーの終了時刻を取得
  const getRehearsalEndTime = (dailyTimetable: DailyTimetable): string | null => {
    // クール構造から最終エントリーの終了時刻を取得
    if (dailyTimetable.cools && dailyTimetable.cools.length > 0) {
      for (let i = dailyTimetable.cools.length - 1; i >= 0; i--) {
        const cool = dailyTimetable.cools[i];
        if (cool.entries.length > 0) {
          const lastEntry = cool.entries[cool.entries.length - 1];
          if (lastEntry.endTime) return lastEntry.endTime;
        }
      }
    }
    // フラット構造
    if (dailyTimetable.entries && dailyTimetable.entries.length > 0) {
      const lastEntry = dailyTimetable.entries[dailyTimetable.entries.length - 1];
      if (lastEntry.endTime) return lastEntry.endTime;
    }
    return null;
  };

  // 本番用のエントリー時刻を再計算するヘルパー
  const recalculatePerformanceEntryTimes = (entries: TimetableEntry[], startTime: string): TimetableEntry[] => {
    let currentTime = startTime;
    return entries.map((entry, index) => {
      const band = entry.bandId ? bands.find((b) => b.id === entry.bandId) : null;
      const duration = band?.performanceDuration || entry.customEvent?.duration || 0;
      const transitionTime = entry.transitionTime || 0;
      const [hours, minutes] = currentTime.split(':').map(Number);
      const startMinutes = hours * 60 + minutes + transitionTime;
      const endMinutes = startMinutes + duration;
      const entryStart = `${Math.floor(startMinutes / 60).toString().padStart(2, '0')}:${(startMinutes % 60).toString().padStart(2, '0')}`;
      const entryEnd = `${Math.floor(endMinutes / 60).toString().padStart(2, '0')}:${(endMinutes % 60).toString().padStart(2, '0')}`;
      currentTime = entryEnd;
      return { ...entry, startTime: entryStart, endTime: entryEnd, order: index };
    });
  };

  const recalculatePerformanceCoolTimes = (cools: Cool[], dailyStartTime: string): Cool[] => {
    if (!cools || cools.length === 0) return cools;
    let currentTime = dailyStartTime;
    return cools.map((cool) => {
      if (cool.startTime) currentTime = cool.startTime;
      const updatedEntries = recalculatePerformanceEntryTimes(cool.entries, currentTime);
      if (updatedEntries.length > 0) {
        const lastEntry = updatedEntries[updatedEntries.length - 1];
        currentTime = lastEntry.endTime || currentTime;
      }
      return { ...cool, entries: updatedEntries };
    });
  };

  // 日別タイムテーブルの変更を処理（本番用）
  const handlePerformanceTimetableChange = async (updatedDailyTimetable: DailyTimetable) => {
    if (!performanceTimetable || !eventSettings) return;
    
    console.log('[本番TT変更] 日付:', updatedDailyTimetable.date, 'クール数:', updatedDailyTimetable.cools?.length || 0);
    
    // 楽観的更新: ローカル状態を即座に更新
    const updatedDailyTimetables = performanceTimetable.dailyTimetables.map(dt =>
      dt.date === updatedDailyTimetable.date ? updatedDailyTimetable : dt
    ).concat(
      // 新しい日付の場合は追加
      performanceTimetable.dailyTimetables.some(dt => dt.date === updatedDailyTimetable.date)
        ? []
        : [updatedDailyTimetable]
    );
    
    // 変更された日付以降の全ての日付のクール番号を再計算
    const sortedDates = [...eventSettings.performanceDates].sort();
    const changedIndex = sortedDates.indexOf(updatedDailyTimetable.date);
    
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
    
    // 楽観的更新を削除：Firestoreが書き込み時にローカルキャッシュを即座に更新し、
    // onSnapshotがトリガーされてstateが更新されるため、手動でsetStateする必要はない
    // これによりrace conditionが完全に排除される
    
    console.log('[本番TT変更] Firestore書き込み開始');
    
    // Firestoreに保存（全日付を一括で保存して競合を防止）
    try {
      await timetableService.updateTimetable(performanceTimetable.id, {
        dailyTimetables: updatedTimetable.dailyTimetables,
      });
      console.log('[本番TT変更] Firestore一括保存成功');
    } catch (error) {
      console.error('タイムテーブル更新エラー:', error);
      alert('タイムテーブルの更新に失敗しました。');
    }
    
    // クール直前リハーサルの場合、リハーサルタイムテーブルを本番と同期
    if (eventSettings.rehearsalType === 'cool-pre-rehearsal' && rehearsalTimetable) {
      syncCoolPreRehearsalTimetableInternal(updatedDailyTimetable);
    }
  };

  // 日別タイムテーブルの変更を処理（リハーサル用）
  const handleRehearsalTimetableChange = async (updatedDailyTimetable: DailyTimetable) => {
    if (!rehearsalTimetable || !eventSettings) return;
    
    console.log('[リハTT変更] 日付:', updatedDailyTimetable.date, 'クール数:', updatedDailyTimetable.cools?.length || 0);
    
    // 楽観的更新: ローカル状態を即座に更新
    const updatedDailyTimetables = rehearsalTimetable.dailyTimetables.map(dt =>
      dt.date === updatedDailyTimetable.date ? updatedDailyTimetable : dt
    ).concat(
      // 新しい日付の場合は追加
      rehearsalTimetable.dailyTimetables.some(dt => dt.date === updatedDailyTimetable.date)
        ? []
        : [updatedDailyTimetable]
    );
    
    // 日付リストを取得
    const dateList = (eventSettings.rehearsalType === 'cool-pre-rehearsal' || eventSettings.rehearsalType === 'day-start-rehearsal')
      ? eventSettings.performanceDates
      : eventSettings.rehearsalDates || [];
    
    // 変更された日付以降の全ての日付のクール番号を再計算
    const sortedDates = [...dateList].sort();
    const changedIndex = sortedDates.indexOf(updatedDailyTimetable.date);
    
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
    
    // Firestoreに保存（全日付を一括で保存して競合を防止）
    try {
      await timetableService.updateTimetable(rehearsalTimetable.id, {
        dailyTimetables: updatedTimetable.dailyTimetables,
      });
      console.log('[リハTT変更] Firestore一括保存成功');
    } catch (error) {
      console.error('タイムテーブル更新エラー:', error);
      alert('タイムテーブルの更新に失敗しました。');
    }

    // 当日一括リハーサルの場合、リハーサル終了時刻が本番開始時刻を超えるときのみ自動反映
    if (eventSettings.rehearsalType === 'day-start-rehearsal' && performanceTimetable) {
      const rehearsalEndTime = getRehearsalEndTime(updatedDailyTimetable);
      if (rehearsalEndTime) {
        const performanceDt = performanceTimetable.dailyTimetables.find(
          dt => dt.date === updatedDailyTimetable.date
        );
        // リハーサル終了時刻が本番開始時刻を超える場合のみ更新（早く終わった場合は変更しない）
        if (performanceDt && rehearsalEndTime > performanceDt.startTime) {
          const updatedPerformanceDt: DailyTimetable = {
            ...performanceDt,
            startTime: rehearsalEndTime,
            ...(performanceDt.cools && performanceDt.cools.length > 0
              ? { cools: recalculatePerformanceCoolTimes(performanceDt.cools, rehearsalEndTime) }
              : { entries: recalculatePerformanceEntryTimes(performanceDt.entries || [], rehearsalEndTime) }
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

  // ローディング中
  if (isLoading) {
    return (
      <div className="bg-gray-50 text-gray-900 min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto mb-4"></div>
          <p className="text-lg text-gray-500">イベントを読み込んでいます...</p>
        </div>
      </div>
    );
  }

  // エラー表示
  if (error || !eventSettings) {
    const errorConfig = error === 'not-found' 
      ? {
          icon: '🔍',
          title: 'イベントが見つかりませんでした',
          message: 'このイベントは存在しないか、アクセス権限がありません。',
        }
      : {
          icon: '⚠️',
          title: '読み込みエラー',
          message: 'イベント情報の読み込みに失敗しました。もう一度お試しください。',
        };

    return (
      <div className="bg-gray-50 text-gray-900 min-h-screen flex items-center justify-center">
        <div className="max-w-md w-full mx-auto p-6">
          <div className="text-center">
            <div className="text-6xl mb-4">{errorConfig.icon}</div>
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
      <div className="bg-gray-50 text-gray-900 min-h-screen flex items-center justify-center">
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
  if (isMobile) {
    return (
      <div className="bg-gray-50 text-gray-900 h-screen font-sans flex flex-col overflow-hidden">
        {/* モバイルヘッダー */}
        <MobileHeader
          eventSettings={eventSettings}
          mode={mode}
          onBack={() => navigate('/')}
          onShareToggle={() => setShowSharePanel(!showSharePanel)}
          onSettingsToggle={() => setShowMobileSettings(true)}
          isPublic={eventSettings.isPublic}
        />

        {/* メインコンテンツ */}
        <main className="flex-1 overflow-hidden">
          {mode === 'band-management' ? (
            <MobileBandManagement
              bands={bands}
              eventSettings={eventSettings}
              onBandsChange={handleBandsChange}
            />
          ) : (
            <MobileTimetableView
              bands={bands}
              eventSettings={eventSettings}
              performanceTimetable={performanceTimetable}
              rehearsalTimetable={rehearsalTimetable}
              onPerformanceTimetableChange={handlePerformanceTimetableChange}
              onRehearsalTimetableChange={handleRehearsalTimetableChange}
              selectedBandId={selectedBandId}
              onBandPlaced={() => setSelectedBandId(null)}
              onOpenBandBank={() => setBottomSheetHeight(bottomSheetHeight === 'peek' ? 'half' : 'peek')}
            />
          )}
        </main>

        {/* ボトムシート（タイムテーブルモード時のバンドバンク） */}
        {mode === 'timetable-editing' && (
          <MobileBottomSheet
            height={bottomSheetHeight}
            onHeightChange={setBottomSheetHeight}
            title="バンドバンク"
          >
            <MobileBandBank
              bands={bands}
              timetableType="performance"
              performanceTimetable={performanceTimetable}
              rehearsalTimetable={rehearsalTimetable}
              selectedBandId={selectedBandId}
              onSelectBand={setSelectedBandId}
            />
          </MobileBottomSheet>
        )}

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
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
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
                        {shareUrlCopied ? '✓ コピー済' : 'コピー'}
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
                    <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
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
                      📥 本番タイムテーブルをCSV出力
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
                        📥 リハーサルタイムテーブルをCSV出力
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
                  ⚙️ イベント設定
                </button>
                <button
                  onClick={() => {
                    setShowMobileSettings(false);
                    handleDeleteEvent();
                  }}
                  disabled={isDeleting}
                  className="w-full text-left px-5 py-3 text-sm text-red-600 active:bg-gray-50 disabled:opacity-50"
                >
                  🗑️ {isDeleting ? '削除中...' : 'イベントを削除'}
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
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
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
                <h3 className="text-base font-bold text-gray-900">📩 オーナー権限の移譲リクエスト</h3>
                <button
                  onClick={() => setShowOwnerTransferNotification(false)}
                  className="p-1 rounded-full hover:bg-gray-100 text-gray-400"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
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
              ← 戻る
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
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
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
                        ⚠️ バンド名を含むタイムテーブル情報が公開されます
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
                          {shareUrlCopied ? '✓ コピー済' : 'コピー'}
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
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                        </svg>
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
                              {shareUrlCopied ? '✓ コピー済' : 'コピー'}
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
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>

                    {/* オーナー権限移譲の保留通知（移譲先ユーザーに表示） */}
                    {eventSettings.pendingOwnerEmail
                      && currentUser?.email
                      && eventSettings.pendingOwnerEmail.toLowerCase() === currentUser.email.toLowerCase()
                      && eventSettings.ownerId !== currentUser.uid && (
                      <div className="bg-blue-50 border border-blue-200 rounded-md px-3 py-3 mb-4">
                        <p className="text-sm font-bold text-blue-800 mb-2">📩 オーナー権限の移譲リクエスト</p>
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
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
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
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
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
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
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
                        📥 本番タイムテーブルをCSV出力
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
                          📥 リハーサルタイムテーブルをCSV出力
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
            />
          ) : (
            <TimetableEditing
              bands={bands}
              eventSettings={eventSettings}
              performanceTimetable={performanceTimetable}
              rehearsalTimetable={rehearsalTimetable}
              onPerformanceTimetableChange={handlePerformanceTimetableChange}
              onRehearsalTimetableChange={handleRehearsalTimetableChange}
              onEventSettingsChange={(updates) => {
                setEventSettings(prev => prev ? { ...prev, ...updates } : null);
              }}
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
              <h3 className="text-base font-bold text-gray-900">📩 オーナー権限の移譲リクエスト</h3>
              <button
                onClick={() => setShowOwnerTransferNotification(false)}
                className="p-1 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                title="後で対応する"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
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
    </div>
  );
};
