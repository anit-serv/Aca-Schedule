import { useState, useCallback, useMemo, useRef, useEffect, type ReactNode } from 'react';
import type { Band, EventSettings, Timetable, DailyTimetable, CustomFieldsSettings, CustomColumn, CustomFieldsUndoMeta, TimetableEntry } from '../types';
import {
  getTypeData,
  getEntriesWithCoolInfo,
  getCellData,
  setCellValue,
  isMergedChild,
  mergeCells,
  unmergeCells,
  updateShiftSlot,
} from '../utils/customFieldsUtils';
import { getOverlappingShiftAssignees, getShiftSlotAt, getShiftSlots, type ShiftSlotAction } from '../utils/customShift';
import { ShiftSlotCell } from './ShiftSlotCell';
import { Icon } from './Icon';
import { motion } from 'framer-motion';

const columnMotion = {
  initial: { width: 0, opacity: 0 },
  animate: { width: 160, opacity: 1 },
  exit: { width: 0, opacity: 0 },
  transition: { duration: 0.24, ease: 'easeInOut' as const },
};

interface CustomFieldsTableProps {
  currentTimetable: DailyTimetable;
  bands: Band[];
  timetable: Timetable | null;
  eventSettings: EventSettings;
  timetableType: 'performance' | 'rehearsal';
  selectedDate: string;
  onCustomFieldsChange: (customFields: CustomFieldsSettings) => void;
  onUndoRecord?: (meta: CustomFieldsUndoMeta) => void;
  readOnly?: boolean;
  visibleCoolIds?: string[];
  disablePerformanceBottomSpacer?: boolean;
  customMode: boolean;
  renderTable: (columns: CustomColumn[], renderCell: (entry: TimetableEntry, column: CustomColumn, index: number) => ReactNode, enteringColumnIds: ReadonlySet<string>) => ReactNode;
}

// 範囲選択の状態
interface SelectionRange {
  colId: string;
  startSeq: number;
  endSeq: number;
}

// セル座標
interface CellCoord {
  seq: number;
  colIndex: number;
}

