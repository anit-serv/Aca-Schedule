import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { BandManagement } from '../components/BandManagement';
import { TimetableEditing } from '../components/TimetableEditing';
import { EventSettingsModal } from '../components/EventSettingsModal';
import { bandService, timetableService, eventService } from '../services/firestore';
import { timetableToCSV, downloadCSV } from '../utils/timetableExport';
import type { Band, EventSettings, Timetable, DailyTimetable, Cool, TimetableEntry } from '../types';

// モードを定義するための型
type Mode = 'band-management' | 'timetable-editing';

export const EventEditorPage = () => {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  
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

  // イベント設定の読み込み
  useEffect(() => {
    if (!eventId) {
      setError('not-found');
      setIsLoading(false);
      return;
    }

    const loadEvent = async () => {
      try {
        console.log('[EventEditorPage] イベント読み込み開始:', eventId);
        const settings = await eventService.getEvent(eventId);
        console.log('[EventEditorPage] イベント読み込み結果:', settings);
        
        if (!settings) {
          console.error('[EventEditorPage] イベントが見つかりません:', eventId);
          setError('not-found');
          setIsLoading(false);
          return;
        }
        
        setEventSettings(settings);
        setIsLoading(false);
        console.log('[EventEditorPage] イベント読み込み成功');
      } catch (err) {
        console.error('[EventEditorPage] イベント読み込みエラー:', err);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const errorCode = (err as any)?.code;
        
        // permission-deniedとnot-foundは同じエラーとして扱う（セキュリティのため）
        if (errorCode === 'permission-denied' || errorCode === 'not-found') {
          setError('not-found');
        } else {
          setError('unknown');
        }
        setIsLoading(false);
      }
    };

    loadEvent();
  }, [eventId]);

  // バンドデータの読み込み
  useEffect(() => {
    if (!eventId) return;
    
    // リアルタイム監視を設定
    const unsubscribe = bandService.subscribeToBands(eventId, (fetchedBands) => {
      setBands(fetchedBands);
      // 初回読み込み時: バンドが1つ以上あればタイムテーブル編集画面を開く
      if (!initialModeSetRef.current) {
        initialModeSetRef.current = true;
        if (fetchedBands.length > 0) {
          setMode('timetable-editing');
        }
      }
    });

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
      <div className="bg-gray-900 text-white min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-lg text-gray-400">イベントを読み込んでいます...</p>
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
      <div className="bg-gray-900 text-white min-h-screen flex items-center justify-center">
        <div className="max-w-md w-full mx-auto p-6">
          <div className="text-center">
            <div className="text-6xl mb-4">{errorConfig.icon}</div>
            <h1 className="text-2xl font-bold mb-2">{errorConfig.title}</h1>
            <p className="text-gray-400 mb-6">{errorConfig.message}</p>
            <button
              onClick={() => navigate('/')}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-md font-medium transition-colors"
            >
              マイイベントに戻る
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    // 全体を囲むコンテナ。ダークテーマの背景色とテキスト色を設定
    <div className="bg-gray-900 text-white h-screen font-sans flex flex-col overflow-hidden">
      {/* ヘッダーセクション */}
      <header className="bg-gray-800 shadow-lg flex-shrink-0">
        <nav className="max-w-7xl mx-auto px-6 py-3 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/')}
              className="text-gray-400 hover:text-white transition-colors text-sm"
              title="マイイベントに戻る"
            >
              ← 戻る
            </button>
            <div>
              <h1 className="text-xl font-bold">{eventSettings.name}</h1>
              <p className="text-sm text-gray-400">{eventSettings.year}年 @ {eventSettings.venue}</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setMode('band-management')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors duration-200 ${
                mode === 'band-management'
                  ? 'bg-blue-600 text-white' // アクティブなボタンのスタイル
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600' // 非アクティブなボタンのスタイル
              }`}
            >
              バンド管理
            </button>
            <button
              onClick={() => setMode('timetable-editing')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors duration-200 ${
                mode === 'timetable-editing'
                  ? 'bg-blue-600 text-white' // アクティブなボタンのスタイル
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600' // 非アクティブなボタンのスタイル
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
                    ? 'bg-green-700 text-green-100 hover:bg-green-600'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
                title="共有設定"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
              </button>
              
              {/* 共有パネル */}
              {showSharePanel && (
                <div className="absolute right-0 mt-2 w-80 bg-gray-800 rounded-lg shadow-lg border border-gray-700 z-50 p-4">
                  <h3 className="text-sm font-bold text-white mb-3">共有設定</h3>
                  
                  {/* 公開トグル */}
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-sm text-gray-300">閲覧用ページを公開</p>
                      <p className="text-xs text-gray-500 mt-0.5">リンクを知っている人が閲覧できます</p>
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
                        eventSettings.isPublic ? 'bg-green-600' : 'bg-gray-600'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          eventSettings.isPublic ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                  
                  {/* 注意書き */}
                  {eventSettings.isPublic && (
                    <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-md px-3 py-2 mb-3">
                      <p className="text-xs text-yellow-300">
                        ⚠️ バンド名を含むタイムテーブル情報が公開されます
                      </p>
                    </div>
                  )}
                  
                  {/* URL表示・コピー */}
                  {eventSettings.isPublic && (
                    <div>
                      <p className="text-xs text-gray-400 mb-1.5">共有URL</p>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          readOnly
                          value={`${window.location.origin}/share/${eventSettings.id}`}
                          className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-300 font-mono truncate"
                          onClick={(e) => (e.target as HTMLInputElement).select()}
                        />
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(`${window.location.origin}/share/${eventSettings.id}`);
                            setShareUrlCopied(true);
                            setTimeout(() => setShareUrlCopied(false), 2000);
                          }}
                          className="px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors whitespace-nowrap"
                        >
                          {shareUrlCopied ? '✓ コピー済' : 'コピー'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            
            {/* 設定メニュー */}
            <div className="relative settings-menu-container">
              <button
                onClick={() => setShowSettingsMenu(!showSettingsMenu)}
                className="p-2 rounded-md bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors duration-200"
                title="設定"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
              
              {/* ドロップダウンメニュー */}
              {showSettingsMenu && (
                <div className="absolute right-0 mt-2 w-48 bg-gray-800 rounded-md shadow-lg border border-gray-700 z-50">
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
                        className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors duration-200"
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
                          className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors duration-200"
                        >
                          📥 リハーサルタイムテーブルをCSV出力
                        </button>
                      )}
                      <div className="border-t border-gray-700" />
                    </>
                  )}
                  
                  <button
                    onClick={() => {
                      setShowSettingsMenu(false);
                      setShowSettingsModal(true);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors duration-200"
                  >
                    イベント設定
                  </button>
                  <button
                    onClick={() => {
                      setShowSettingsMenu(false);
                      handleDeleteEvent();
                    }}
                    disabled={isDeleting}
                    className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-gray-700 rounded-b-md transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
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
    </div>
  );
};
