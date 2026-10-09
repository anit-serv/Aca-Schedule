import { useEffect, useRef, useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { bandService, eventService } from '../services/firestore';
import { deepEqual } from '../utils/deepEqual';
import { applyCustomFieldsChanges, getCustomFieldsChanges, isCustomFieldsChangeConflicted } from '../utils/customFieldsUndoUtils';
import { useUndoRedo } from './useUndoRedo';
import { detectTimetableOperation, isTimetableConflicted } from '../utils/timetableUndoUtils';
import type {
  Band,
  EventSettings,
  Timetable,
  DailyTimetable,
  BandUndoMeta,
  CustomFieldsUndoMeta,
  TimetableOpType,
  UndoRecord,
} from '../types';

interface UseEditorUndoParams {
  performanceTimetableRef: MutableRefObject<Timetable | null>;
  rehearsalTimetableRef: MutableRefObject<Timetable | null>;
  eventSettingsRef: MutableRefObject<EventSettings | null>;
  bandsRef: MutableRefObject<Band[]>;
  setBands: Dispatch<SetStateAction<Band[]>>;
  setEventSettings: Dispatch<SetStateAction<EventSettings | null>>;
  handlePerformanceTimetableChange: (dt: DailyTimetable) => Promise<void>;
  handleRehearsalTimetableChange: (dt: DailyTimetable) => Promise<void>;
}

/**
 * EventEditorPage の Undo/Redo 配線をまとめたフック。
 * - useUndoRedo() の呼び出し
 * - タイムテーブル/バンド/カスタムフィールド操作の UndoRecord プッシュ
 * - WithUndo ラッパー（stale closure対策のためのref経由呼び出し）
 * - Undo/Redo キーボードショートカット
 */
export const useEditorUndo = ({
  performanceTimetableRef,
  rehearsalTimetableRef,
  eventSettingsRef,
  bandsRef,
  setBands,
  setEventSettings,
  handlePerformanceTimetableChange,
  handleRehearsalTimetableChange,
}: UseEditorUndoParams) => {
  // Undo/Redo
  const { pushOperation, undo, redo, canUndo, canRedo, isUndoingRef, skippedOps, clearSkipped } = useUndoRedo();

  // ハンドラーのstale closure回避用ref
  const performanceTimetableChangeRef = useRef<((dt: DailyTimetable) => Promise<void>) | null>(null);
  const rehearsalTimetableChangeRef = useRef<((dt: DailyTimetable) => Promise<void>) | null>(null);
  // WithUndoラッパー（useCallbackで初回クロージャに固定）から常に最新の素のハンドラーを呼ぶためのref
  const rawPerformanceTimetableChangeRef = useRef<((dt: DailyTimetable) => Promise<void>) | null>(null);
  const rawRehearsalTimetableChangeRef = useRef<((dt: DailyTimetable) => Promise<void>) | null>(null);

  // タイムテーブル操作の UndoRecord をプッシュ
  const pushTimetableUndoOp = useCallback((
    timetableType: 'performance' | 'rehearsal',
    date: string,
    beforeDt: DailyTimetable,
    afterDt: DailyTimetable,
    opMeta: { targetId: string; opType: TimetableOpType }
  ) => {
    const record: Omit<UndoRecord, 'id' | 'sessionId' | 'timestamp' | 'invalidated'> = {
      targetId: opMeta.targetId,
      opType: opMeta.opType,
      undo: async () => {
        const handler = timetableType === 'performance'
          ? performanceTimetableChangeRef.current
          : rehearsalTimetableChangeRef.current;
        if (handler) await handler(beforeDt);
      },
      redo: async () => {
        const handler = timetableType === 'performance'
          ? performanceTimetableChangeRef.current
          : rehearsalTimetableChangeRef.current;
        if (handler) await handler(afterDt);
      },
      isConflicted: (direction) => {
        const timetable = timetableType === 'performance'
          ? performanceTimetableRef.current
          : rehearsalTimetableRef.current;
        const currentDt = timetable?.dailyTimetables.find(dt => dt.date === date);
        const expectedDt = direction === 'undo' ? afterDt : beforeDt;
        return isTimetableConflicted(currentDt, opMeta.targetId, opMeta.opType, expectedDt);
      },
    };
    pushOperation(record);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushOperation]);

  // バンド操作の UndoRecord をプッシュ
  const handleBandUndoRecord = useCallback((meta: BandUndoMeta) => {
    const { opType, before, after } = meta;
    const targetId = (before?.id ?? after?.id) as string;

    const record: Omit<UndoRecord, 'id' | 'sessionId' | 'timestamp' | 'invalidated'> = {
      targetId,
      opType,
      undo: async () => {
        if (opType === 'band:add') {
          await bandService.deleteBand(targetId);
        } else if (opType === 'band:delete' && before) {
          await bandService.addBand(before, eventSettingsRef.current!.id);
          setBands(prev => [...prev, before]);
        } else if (opType === 'band:update' && before) {
          // updateBand 内部で id/createdAt/updatedAt は除外・再設定されるため、そのまま渡す
          await bandService.updateBand(targetId, before);
          setBands(prev => prev.map(b => b.id === targetId ? before : b));
        }
      },
      redo: async () => {
        if (opType === 'band:add' && after) {
          await bandService.addBand(after, eventSettingsRef.current!.id);
          setBands(prev => [...prev, after]);
        } else if (opType === 'band:delete') {
          await bandService.deleteBand(targetId);
        } else if (opType === 'band:update' && after) {
          // updateBand 内部で id/createdAt/updatedAt は除外・再設定されるため、そのまま渡す
          await bandService.updateBand(targetId, after);
          setBands(prev => prev.map(b => b.id === targetId ? after : b));
        }
      },
      isConflicted: (direction) => {
        const current = bandsRef.current.find(b => b.id === targetId);
        const expected = direction === 'undo' ? after : before;
        if (!expected) {
          return !!current;
        }
        if (!current) {
          return true;
        }
        // updatedAt は updateBand 実行のたびに再設定されるため比較対象から除外
        // （含めると常に不一致となり、外部変更がなくても競合扱いになってしまう）
        const omitUpdatedAt = (band: Band): Omit<Band, 'updatedAt'> => {
          const rest = { ...band };
          delete (rest as Partial<Band>).updatedAt;
          return rest;
        };
        return !deepEqual(omitUpdatedAt(current), omitUpdatedAt(expected));
      },
    };
    pushOperation(record);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushOperation]);

  // カスタムフィールド操作の UndoRecord をプッシュ
  const handleCustomFieldsUndoRecord = useCallback((meta: CustomFieldsUndoMeta) => {
    const { opType, targetId, before, after } = meta;
    const changes = getCustomFieldsChanges(before, after);
    if (changes.length === 0) return;

    const record: Omit<UndoRecord, 'id' | 'sessionId' | 'timestamp' | 'invalidated'> = {
      targetId,
      opType,
      undo: async () => {
        const id = eventSettingsRef.current!.id;
        const updated = applyCustomFieldsChanges(eventSettingsRef.current!.customFields!, changes, 'undo');
        await eventService.updateEvent(id, { customFields: updated });
        setEventSettings(prev => prev ? { ...prev, customFields: updated } : null);
      },
      redo: async () => {
        const id = eventSettingsRef.current!.id;
        const updated = applyCustomFieldsChanges(eventSettingsRef.current!.customFields!, changes, 'redo');
        await eventService.updateEvent(id, { customFields: updated });
        setEventSettings(prev => prev ? { ...prev, customFields: updated } : null);
      },
      isConflicted: (direction) => {
        return isCustomFieldsChangeConflicted(eventSettingsRef.current?.customFields, changes, direction);
      },
    };
    pushOperation(record);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushOperation]);

  // 常に最新の素のハンドラーをrefに同期（WithUndoラッパーのstale closure対策）
  rawPerformanceTimetableChangeRef.current = handlePerformanceTimetableChange;
  rawRehearsalTimetableChangeRef.current = handleRehearsalTimetableChange;

  // undo記録付きラッパー（本番タイムテーブル）
  const handlePerformanceTimetableChangeWithUndo = useCallback(async (updatedDailyTimetable: DailyTimetable) => {
    if (!isUndoingRef.current && performanceTimetableRef.current) {
      const beforeDt = performanceTimetableRef.current.dailyTimetables.find(
        dt => dt.date === updatedDailyTimetable.date
      );
      const opMeta = detectTimetableOperation(beforeDt, updatedDailyTimetable);
      if (opMeta && beforeDt) {
        pushTimetableUndoOp(
          'performance',
          updatedDailyTimetable.date,
          beforeDt,
          updatedDailyTimetable,
          opMeta
        );
      }
    }
    await rawPerformanceTimetableChangeRef.current?.(updatedDailyTimetable);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUndoingRef, pushTimetableUndoOp]);

  // undo記録付きラッパー（リハーサルタイムテーブル）
  const handleRehearsalTimetableChangeWithUndo = useCallback(async (updatedDailyTimetable: DailyTimetable) => {
    if (!isUndoingRef.current && rehearsalTimetableRef.current) {
      const beforeDt = rehearsalTimetableRef.current.dailyTimetables.find(
        dt => dt.date === updatedDailyTimetable.date
      );
      const opMeta = detectTimetableOperation(beforeDt, updatedDailyTimetable);
      if (opMeta && beforeDt) {
        pushTimetableUndoOp(
          'rehearsal',
          updatedDailyTimetable.date,
          beforeDt,
          updatedDailyTimetable,
          opMeta
        );
      }
    }
    await rawRehearsalTimetableChangeRef.current?.(updatedDailyTimetable);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUndoingRef, pushTimetableUndoOp]);

  // refを常に最新のラッパーに更新
  performanceTimetableChangeRef.current = handlePerformanceTimetableChangeWithUndo;
  rehearsalTimetableChangeRef.current = handleRehearsalTimetableChangeWithUndo;

  // Undo/Redo キーボードショートカット
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod) return;
      // テキスト入力中は無視
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return;
      if (e.key === 'z' || e.key === 'Z') {
        if (e.shiftKey) {
          e.preventDefault();
          void redo();
        } else {
          e.preventDefault();
          void undo();
        }
      }
      if ((e.key === 'y' || e.key === 'Y') && !e.shiftKey) {
        e.preventDefault();
        void redo();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  return {
    pushOperation,
    canUndo,
    canRedo,
    undo,
    redo,
    skippedOps,
    clearSkipped,
    isUndoingRef,
    handleBandUndoRecord,
    handleCustomFieldsUndoRecord,
    handlePerformanceTimetableChangeWithUndo,
    handleRehearsalTimetableChangeWithUndo,
  };
};