export const CustomFieldsEditor = ({
  currentTimetable,
  bands,
  timetable,
  eventSettings,
  timetableType,
  selectedDate,
  onCustomFieldsChange,
  onUndoRecord,
  readOnly,
  visibleCoolIds,
  customMode,
  renderTable,
}: CustomFieldsTableProps) => {
  // 読み取り専用モード
  const isReadOnly = !customMode || (readOnly ?? false);

  // セル入力値のローカルバッファ（キー: "seq:colId"）
  const [cellValues, setCellValues] = useState<Record<string, string>>({});
  // フォーカス中のセル座標
  const [focusedCell, setFocusedCell] = useState<CellCoord | null>(null);
  // 範囲選択状態
  const [selection, setSelection] = useState<SelectionRange | null>(null);
  // ツールバー表示位置（Y座標）
  const [toolbarY, setToolbarY] = useState<number>(100);
  // ドラッグ中フラグ
  const [isDragging, setIsDragging] = useState(false);
  // エラー表示
  const [mergeError, setMergeError] = useState<string | null>(null);
  // 右クリックメニュー
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; seq: number; colId: string } | null>(null);
  // 再結合確認ダイアログ
  const [mergeConfirmDialog, setMergeConfirmDialog] = useState<{ show: boolean; message?: string; callback: () => void } | null>(null);
  // デバウンス用タイマー
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // セル編集開始時のundo用スナップショット
  const cellEditBeforeRef = useRef<CustomFieldsSettings | null>(null);
  const cellEditTargetIdRef = useRef<string | null>(null);
  // ドラッグ開始位置（結合セル情報含む）
  const dragStartRef = useRef<{ seq: number; colId: string; mergedEndSeq?: number; startY: number } | null>(null);
  // タッチ長押し検出用
  const touchStartRef = useRef<{ seq: number; colId: string; col: CustomColumn; x: number; y: number; timer: ReturnType<typeof setTimeout> | null } | null>(null);
  // タッチ長押し待機中フラグ（ネイティブテキスト選択を抑制するため）
  const [isTouchPending, setIsTouchPending] = useState(false);
  // タッチ端末で編集中のセル（ダブルタップ後のみ入力可能）
  const [editingCellKey, setEditingCellKey] = useState<string | null>(null);
  // タッチデバイスかどうかの検出
  const isTouchDevice = useRef(false);
  // ダブルタップ検出用：前回タップされたセルキー
  const lastTappedCellRef = useRef<string | null>(null);
  // input要素のrefマップ
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  // IME変換中フラグ（キー: "seq:colId"）
  const isComposingRef = useRef<Map<string, boolean>>(new Map());

  const customFields = eventSettings.customFields;
  const typeData = getTypeData(customFields, timetableType);
  const columns = useMemo(
    () => [...typeData.columns].sort((a, b) => a.order - b.order),
    [typeData.columns]
  );
  // Mounting again after a page/date change should show existing columns immediately.
  const previousColumnsRef = useRef<{ active: boolean; ids: Set<string> }>({
    active: customMode,
    ids: new Set(columns.map(column => column.id)),
  });
  const enteringColumnIds = new Set(
    customMode
      ? columns.filter(column => !previousColumnsRef.current.active || !previousColumnsRef.current.ids.has(column.id)).map(column => column.id)
      : []
  );
  useEffect(() => {
    previousColumnsRef.current = { active: customMode, ids: new Set(columns.map(column => column.id)) };
  }, [customMode, columns]);

  // エントリー一覧（クール情報付き）
  const entries = useMemo(() => {
    const allEntries = getEntriesWithCoolInfo(currentTimetable);
    if (!visibleCoolIds || visibleCoolIds.length === 0) {
      return allEntries;
    }
    const visibleSet = new Set(visibleCoolIds);
    return allEntries.filter(entry => entry.coolId && visibleSet.has(entry.coolId));
  }, [currentTimetable, visibleCoolIds]);

  const entryInfoById = useMemo(() => new Map(entries.map(entry => [entry.entryId, entry])), [entries]);

  // セルキー生成
  const cellKey = (seq: number, colId: string) => `${seq}:${colId}`;

  // クールIDマップを作成（seqからcoolIdを高速検索）
  const seqToCoolMap = useMemo(() => {
    const map = new Map<number, string | undefined>();
    for (const entry of entries) {
      map.set(entry.sequenceNumber, entry.coolId);
    }
    return map;
  }, [entries]);

  // 指定seqのクールIDを取得
  const getSeqCoolId = useCallback(
    (seq: number): string | undefined => seqToCoolMap.get(seq),
    [seqToCoolMap]
  );

  // 2つのseqが同じクール内にあるか判定
  const isSameCool = useCallback(
    (seq1: number, seq2: number): boolean => {
      const cool1 = getSeqCoolId(seq1);
      const cool2 = getSeqCoolId(seq2);
      // クールがない（フラット構造）の場合はtrue
      if (!cool1 && !cool2) return true;
      return cool1 === cool2;
    },
    [getSeqCoolId]
  );

  // セル値の取得（ローカルバッファ優先）
  const getCellValue = useCallback(
    (seq: number, entryId: string, col: CustomColumn): string => {
      const key = cellKey(seq, col.id);
      if (key in cellValues) return cellValues[key];
      const cellData = getCellData(customFields, timetableType, selectedDate, col, seq, entryId);
      return cellData.value;
    },
    [cellValues, customFields, timetableType, selectedDate]
  );

  // データやエントリー順序が変わったらバッファをクリア
  useEffect(() => {
    setCellValues({});
  }, [selectedDate, timetableType, customFields, entries]);

  // entries が変更されたら focusedCell と selection の有効性をチェック
  useEffect(() => {
    if (entries.length === 0) {
      setFocusedCell(null);
      setSelection(null);
      return;
    }

    const validSeqs = new Set(entries.map(e => e.sequenceNumber));

    // focusedCell が無効な seq を参照している場合はクリア
    if (focusedCell && !validSeqs.has(focusedCell.seq)) {
      setFocusedCell(null);
    }

    // selection が無効な範囲を参照している場合はクリア
    if (selection) {
      const minSeq = Math.min(selection.startSeq, selection.endSeq);
      const maxSeq = Math.max(selection.startSeq, selection.endSeq);
      // 範囲内のすべての seq が有効かチェック
      let hasInvalidSeq = false;
      for (let seq = minSeq; seq <= maxSeq; seq++) {
        if (!validSeqs.has(seq)) {
          hasInvalidSeq = true;
          break;
        }
      }
      if (hasInvalidSeq) {
        setSelection(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- focusedCell/selection は更新トリガーではなく読み取り対象
  }, [entries]);

  // デバウンス付き保存
  const debouncedSave = useCallback(
    (seq: number, entryId: string, col: CustomColumn, value: string) => {
      if (!customFields) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        const identifier = col.bindingType === 'sequence' ? seq : entryId;
        const updated = setCellValue(customFields, timetableType, selectedDate, col, identifier, value);
        onCustomFieldsChange(updated);
      }, 500);
    },
    [customFields, timetableType, selectedDate, onCustomFieldsChange]
  );

  // アンマウント時タイマークリア
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // セル値変更ハンドラー
  const handleCellChange = useCallback(
    (seq: number, entryId: string, col: CustomColumn, value: string) => {
      const key = cellKey(seq, col.id);
      const targetId = `cell:${seq}:${col.id}`;
      // 編集開始時のbefore状態を記録（同セルの連続入力では更新しない）
      if (cellEditTargetIdRef.current !== targetId) {
        cellEditBeforeRef.current = customFields ?? null;
        cellEditTargetIdRef.current = targetId;
      }
      setCellValues(prev => ({ ...prev, [key]: value }));
      // IME変換中は保存をスキップ（compositionendで保存される）
      if (!isComposingRef.current.get(key)) {
        debouncedSave(seq, entryId, col, value);
      }
    },
    [debouncedSave, customFields]
  );

  // IME変換開始ハンドラー
  const handleCompositionStart = useCallback((seq: number, colId: string) => {
    const key = cellKey(seq, colId);
    isComposingRef.current.set(key, true);
  }, []);

  // IME変換終了ハンドラー
  const handleCompositionEnd = useCallback(
    (seq: number, entryId: string, col: CustomColumn, value: string) => {
      const key = cellKey(seq, col.id);
      isComposingRef.current.set(key, false);
      // 変換確定後に保存
      setCellValues(prev => ({ ...prev, [key]: value }));
      debouncedSave(seq, entryId, col, value);
    },
    [debouncedSave]
  );

  // 即時保存（blur時）
  const handleCellBlur = useCallback(
    (seq: number, entryId: string, col: CustomColumn) => {
      if (!customFields) return;
      const key = cellKey(seq, col.id);
      if (!(key in cellValues)) return;
      // タイマーキャンセルして即時保存
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const identifier = col.bindingType === 'sequence' ? seq : entryId;
      const updated = setCellValue(customFields, timetableType, selectedDate, col, identifier, cellValues[key]);
      const targetId = `cell:${seq}:${col.id}`;
      if (onUndoRecord && cellEditBeforeRef.current && cellEditTargetIdRef.current === targetId) {
        onUndoRecord({ targetId, opType: 'customCell:set', before: cellEditBeforeRef.current, after: updated });
        cellEditBeforeRef.current = null;
        cellEditTargetIdRef.current = null;
      }
      onCustomFieldsChange(updated);
    },
    [customFields, cellValues, timetableType, selectedDate, onCustomFieldsChange, onUndoRecord]
  );

  // ===== 範囲選択 =====

  // 結合セル情報取得ヘルパー（seqが結合親の場合、rowSpanを返す）
  const getMergedSpan = useCallback(
    (colId: string, seq: number): number => {
      if (!customFields) return 1;
      const col = columns.find(c => c.id === colId);
      if (!col) return 1;
      const cellData = getCellData(customFields, timetableType, selectedDate, col, seq, '');
      return (cellData.rowSpan && cellData.rowSpan > 1) ? cellData.rowSpan : 1;
    },
    [customFields, columns, timetableType, selectedDate]
  );

  // 結合子セルの親seqを探すヘルパー（子でなければそのまま返す）
  const getMergedParentSeq = useCallback(
    (colId: string, seq: number): number => {
      if (!customFields) return seq;
      // 結合子でなければそのまま返す
      if (!isMergedChild(customFields, timetableType, selectedDate, colId, seq)) return seq;
      // 上方向にスキャンして親（rowSpan > 1）を探す
      const seqList = entries.map(en => en.sequenceNumber);
      const idx = seqList.indexOf(seq);
      for (let i = idx - 1; i >= 0; i--) {
        const candidateSeq = seqList[i];
        const span = getMergedSpan(colId, candidateSeq);
        if (span > 1 && candidateSeq + span - 1 >= seq) {
          return candidateSeq;
        }
        // 結合子でもなく結合親でもないセルに到達したら終了
        if (!isMergedChild(customFields, timetableType, selectedDate, colId, candidateSeq)) {
          break;
        }
      }
      return seq; // フェイルセーフ
    },
    [customFields, timetableType, selectedDate, entries, getMergedSpan]
  );

  // マウスダウン（範囲選択開始）
  const handleMouseDown = useCallback(
    (seq: number, colId: string, col: CustomColumn, e: React.MouseEvent) => {
      if (isReadOnly) return;
      if (col.bindingType !== 'sequence') return; // sequence型のみ範囲選択可能

      // 結合セルかチェック
      const cellData = getCellData(customFields, timetableType, selectedDate, col, seq, '');
      const isMergedCell = cellData.rowSpan && cellData.rowSpan > 1;
      const mergedEndSeq = isMergedCell ? seq + (cellData.rowSpan || 1) - 1 : undefined;

      if (e.shiftKey) {
        // Shift+クリック: 範囲拡張 or 新規範囲選択
        e.preventDefault();
        // 方向を判定して適切なendSeqを決定
        const baseSeq = selection?.startSeq ?? focusedCell?.seq ?? seq;
        const isUpward = seq < baseSeq;
        // 上方向: 結合セルの先頭(seq)、下方向: 結合セルの末尾(mergedEndSeq)
        const targetEndSeq = isMergedCell ? (isUpward ? seq : (mergedEndSeq ?? seq)) : seq;
        if (selection && selection.colId === colId) {
          // 既存選択がある場合: 範囲拡張（toolbarYは更新しない）
          if (isSameCool(selection.startSeq, seq)) {
            setSelection(prev => prev ? { ...prev, endSeq: targetEndSeq } : { colId, startSeq: seq, endSeq: targetEndSeq });
          }
        } else if (focusedCell && columns[focusedCell.colIndex]?.id === colId) {
          // 選択はないが同じ列にフォーカスセルがある場合: フォーカスセルを起点に範囲選択（新規選択なのでtoolbarY更新）
          if (isSameCool(focusedCell.seq, seq)) {
            setSelection({ colId, startSeq: focusedCell.seq, endSeq: targetEndSeq });
            setToolbarY(e.clientY);
          }
        } else {
          // 完全に新規の選択（toolbarY更新）
          setSelection({ colId, startSeq: seq, endSeq: targetEndSeq });
          setToolbarY(e.clientY);
        }
        return;
      }

      // 通常クリック: 選択をクリアし、ドラッグ開始位置を記録（inputフォーカスを妨げない）
      setSelection(null);
      dragStartRef.current = { seq, colId, mergedEndSeq, startY: e.clientY };
      setIsDragging(true);
    },
    [isReadOnly, selection, focusedCell, columns, isSameCool, customFields, timetableType, selectedDate]
  );

  // マウスムーブ（ドラッグ選択拡張）
  const handleMouseMove = useCallback(
    (seq: number, colId: string) => {
      if (!isDragging) return;
      const start = dragStartRef.current;
      if (!start || start.colId !== colId) return;
      // 結合セルからドラッグ: 結合範囲全体を起点とする
      const startSeq = start.seq;
      const startEndSeq = start.mergedEndSeq ?? start.seq;

      // 起点範囲内に戻った場合は選択解除
      if (seq >= startSeq && seq <= startEndSeq) {
        setSelection(null);
        return;
      }

      if (isSameCool(startSeq, seq)) {
        // ドラッグ先の結合セル情報も考慮
        const dragTargetSpan = getMergedSpan(colId, seq);
        const dragTargetEnd = seq + dragTargetSpan - 1;
        // 下方向: startからdragTargetEndまで、上方向: seqからstartEndSeqまで
        if (seq > startEndSeq) {
          setSelection({ colId, startSeq, endSeq: dragTargetEnd });
        } else if (seq < startSeq) {
          setSelection({ colId, startSeq: startEndSeq, endSeq: seq });
        }
        // ドラッグ開始位置のtoolbarYを設定（選択開始セルの位置に固定）
        setToolbarY(start.startY);
      }
    },
    [isDragging, isSameCool, getMergedSpan]
  );

  // マウスアップ（範囲選択確定）
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isDragging) {
        setIsDragging(false);
        dragStartRef.current = null;
      }
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [isDragging]);

  // ===== タッチ操作による範囲選択 =====

  const handleTouchStart = useCallback(
    (seq: number, colId: string, col: CustomColumn, e: React.TouchEvent) => {
      if (isReadOnly) return;
      if (col.bindingType !== 'sequence') return;

      isTouchDevice.current = true;
      const touch = e.touches[0];
      setIsTouchPending(true);
      const timer = setTimeout(() => {
        // 長押し確定
        if (navigator.vibrate) navigator.vibrate(50);

        // ネイティブテキスト選択をクリア
        window.getSelection()?.removeAllRanges();

        // 結合セルかチェック
        const cellData = getCellData(customFields, timetableType, selectedDate, col, seq, '');
        const isMergedCell = cellData.rowSpan && cellData.rowSpan > 1;
        const mergedEndSeq = isMergedCell ? seq + (cellData.rowSpan || 1) - 1 : undefined;

        if (isMergedCell) {
          // 結合セルの長押し → コンテキストメニュー表示
          setContextMenu({ x: touch.clientX, y: touch.clientY, seq, colId });
        } else {
          // 通常セルの長押し → 範囲選択モード開始
          setSelection({ colId, startSeq: seq, endSeq: seq });
          dragStartRef.current = { seq, colId, mergedEndSeq, startY: touch.clientY };
          setToolbarY(touch.clientY);
          setIsDragging(true);
        }

        // inputからフォーカスを外す（キーボードを閉じる）
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }

        setIsTouchPending(false);
        touchStartRef.current = null;
      }, 500);

      touchStartRef.current = { seq, colId, col, x: touch.clientX, y: touch.clientY, timer };
    },
    [isReadOnly, customFields, timetableType, selectedDate]
  );

  const handleTouchMoveCell = useCallback(
    (e: React.TouchEvent) => {
      if (!touchStartRef.current) return;
      const touch = e.touches[0];
      const dx = touch.clientX - touchStartRef.current.x;
      const dy = touch.clientY - touchStartRef.current.y;
      // 8px以上動いたら長押しキャンセル（通常スクロール）
      if (Math.sqrt(dx * dx + dy * dy) > 8) {
        if (touchStartRef.current.timer) {
          clearTimeout(touchStartRef.current.timer);
        }
        touchStartRef.current = null;
        setIsTouchPending(false);
      }
    },
    []
  );

  const handleTouchEndCell = useCallback(() => {
    if (touchStartRef.current?.timer) {
      clearTimeout(touchStartRef.current.timer);
    }
    touchStartRef.current = null;
    setIsTouchPending(false);
  }, []);

  // タッチドラッグで範囲拡張（isDragging時のみグローバルリスナーを登録）
  useEffect(() => {
    if (!isDragging) return;

    const handleTouchMove = (e: TouchEvent) => {
      const start = dragStartRef.current;
      if (!start) return;

      if (e.cancelable) e.preventDefault(); // スクロール抑制
      const touch = e.touches[0];
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      if (!el) return;

      const td = el.closest('td[data-seq][data-col-id]');
      if (!td) return;

      const seqAttr = td.getAttribute('data-seq');
      const colIdAttr = td.getAttribute('data-col-id');
      if (!seqAttr || !colIdAttr || colIdAttr !== start.colId) return;

      const seq = parseInt(seqAttr, 10);
      if (isNaN(seq)) return;

      const startSeq = start.seq;
      const startEndSeq = start.mergedEndSeq ?? start.seq;

      // 起点範囲内に戻った場合は起点のみ選択
      if (seq >= startSeq && seq <= startEndSeq) {
        setSelection({ colId: start.colId, startSeq, endSeq: startEndSeq });
        return;
      }

      if (isSameCool(startSeq, seq)) {
        const dragTargetSpan = getMergedSpan(start.colId, seq);
        const dragTargetEnd = seq + dragTargetSpan - 1;
        if (seq > startEndSeq) {
          setSelection({ colId: start.colId, startSeq, endSeq: dragTargetEnd });
        } else if (seq < startSeq) {
          setSelection({ colId: start.colId, startSeq: startEndSeq, endSeq: seq });
        }
      }
    };

    const handleTouchEnd = () => {
      setIsDragging(false);
      dragStartRef.current = null;
    };

    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
    return () => {
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isDragging, isSameCool, getMergedSpan]);

  // セルが選択範囲内かどうか
  const isCellSelected = useCallback(
    (seq: number, colId: string): boolean => {
      if (!selection || selection.colId !== colId) return false;
      const minSeq = Math.min(selection.startSeq, selection.endSeq);
      const maxSeq = Math.max(selection.startSeq, selection.endSeq);
      return seq >= minSeq && seq <= maxSeq;
    },
    [selection]
  );

  // 選択範囲のサイズ
  const selectionSize = useMemo(() => {
    if (!selection) return 0;
    return Math.abs(selection.endSeq - selection.startSeq) + 1;
  }, [selection]);

  // 選択範囲内の全結合セルを検出
  const getSelectionMerges = useCallback(
    (colId: string, startSeq: number, endSeq: number): number[] => {
      if (!customFields) return [];
      const merges: number[] = [];
      const minSeq = Math.min(startSeq, endSeq);
      const maxSeq = Math.max(startSeq, endSeq);
      const col = columns.find(c => c.id === colId);
      if (!col) return [];

      for (let seq = minSeq; seq <= maxSeq; seq++) {
        const cellData = getCellData(customFields, timetableType, selectedDate, col, seq, '');
        if (cellData.rowSpan && cellData.rowSpan > 1) {
          merges.push(seq);
        }
      }
      return merges;
    },
    [customFields, columns, timetableType, selectedDate]
  );

  // ===== 結合/結合解除 =====

  const handleMerge = useCallback(() => {
    if (!selection || !customFields) return;
    const startSeq = Math.min(selection.startSeq, selection.endSeq);
    const endSeq = Math.max(selection.startSeq, selection.endSeq);
    if (startSeq === endSeq) return;

    // 範囲内に既存の結合セルがあるかチェック
    const existingMerges = getSelectionMerges(selection.colId, startSeq, endSeq);

    // 範囲内の入力値を収集
    const col = columns.find(c => c.id === selection.colId);
    const valuesInRange: string[] = [];
    if (col) {
      for (let seq = startSeq; seq <= endSeq; seq++) {
        const cellData = getCellData(customFields, timetableType, selectedDate, col, seq, '');
        if (cellData.value && cellData.value.trim()) {
          valuesInRange.push(cellData.value);
        }
      }
    }

    const doMerge = (base: CustomFieldsSettings) => {
      const result = mergeCells(base, timetableType, selectedDate, selection.colId, startSeq, endSeq, timetable);
      if (result.error) {
        setMergeError(result.error);
        setTimeout(() => setMergeError(null), 3000);
      } else {
        if (onUndoRecord && customFields) {
          onUndoRecord({ targetId: `cell:${startSeq}:${selection.colId}`, opType: 'customCell:merge', before: customFields, after: result.settings });
        }
        onCustomFieldsChange(result.settings);
        setSelection(null);
      }
    };

    // 確認が必要なケース：複数値あり（2つ以上）
    const needsValueWarning = valuesInRange.length >= 2;

    if (needsValueWarning) {
      const message = existingMerges.length > 0
        ? 'この範囲には結合セルと複数の入力値があります。\n既存の結合を解除し、先頭セルの値のみ保持して結合しますか？'
        : `入力済みセルが${valuesInRange.length}件あります。\n先頭セルの値のみが保持されます。結合しますか？`;

      setMergeConfirmDialog({
        show: true,
        message,
        callback: () => {
          let updated = customFields;
          for (const mergeSeq of existingMerges) {
            updated = unmergeCells(updated, timetableType, selectedDate, selection.colId, mergeSeq);
          }
          doMerge(updated);
          setMergeConfirmDialog(null);
        },
      });
      return;
    }

    // 既存結合がある場合は警告なしで解除してから結合
    if (existingMerges.length > 0) {
      let updated = customFields;
      for (const mergeSeq of existingMerges) {
        updated = unmergeCells(updated, timetableType, selectedDate, selection.colId, mergeSeq);
      }
      doMerge(updated);
      return;
    }

    // 確認不要：直接結合
    doMerge(customFields);
  }, [selection, customFields, columns, timetableType, selectedDate, timetable, onCustomFieldsChange, onUndoRecord, getSelectionMerges]);

  const handleUnmerge = useCallback(
    (colId: string, seq: number) => {
      if (!customFields) return;
      const updated = unmergeCells(customFields, timetableType, selectedDate, colId, seq);
      onUndoRecord?.({ targetId: `cell:${seq}:${colId}`, opType: 'customCell:unmerge', before: customFields, after: updated });
      onCustomFieldsChange(updated);
      setSelection(null);
      setContextMenu(null);
    },
    [customFields, timetableType, selectedDate, onCustomFieldsChange, onUndoRecord]
  );

  // 右クリックメニューを表示
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, seq: number, colId: string) => {
      e.preventDefault();
      if (isReadOnly) return;
      // 結合セルかチェック
      const col = columns.find(c => c.id === colId);
      if (!col || !customFields) return;
      const cellData = getCellData(customFields, timetableType, selectedDate, col, seq, '');
      if (cellData.rowSpan && cellData.rowSpan > 1) {
        setContextMenu({ x: e.clientX, y: e.clientY, seq, colId });
      }
    },
    [isReadOnly, columns, customFields, timetableType, selectedDate]
  );

  // メニュー外クリックで閉じる
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    if (contextMenu) {
      window.addEventListener('click', handleClick);
      return () => window.removeEventListener('click', handleClick);
    }
  }, [contextMenu]);

  // ===== キーボードナビゲーション =====

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, seq: number, entryId: string, colIndex: number, col: CustomColumn) => {
      const seqList = entries.map(en => en.sequenceNumber);
      const currentSeqIdx = seqList.indexOf(seq);

      // Shift+矢印で範囲選択（sequence型のみ）
      if (e.shiftKey && col.bindingType === 'sequence' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const delta = e.key === 'ArrowUp' ? -1 : 1;

        if (selection && selection.colId === col.id) {
          // 既存選択を拡張/縮小: endSeqを基準に移動
          const endSeqIdx = seqList.indexOf(selection.endSeq);
          const newEndIdx = endSeqIdx + delta;
          if (newEndIdx >= 0 && newEndIdx < seqList.length) {
            const newSeq = seqList[newEndIdx];
            if (isSameCool(selection.startSeq, newSeq)) {
              // 結合セルの親を取得
              const parentSeq = getMergedParentSeq(col.id, newSeq);
              const span = getMergedSpan(col.id, parentSeq);
              const mergeEnd = parentSeq + span - 1;

              let newEndSeq: number;
              // 現在のendSeqが移動先の結合セル範囲内にあるか判定
              const currentInSameMerge = span > 1 && selection.endSeq >= parentSeq && selection.endSeq <= mergeEnd;
              if (currentInSameMerge) {
                // endSeqが結合セル内にある
                const isShrinking = (delta > 0 && selection.endSeq < selection.startSeq) ||
                                    (delta < 0 && selection.endSeq > selection.startSeq);
                if (isShrinking) {
                  // 縮小時: 結合セル全体をスキップ（1ユニットとして解除）
                  if (delta > 0) {
                    const mergeEndIdx = seqList.indexOf(mergeEnd);
                    newEndSeq = (mergeEndIdx + 1 < seqList.length) ? seqList[mergeEndIdx + 1] : mergeEnd;
                  } else {
                    const parentIdx = seqList.indexOf(parentSeq);
                    newEndSeq = (parentIdx - 1 >= 0) ? seqList[parentIdx - 1] : parentSeq;
                  }
                } else {
                  // 拡張時: 方向に応じて結合の端へスナップ
                  newEndSeq = delta > 0 ? mergeEnd : parentSeq;
                }
              } else {
                // 結合セルに新たに進入: 拡張なら遠い端、縮小なら近い端へスナップ
                const isExpanding = (delta > 0 && selection.endSeq >= selection.startSeq) ||
                                    (delta < 0 && selection.endSeq <= selection.startSeq);
                if (isExpanding) {
                  newEndSeq = delta > 0 ? mergeEnd : parentSeq;
                } else {
                  newEndSeq = delta > 0 ? parentSeq : mergeEnd;
                }
              }

              if (isSameCool(selection.startSeq, newEndSeq)) {
                setSelection(prev => prev ? { ...prev, endSeq: newEndSeq } : null);
              }
            }
          }
        } else {
          // 新規選択開始
          const newSeqIdx = currentSeqIdx + delta;
          if (newSeqIdx >= 0 && newSeqIdx < seqList.length) {
            const newSeq = seqList[newSeqIdx];
            if (isSameCool(seq, newSeq)) {
              const parentSeq = getMergedParentSeq(col.id, newSeq);
              const span = getMergedSpan(col.id, parentSeq);
              const endSeq = delta > 0 ? parentSeq + span - 1 : parentSeq;
              setSelection({ colId: col.id, startSeq: seq, endSeq });
              // 選択開始セルの位置をtoolbarYに設定
              const inputEl = inputRefs.current.get(`${seq}:${col.id}`);
              if (inputEl) {
                const rect = inputEl.getBoundingClientRect();
                setToolbarY(rect.top + rect.height / 2);
              }
            }
          }
        }
        return;
      }

      let targetSeqIdx = currentSeqIdx;
      let targetColIdx = colIndex;

      switch (e.key) {
        case 'Tab': {
          e.preventDefault();
          handleCellBlur(seq, entryId, col);
          if (e.shiftKey) {
            targetColIdx--;
            if (targetColIdx < 0) {
              targetColIdx = columns.length - 1;
              targetSeqIdx--;
            }
          } else {
            targetColIdx++;
            if (targetColIdx >= columns.length) {
              targetColIdx = 0;
              targetSeqIdx++;
            }
          }
          break;
        }
        case 'Enter': {
          e.preventDefault();
          handleCellBlur(seq, entryId, col);
          targetSeqIdx++;
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          targetSeqIdx--;
          break;
        }
        case 'ArrowDown': {
          e.preventDefault();
          targetSeqIdx++;
          break;
        }
        case 'Escape': {
          e.preventDefault();
          setSelection(null);
          const key = cellKey(seq, col.id);
          setCellValues(prev => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
          (e.target as HTMLInputElement).blur();
          return;
        }
        default:
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
            setSelection(null);
          }
          return;
      }

      // ナビゲーション実行
      if (targetSeqIdx >= 0 && targetSeqIdx < seqList.length && targetColIdx >= 0 && targetColIdx < columns.length) {
        const targetSeq = seqList[targetSeqIdx];
        const targetCol = columns[targetColIdx];
        if (!isMergedChild(customFields, timetableType, selectedDate, targetCol.id, targetSeq)) {
          const targetKey = cellKey(targetSeq, targetCol.id);
          setFocusedCell({ seq: targetSeq, colIndex: targetColIdx });
          requestAnimationFrame(() => {
            const input = inputRefs.current.get(targetKey);
            if (input) {
              input.focus();
              input.select();
            }
          });
        }
      }
    },
    [entries, columns, selection, customFields, timetableType, selectedDate, handleCellBlur, isSameCool, getMergedSpan, getMergedParentSeq]
  );

  // フォーカスによるセル追跡
  const handleCellFocus = useCallback(
    (seq: number, colIndex: number) => {
      setFocusedCell({ seq, colIndex });
    },
    []
  );

  // タッチ端末でのセルタップ処理（ダブルタップで編集モードに入る）
  const handleCellTap = useCallback(
    (key: string) => {
      if (lastTappedCellRef.current === key) {
        // 同じセルの2回目タップ → 編集モード
        setEditingCellKey(key);
      } else {
        // 別のセルをタップ → 選択のみ
        setEditingCellKey(null);
      }
      lastTappedCellRef.current = key;
    },
    []
  );

  // editingCellKeyが設定されたらinputを再フォーカスしてキーボードを表示
  useEffect(() => {
    if (!editingCellKey || !isTouchDevice.current) return;
    const input = inputRefs.current.get(editingCellKey);
    if (!input) return;
    // blur→re-focusでモバイルキーボードを確実に表示
    input.blur();
    requestAnimationFrame(() => {
      input.focus();
    });
  }, [editingCellKey]);

  // 長押し待機中はネイティブのコンテキストメニューを抑制（テキスト選択防止）
  useEffect(() => {
    if (!isTouchPending) return;
    const handler = (e: Event) => e.preventDefault();
    document.addEventListener('contextmenu', handler, { capture: true });
    return () => document.removeEventListener('contextmenu', handler, { capture: true });
  }, [isTouchPending]);

  // inputRef登録
  const registerInputRef = useCallback(
    (key: string, el: HTMLInputElement | null) => {
      if (el) {
        inputRefs.current.set(key, el);
      } else {
        inputRefs.current.delete(key);
      }
    },
    []
  );

  const renderCustomCell = (entry: TimetableEntry, col: CustomColumn, colIndex: number): ReactNode => {
    const info = entryInfoById.get(entry.id);
    if (!info) return null;
    if (col.shift) {
      const coolId = info.coolId ?? 'flat';
      const group = entries.filter(item => (item.coolId ?? 'flat') === coolId);
      const position = group.findIndex(item => item.entryId === entry.id);
      const slots = getShiftSlots(col, selectedDate, coolId, group.length);
      const match = getShiftSlotAt(slots, position);
      if (!match || match.start !== position) return <motion.td key={col.id} style={{ display: 'none' }} aria-hidden />;
      const slotEntries = group.slice(match.start, match.start + match.slot.size);
      const onAction = (action: ShiftSlotAction) => {
        if (isReadOnly || !customFields) return;
        const updated = updateShiftSlot(customFields, timetableType, col.id, selectedDate, coolId, group.length, action);
        if (updated === customFields) return;
        onUndoRecord?.({ targetId: `column:${col.id}`, opType: 'customColumn:shift', before: customFields, after: updated });
        onCustomFieldsChange(updated);
      };
      return <motion.td key={col.id} {...columnMotion} initial={enteringColumnIds.has(col.id) ? columnMotion.initial : false}
        data-seq={info.sequenceNumber} data-col-id={col.id} data-shift-slot-id={match.slot.id} rowSpan={match.slot.size}
        className="relative border-l border-b border-emerald-200 p-0 align-middle">
        <ShiftSlotCell column={col} slot={match.slot} slotIndex={match.slotIndex} slots={slots} entries={slotEntries} bands={bands}
          otherAssignments={getOverlappingShiftAssignees(columns, col.id, selectedDate, coolId, group.length, match.start, match.slot.size)}
          readOnly={isReadOnly} onAction={onAction} />
      </motion.td>;
    }
    // 結合子セルは同じ key のまま表の配置対象から外す。退出アニメーションで余分な列が生まれるのを防ぐ。
    if (isMergedChild(customFields, timetableType, selectedDate, col.id, info.sequenceNumber)) {
      return <motion.td key={col.id} style={{ display: 'none' }} aria-hidden />;
    }

    const seq = info.sequenceNumber;
    const cellData = getCellData(customFields, timetableType, selectedDate, col, seq, entry.id);
    const hasMerge = !!(cellData.rowSpan && cellData.rowSpan > 1);
    const selected = isCellSelected(seq, col.id);
    const focused = focusedCell?.seq === seq && focusedCell.colIndex === colIndex;
    const selectionStart = selection ? Math.min(selection.startSeq, selection.endSeq) : -1;
    const selectionEnd = selection ? Math.max(selection.startSeq, selection.endSeq) : -1;
    const key = `${seq}:${col.id}`;
    const value = getCellValue(seq, entry.id, col);

    return (
      <motion.td
        key={col.id}
        {...columnMotion}
        initial={enteringColumnIds.has(col.id) ? columnMotion.initial : false}
        data-seq={seq}
        data-col-id={col.id}
        rowSpan={hasMerge ? cellData.rowSpan : undefined}
        className={`border-l border-gray-200 p-0 relative select-none overflow-hidden ${hasMerge ? 'align-middle' : ''} ${selected ? `custom-cell-selected bg-emerald-100 ${seq === selectionStart ? 'custom-cell-selection-start' : ''} ${seq + (hasMerge ? cellData.rowSpan! : 1) - 1 === selectionEnd ? 'custom-cell-selection-end' : ''}` : ''} ${focused && !selected ? 'ring-2 ring-emerald-400 ring-inset bg-emerald-50' : ''}`}
        onMouseDown={(event) => handleMouseDown(seq, col.id, col, event)}
        onMouseMove={() => handleMouseMove(seq, col.id)}
        onContextMenu={(event) => {
          handleContextMenu(event, seq, col.id);
          if (isTouchDevice.current) event.preventDefault();
        }}
        onTouchStart={(event) => handleTouchStart(seq, col.id, col, event)}
        onTouchMove={handleTouchMoveCell}
        onTouchEnd={handleTouchEndCell}
      >
        <div className="absolute inset-0 flex min-w-0 items-center overflow-hidden">
          {isTouchDevice.current && editingCellKey !== key && !isReadOnly ? (
            <div
              className="w-full h-full px-2 py-2 text-sm text-gray-900 select-none cursor-default"
              onClick={() => handleCellTap(key)}
              style={{ WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' }}
            >
              {value || <span className="text-gray-400">-</span>}
            </div>
          ) : (
            <input
              ref={(element) => registerInputRef(key, element)}
              type="text"
              value={value}
              onChange={(event) => handleCellChange(seq, entry.id, col, event.target.value)}
              onBlur={() => handleCellBlur(seq, entry.id, col)}
              onKeyDown={(event) => handleKeyDown(event, seq, entry.id, colIndex, col)}
              onFocus={() => handleCellFocus(seq, colIndex)}
              onClick={() => { if (isTouchDevice.current) handleCellTap(key); }}
              onCompositionStart={() => handleCompositionStart(seq, col.id)}
              onCompositionEnd={(event) => handleCompositionEnd(seq, entry.id, col, event.currentTarget.value)}
              className={`h-full w-full min-w-0 px-2 py-2 text-sm bg-transparent border-0 outline-none text-gray-900 placeholder-gray-400 ${selected ? '' : 'hover:bg-gray-100'}`}
              placeholder="-"
              maxLength={100}
              readOnly={isReadOnly}
              tabIndex={isReadOnly ? -1 : undefined}
            />
          )}
        </div>
      </motion.td>
    );
  };

  // 選択範囲の結合済みチェック（選択範囲が結合セルと完全一致する場合のみtrue）
  const selectionHasMerge = selection && customFields
    ? (() => {
        const startSeq = Math.min(selection.startSeq, selection.endSeq);
        const endSeq = Math.max(selection.startSeq, selection.endSeq);
        const col = columns.find(c => c.id === selection.colId);
        if (!col) return false;
        const cellData = getCellData(customFields, timetableType, selectedDate, col, startSeq, '');
        // 先頭セルが結合済み && 結合範囲が選択範囲と完全一致
        return cellData.rowSpan && cellData.rowSpan > 1 &&
          startSeq + (cellData.rowSpan - 1) === endSeq;
      })()
    : false;

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-w-0 relative">
      {/* エラー表示 */}
      {mergeError && (
        <div className="flex-shrink-0 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2">
          {mergeError}
        </div>
      )}

      {/* フローティングツールバー（範囲選択時に表示、readOnly時は非表示） */}
      {!isReadOnly && selection && selectionSize > 1 && (() => {
        // 選択方向に応じてツールバーの位置を調整
        // 上方向に選択 → 選択開始セルの下側に表示
        // 下方向に選択 → 選択開始セルの上側に表示
        const isSelectingUpward = selection.endSeq < selection.startSeq;
        const offset = 60; // ツールバーのずらし量
        const adjustedY = isSelectingUpward ? toolbarY + offset : toolbarY - offset;
        const clampedY = Math.max(80, Math.min(adjustedY, window.innerHeight - 80));

        return (
        <div
          className="fixed left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 bg-white border border-gray-200 rounded-lg shadow-2xl px-4 py-3 flex items-center gap-4"
          style={{ top: clampedY }}
        >
          <div className="flex items-center gap-2">
            <span className="text-emerald-600 font-bold text-lg">{selectionSize}</span>
            <span className="text-sm text-gray-600">
              セル選択中
              {columns.find(c => c.id === selection.colId) && (
                <span className="text-gray-500 ml-1">
                  ({columns.find(c => c.id === selection.colId)?.name})
                </span>
              )}
            </span>
          </div>
          <div className="h-6 w-px bg-gray-200" />
          <div className="flex gap-2">
            {selectionHasMerge ? (
              <button
                onClick={() => handleUnmerge(selection.colId, Math.min(selection.startSeq, selection.endSeq))}
                className="px-4 py-2 text-sm font-medium rounded-md bg-yellow-500 hover:bg-yellow-400 text-white transition-colors flex items-center gap-2"
              >
                <Icon name="lock_open" className="text-base" />
                結合を解除
              </button>
            ) : (
              <button
                onClick={handleMerge}
                className="px-4 py-2 text-sm font-medium rounded-md bg-emerald-500 hover:bg-emerald-400 text-white transition-colors flex items-center gap-2"
              >
                <Icon name="link" className="text-base" />
                セルを結合
              </button>
            )}
            <button
              onClick={() => setSelection(null)}
              className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
              title="選択を解除"
            >
              <Icon name="close" className="text-base align-middle" />
            </button>
          </div>
        </div>
        );
      })()}

      {/* 確認ダイアログ */}
      {!isReadOnly && mergeConfirmDialog?.show && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white border border-gray-200 rounded-lg shadow-2xl p-6 max-w-md">
            <h3 className="text-lg font-bold text-gray-900 mb-3">結合の確認</h3>
            <p className="text-gray-600 text-sm mb-4 whitespace-pre-line">
              {mergeConfirmDialog.message || 'この操作を実行しますか？'}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setMergeConfirmDialog(null)}
                className="px-4 py-2 text-sm font-medium rounded-md bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={mergeConfirmDialog.callback}
                className="px-4 py-2 text-sm font-medium rounded-md bg-emerald-500 hover:bg-emerald-400 text-white transition-colors"
              >
                確認して結合
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 右クリックメニュー */}
      {!isReadOnly && contextMenu && (
        <div
          className="fixed bg-white border border-gray-200 rounded-md shadow-xl py-1 z-50"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => handleUnmerge(contextMenu.colId, contextMenu.seq)}
            className="w-full px-4 py-2 text-left text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors flex items-center gap-2"
          >
            <Icon name="lock_open" className="text-base" />
            結合を解除
          </button>
        </div>
      )}

      {renderTable(columns, renderCustomCell, enteringColumnIds)}
    </div>
  );
};
