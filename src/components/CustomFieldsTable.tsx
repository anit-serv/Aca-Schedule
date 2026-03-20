import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import type { Band, EventSettings, Timetable, DailyTimetable, CustomFieldsSettings, CustomColumn } from '../types';
import {
  getTypeData,
  getEntriesWithCoolInfo,
  getCellData,
  setCellValue,
  isMergedChild,
  mergeCells,
  unmergeCells,
} from '../utils/customFieldsUtils';
import { calculateBandNumbers } from '../utils/calculateBandNumbers';

interface CustomFieldsTableProps {
  currentTimetable: DailyTimetable;
  bands: Band[];
  timetable: Timetable | null;
  eventSettings: EventSettings;
  timetableType: 'performance' | 'rehearsal';
  selectedDate: string;
  onCustomFieldsChange: (customFields: CustomFieldsSettings) => void;
  readOnly?: boolean;
  searchQuery?: string;
  visibleCoolIds?: string[];
  disablePerformanceBottomSpacer?: boolean;
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

export const CustomFieldsTable = ({
  currentTimetable,
  bands,
  timetable,
  eventSettings,
  timetableType,
  selectedDate,
  onCustomFieldsChange,
  readOnly,
  searchQuery = '',
  visibleCoolIds,
  disablePerformanceBottomSpacer = false,
}: CustomFieldsTableProps) => {
  // 読み取り専用モード
  const isReadOnly = readOnly ?? false;

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
  // テーブルコンテナref
  const tableRef = useRef<HTMLDivElement>(null);
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

  // エントリー一覧（クール情報付き）
  const entries = useMemo(() => {
    const allEntries = getEntriesWithCoolInfo(currentTimetable);
    if (!visibleCoolIds || visibleCoolIds.length === 0) {
      return allEntries;
    }
    const visibleSet = new Set(visibleCoolIds);
    return allEntries.filter(entry => entry.coolId && visibleSet.has(entry.coolId));
  }, [currentTimetable, visibleCoolIds]);

  // バンド番号マップ（全日程を通した連番、カスタムイベントは含まない）
  const bandNumbers = useMemo(
    () => calculateBandNumbers(timetable),
    [timetable]
  );

  // バンドIDから名前を取得
  const getBandName = useCallback(
    (bandId?: string) => {
      if (!bandId) return '';
      return bands.find(b => b.id === bandId)?.name || '不明なバンド';
    },
    [bands]
  );

  // バンドIDから演奏時間を取得
  const getBandDuration = useCallback(
    (bandId?: string) => {
      if (!bandId) return 0;
      return bands.find(b => b.id === bandId)?.performanceDuration || 0;
    },
    [bands]
  );

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
      setCellValues(prev => ({ ...prev, [key]: value }));
      // IME変換中は保存をスキップ（compositionendで保存される）
      if (!isComposingRef.current.get(key)) {
        debouncedSave(seq, entryId, col, value);
      }
    },
    [debouncedSave]
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
      onCustomFieldsChange(updated);
    },
    [customFields, cellValues, timetableType, selectedDate, onCustomFieldsChange]
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
  }, [selection, customFields, columns, timetableType, selectedDate, timetable, onCustomFieldsChange, getSelectionMerges]);

  const handleUnmerge = useCallback(
    (colId: string, seq: number) => {
      if (!customFields) return;
      const updated = unmergeCells(customFields, timetableType, selectedDate, colId, seq);
      onCustomFieldsChange(updated);
      setSelection(null);
      setContextMenu(null);
    },
    [customFields, timetableType, selectedDate, onCustomFieldsChange]
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

  if (entries.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400">
        <p>エントリーがありません。通常モードでバンドを配置してください。</p>
      </div>
    );
  }

  // クール単位でグループ化
  const coolGroups: Array<{
    coolId?: string;
    coolNumber?: number;
    entries: typeof entries;
  }> = [];
  let currentCoolId: string | undefined;

  for (const entry of entries) {
    if (entry.coolId !== currentCoolId) {
      coolGroups.push({
        coolId: entry.coolId,
        coolNumber: entry.coolNumber,
        entries: [],
      });
      currentCoolId = entry.coolId;
    }
    coolGroups[coolGroups.length - 1].entries.push(entry);
  }

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
    <div className="flex-1 flex flex-col overflow-hidden bg-white rounded-lg border border-gray-200 relative">
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
                <span className="text-base">🔓</span>
                結合を解除
              </button>
            ) : (
              <button
                onClick={handleMerge}
                className="px-4 py-2 text-sm font-medium rounded-md bg-emerald-500 hover:bg-emerald-400 text-white transition-colors flex items-center gap-2"
              >
                <span className="text-base">🔗</span>
                セルを結合
              </button>
            )}
            <button
              onClick={() => setSelection(null)}
              className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
              title="選択を解除"
            >
              ✕
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
            <span>🔓</span>
            結合を解除
          </button>
        </div>
      )}

      <div
        className={`flex-1 overflow-auto ${isDragging || isTouchPending ? 'select-none' : ''}`}
        ref={tableRef}
        style={{ WebkitTouchCallout: 'none' } as React.CSSProperties}
      >
        <table className="w-full text-sm border-collapse table-fixed">
          {/* 列幅固定用（結合セルのみでも幅を維持） */}
          <colgroup>
            <col className="w-12" />{/* # */}
            <col className="w-20" />{/* 開始 */}
            <col className="min-w-[120px]" />{/* 名称 */}
            <col className="w-16" />{/* 時間 */}
            {columns.map(col => (
              <col key={col.id} className="min-w-[120px]" />
            ))}
          </colgroup>
          {/* ヘッダー */}
          <thead className="sticky top-0 z-10">
            <tr className="bg-emerald-50 border-b border-emerald-100">
              <th className="w-12 px-2 py-2 text-center text-emerald-700 font-medium">#</th>
              <th className="w-20 px-2 py-2 text-center text-emerald-700 font-medium">開始</th>
              <th className="px-3 py-2 text-left text-emerald-700 font-medium min-w-[120px]">名称</th>
              <th className="w-16 px-2 py-2 text-center text-emerald-700 font-medium">時間</th>
              {columns.map(col => (
                <th
                  key={col.id}
                  className="px-3 py-2 text-left text-emerald-700 font-medium min-w-[120px] border-l border-emerald-100"
                >
                  <div className="flex items-center gap-1">
                    <span className="text-xs" title={col.bindingType === 'sequence' ? '位置固定' : 'エントリー追従'}>
                      {col.bindingType === 'sequence' ? '📍' : '🎵'}
                    </span>
                    <span className="truncate">{col.name}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          {/* ボディ */}
          <tbody>
            {coolGroups.map((group, groupIndex) => (
              <CoolGroup
                key={group.coolId || `flat-${groupIndex}`}
                group={group}
                groupIndex={groupIndex}
                showCoolHeaders={coolGroups.length > 1}
                columns={columns}
                customFields={customFields}
                timetableType={timetableType}
                selectedDate={selectedDate}
                focusedCell={focusedCell}
                cellValues={cellValues}
                getCellValue={getCellValue}
                getBandName={getBandName}
                getBandDuration={getBandDuration}
                isCellSelected={isCellSelected}
                handleMouseDown={handleMouseDown}
                handleMouseMove={handleMouseMove}
                handleCellChange={handleCellChange}
                handleCellBlur={handleCellBlur}
                handleKeyDown={handleKeyDown}
                handleCellFocus={handleCellFocus}
                handleContextMenu={handleContextMenu}
                handleTouchStart={handleTouchStart}
                handleTouchMoveCell={handleTouchMoveCell}
                handleTouchEndCell={handleTouchEndCell}
                handleCompositionStart={handleCompositionStart}
                handleCompositionEnd={handleCompositionEnd}
                registerInputRef={registerInputRef}
                readOnly={isReadOnly}
                editingCellKey={editingCellKey}
                isTouchDevice={isTouchDevice.current}
                onCellTap={handleCellTap}
                bands={bands}
                searchQuery={searchQuery}
                bandNumbers={bandNumbers}
              />
            ))}
          </tbody>
        </table>
        {/* ツールバー表示用の余白（本番のみ） */}
        {timetableType === 'performance' && !disablePerformanceBottomSpacer && <div className="h-32" />}
      </div>
    </div>
  );
};

// クールグループサブコンポーネント（Fragmentの中のmapを分離してkeyを適切に管理）
interface CoolGroupProps {
  group: { coolId?: string; coolNumber?: number; entries: ReturnType<typeof getEntriesWithCoolInfo> };
  groupIndex: number;
  showCoolHeaders: boolean;
  columns: CustomColumn[];
  customFields: CustomFieldsSettings | undefined;
  timetableType: 'performance' | 'rehearsal';
  selectedDate: string;
  focusedCell: CellCoord | null;
  cellValues: Record<string, string>;
  getCellValue: (seq: number, entryId: string, col: CustomColumn) => string;
  getBandName: (bandId?: string) => string;
  getBandDuration: (bandId?: string) => number;
  isCellSelected: (seq: number, colId: string) => boolean;
  handleMouseDown: (seq: number, colId: string, col: CustomColumn, e: React.MouseEvent) => void;
  handleMouseMove: (seq: number, colId: string) => void;
  handleCellChange: (seq: number, entryId: string, col: CustomColumn, value: string) => void;
  handleCellBlur: (seq: number, entryId: string, col: CustomColumn) => void;
  handleKeyDown: (e: React.KeyboardEvent, seq: number, entryId: string, colIndex: number, col: CustomColumn) => void;
  handleCellFocus: (seq: number, colIndex: number) => void;
  handleContextMenu: (e: React.MouseEvent, seq: number, colId: string) => void;
  handleTouchStart: (seq: number, colId: string, col: CustomColumn, e: React.TouchEvent) => void;
  handleTouchMoveCell: (e: React.TouchEvent) => void;
  handleTouchEndCell: () => void;
  handleCompositionStart: (seq: number, colId: string) => void;
  handleCompositionEnd: (seq: number, entryId: string, col: CustomColumn, value: string) => void;
  registerInputRef: (key: string, el: HTMLInputElement | null) => void;
  readOnly: boolean;
  editingCellKey: string | null;
  isTouchDevice: boolean;
  onCellTap: (key: string) => void;
  bands: Band[];
  searchQuery: string;
  bandNumbers: Map<string, number>;
}

const CoolGroup = ({
  group,
  groupIndex,
  showCoolHeaders,
  columns,
  customFields,
  timetableType,
  selectedDate,
  focusedCell,
  getCellValue,
  getBandName,
  getBandDuration,
  isCellSelected,
  handleMouseDown,
  handleMouseMove,
  handleCellChange,
  handleCellBlur,
  handleKeyDown,
  handleCellFocus,
  handleContextMenu,
  handleTouchStart,
  handleTouchMoveCell,
  handleTouchEndCell,
  handleCompositionStart,
  handleCompositionEnd,
  registerInputRef,
  readOnly: isReadOnly,
  editingCellKey,
  isTouchDevice: isTouchDeviceFlag,
  onCellTap,
  bands,
  searchQuery,
  bandNumbers,
}: CoolGroupProps) => {
  const cellKey = (seq: number, colId: string) => `${seq}:${colId}`;

  return (
    <>
      {/* クールヘッダー行 */}
      {group.coolId && showCoolHeaders && (
        <tr className="bg-emerald-50">
          <td
            colSpan={4 + columns.length}
            className={`px-3 py-1.5 text-xs font-bold text-emerald-700 tracking-wider ${
              groupIndex > 0 ? 'border-t-[3px] border-t-emerald-400' : ''
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="bg-emerald-100 rounded px-2 py-0.5">
                クール {group.coolNumber}
              </span>
              <span className="flex-1 border-t border-emerald-200" />
            </div>
          </td>
        </tr>
      )}

      {/* エントリー行 */}
      {group.entries.map((entry) => {
        const isCustomEvent = entry.type === 'custom';
        const name = isCustomEvent ? entry.customEventName || '' : getBandName(entry.bandId);
        const duration = isCustomEvent ? entry.duration || 0 : getBandDuration(entry.bandId);

        // 検索マッチ判定（固定列のハイライト用）
        const matchBand = !isCustomEvent && entry.bandId ? bands.find(b => b.id === entry.bandId) : null;
        const isSearchMatch = searchQuery.trim() ? (() => {
          if (!matchBand) return false;
          const q = searchQuery.toLowerCase();
          return matchBand.name.toLowerCase().includes(q) || matchBand.members.some((m: string) => m.toLowerCase().includes(q));
        })() : false;
        const isSearchDimmed = !!(searchQuery.trim() && !isSearchMatch && !isCustomEvent);
        const searchHighlight = isSearchMatch ? 'bg-emerald-50' : '';
        const searchDimClass = isSearchDimmed ? 'opacity-40' : '';

        return (
          <tr
            key={entry.entryId}
            className={`border-b border-gray-200 hover:bg-gray-50 ${
              isCustomEvent ? 'bg-emerald-100/70' : ''
            } ${searchDimClass}`}
          >
            {/* 通し番号（バンドのみカウント、カスタムイベントは空欄） */}
            <td className={`w-12 px-2 py-1 text-center text-gray-500 font-mono text-xs ${searchHighlight}`}>
              {bandNumbers.get(entry.entryId) ?? ''}
            </td>

            {/* 開始時刻 */}
            <td className={`w-20 px-2 py-1 text-center text-gray-600 font-mono text-xs ${searchHighlight}`}>
              {entry.startTime || '-'}
            </td>

            {/* 名称 */}
            <td className={`px-3 py-1 ${isCustomEvent ? 'text-emerald-600' : 'text-gray-900'} ${searchHighlight}`}>
              <span className="truncate block text-sm">{name}</span>
            </td>

            {/* 時間 */}
            <td className={`w-16 px-2 py-1 text-center text-gray-500 text-xs ${searchHighlight}`}>
              {duration > 0 ? `${duration}分` : '-'}
            </td>

            {/* カスタム列 */}
            {columns.map((col, colIndex) => {
              const merged = isMergedChild(customFields, timetableType, selectedDate, col.id, entry.sequenceNumber);
              if (merged) return null;

              const cellData = getCellData(
                customFields, timetableType, selectedDate, col, entry.sequenceNumber, entry.entryId
              );
              const hasMerge = cellData.rowSpan && cellData.rowSpan > 1;
              const isSelected = isCellSelected(entry.sequenceNumber, col.id);
              const isFocused = focusedCell?.seq === entry.sequenceNumber && focusedCell?.colIndex === colIndex;
              const key = cellKey(entry.sequenceNumber, col.id);
              const value = getCellValue(entry.sequenceNumber, entry.entryId, col);

              // 結合セルの場合、範囲内にバンド（カスタムイベント以外）が含まれているかチェック
              // 含まれていれば紫背景を覆い隠す背景色を適用
              let mergedCellBgClass = '';
              if (hasMerge && cellData.rowSpan) {
                const startSeq = entry.sequenceNumber;
                const endSeq = entry.sequenceNumber + cellData.rowSpan - 1;
                const hasBandInRange = group.entries.some(
                  e => e.sequenceNumber >= startSeq && e.sequenceNumber <= endSeq && e.type !== 'custom'
                );
                if (hasBandInRange && isCustomEvent) {
                  // 先頭がカスタムイベントだが範囲内にバンドがある場合、背景を上書き
                  mergedCellBgClass = 'bg-white';
                }
              }

              return (
                <td
                  key={col.id}
                  data-seq={entry.sequenceNumber}
                  data-col-id={col.id}
                  rowSpan={hasMerge ? cellData.rowSpan : undefined}
                  className={`border-l border-gray-200 p-0 relative transition-colors select-none ${
                    hasMerge ? 'align-middle' : ''
                  } ${
                    mergedCellBgClass
                  } ${
                    isSelected ? 'bg-emerald-100 ring-1 ring-emerald-300 ring-inset' : ''
                  } ${
                    isFocused ? 'ring-2 ring-emerald-400 ring-inset bg-emerald-50' : ''
                  }`}
                  onMouseDown={(e) => handleMouseDown(entry.sequenceNumber, col.id, col, e)}
                  onMouseMove={() => handleMouseMove(entry.sequenceNumber, col.id)}
                  onContextMenu={(e) => {
                    handleContextMenu(e, entry.sequenceNumber, col.id);
                    // タッチデバイスではネイティブコンテキストメニューを常に抑制
                    if (isTouchDeviceFlag) e.preventDefault();
                  }}
                  onTouchStart={(e) => handleTouchStart(entry.sequenceNumber, col.id, col, e)}
                  onTouchMove={handleTouchMoveCell}
                  onTouchEnd={handleTouchEndCell}
                >
                  <div className={`w-full ${
                    hasMerge ? 'absolute inset-0 flex items-center' : 'flex items-center min-h-[28px]'
                  }`}>
                    {/* タッチデバイスで編集中でないセルはdivで表示（テキスト選択を完全に防ぐ） */}
                    {isTouchDeviceFlag && editingCellKey !== key && !isReadOnly ? (
                      <div
                        className={`w-full h-full px-2 text-sm text-gray-900 select-none cursor-default ${
                          hasMerge ? 'py-0 flex items-center' : 'py-1'
                        } ${
                          isFocused ? '' : 'hover:bg-gray-100'
                        } ${
                          isSelected && !isFocused ? 'bg-emerald-50' : ''
                        }`}
                        onClick={() => onCellTap(key)}
                        style={{ WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' } as React.CSSProperties}
                      >
                        {value || <span className="text-gray-400">-</span>}
                      </div>
                    ) : (
                      <input
                        ref={(el) => registerInputRef(key, el)}
                        type="text"
                        value={value}
                        onChange={(e) => handleCellChange(entry.sequenceNumber, entry.entryId, col, e.target.value)}
                        onBlur={() => handleCellBlur(entry.sequenceNumber, entry.entryId, col)}
                        onKeyDown={(e) => handleKeyDown(e, entry.sequenceNumber, entry.entryId, colIndex, col)}
                        onFocus={() => handleCellFocus(entry.sequenceNumber, colIndex)}
                        onClick={() => {
                          if (isTouchDeviceFlag) {
                            onCellTap(key);
                          }
                        }}
                        onCompositionStart={() => handleCompositionStart(entry.sequenceNumber, col.id)}
                        onCompositionEnd={(e) => handleCompositionEnd(entry.sequenceNumber, entry.entryId, col, e.currentTarget.value)}
                        className={`w-full h-full px-2 text-sm bg-transparent border-0 outline-none text-gray-900 placeholder-gray-400 transition-colors ${
                          hasMerge ? 'py-0' : 'py-1'
                        } ${
                          isFocused ? '' : 'hover:bg-gray-100'
                        } ${
                          isSelected && !isFocused ? 'bg-emerald-50' : ''
                        }`}
                        placeholder="-"
                        maxLength={100}
                        readOnly={isReadOnly}
                        tabIndex={isReadOnly ? -1 : undefined}
                      />
                    )}
                  </div>
                </td>
              );
            })}
          </tr>
        );
      })}
    </>
  );
};
