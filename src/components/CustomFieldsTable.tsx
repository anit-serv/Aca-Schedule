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

interface CustomFieldsTableProps {
  currentTimetable: DailyTimetable;
  bands: Band[];
  timetable: Timetable | null;
  eventSettings: EventSettings;
  timetableType: 'performance' | 'rehearsal';
  selectedDate: string;
  onCustomFieldsChange: (customFields: CustomFieldsSettings) => void;
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
}: CustomFieldsTableProps) => {
  // セル入力値のローカルバッファ（キー: "seq:colId"）
  const [cellValues, setCellValues] = useState<Record<string, string>>({});
  // フォーカス中のセル座標
  const [focusedCell, setFocusedCell] = useState<CellCoord | null>(null);
  // 範囲選択状態
  const [selection, setSelection] = useState<SelectionRange | null>(null);
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
  const dragStartRef = useRef<{ seq: number; colId: string; mergedEndSeq?: number } | null>(null);
  // input要素のrefマップ
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  const customFields = eventSettings.customFields;
  const typeData = getTypeData(customFields, timetableType);
  const columns = useMemo(
    () => [...typeData.columns].sort((a, b) => a.order - b.order),
    [typeData.columns]
  );

  // エントリー一覧（クール情報付き）
  const entries = useMemo(
    () => getEntriesWithCoolInfo(currentTimetable),
    [currentTimetable]
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
          // 既存選択がある場合: 範囲拡張
          if (isSameCool(selection.startSeq, seq)) {
            setSelection(prev => prev ? { ...prev, endSeq: targetEndSeq } : { colId, startSeq: seq, endSeq: targetEndSeq });
          }
        } else if (focusedCell && columns[focusedCell.colIndex]?.id === colId) {
          // 選択はないが同じ列にフォーカスセルがある場合: フォーカスセルを起点に範囲選択
          if (isSameCool(focusedCell.seq, seq)) {
            setSelection({ colId, startSeq: focusedCell.seq, endSeq: targetEndSeq });
          }
        } else {
          setSelection({ colId, startSeq: seq, endSeq: targetEndSeq });
        }
        return;
      }

      // 通常クリック: 選択をクリアし、ドラッグ開始位置を記録（inputフォーカスを妨げない）
      setSelection(null);
      dragStartRef.current = { seq, colId, mergedEndSeq };
      setIsDragging(true);
    },
    [selection, focusedCell, columns, isSameCool, customFields, timetableType, selectedDate]
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
      // 結合セルかチェック
      const col = columns.find(c => c.id === colId);
      if (!col || !customFields) return;
      const cellData = getCellData(customFields, timetableType, selectedDate, col, seq, '');
      if (cellData.rowSpan && cellData.rowSpan > 1) {
        setContextMenu({ x: e.clientX, y: e.clientY, seq, colId });
      }
    },
    [columns, customFields, timetableType, selectedDate]
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
    <div className="flex-1 flex flex-col overflow-hidden bg-gray-900 rounded-lg border border-gray-700 relative">
      {/* エラー表示 */}
      {mergeError && (
        <div className="flex-shrink-0 bg-red-900/50 border border-red-700 text-red-300 text-sm px-4 py-2">
          {mergeError}
        </div>
      )}

      {/* フローティングツールバー（範囲選択時に表示） */}
      {selection && selectionSize > 1 && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-20 bg-gray-800 border border-gray-600 rounded-lg shadow-2xl px-4 py-3 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-blue-400 font-bold text-lg">{selectionSize}</span>
            <span className="text-sm text-gray-300">
              セル選択中
              {columns.find(c => c.id === selection.colId) && (
                <span className="text-gray-500 ml-1">
                  ({columns.find(c => c.id === selection.colId)?.name})
                </span>
              )}
            </span>
          </div>
          <div className="h-6 w-px bg-gray-600" />
          <div className="flex gap-2">
            {selectionHasMerge ? (
              <button
                onClick={() => handleUnmerge(selection.colId, Math.min(selection.startSeq, selection.endSeq))}
                className="px-4 py-2 text-sm font-medium rounded-md bg-yellow-600 hover:bg-yellow-500 text-white transition-colors flex items-center gap-2"
              >
                <span className="text-base">🔓</span>
                結合を解除
              </button>
            ) : (
              <button
                onClick={handleMerge}
                className="px-4 py-2 text-sm font-medium rounded-md bg-blue-600 hover:bg-blue-500 text-white transition-colors flex items-center gap-2"
              >
                <span className="text-base">🔗</span>
                セルを結合
              </button>
            )}
            <button
              onClick={() => setSelection(null)}
              className="px-3 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-700 rounded-md transition-colors"
              title="選択を解除"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* 確認ダイアログ */}
      {mergeConfirmDialog?.show && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 border border-gray-600 rounded-lg shadow-2xl p-6 max-w-md">
            <h3 className="text-lg font-bold text-white mb-3">結合の確認</h3>
            <p className="text-gray-300 text-sm mb-4 whitespace-pre-line">
              {mergeConfirmDialog.message || 'この操作を実行しますか？'}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setMergeConfirmDialog(null)}
                className="px-4 py-2 text-sm font-medium rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={mergeConfirmDialog.callback}
                className="px-4 py-2 text-sm font-medium rounded-md bg-blue-600 hover:bg-blue-500 text-white transition-colors"
              >
                確認して結合
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 右クリックメニュー */}
      {contextMenu && (
        <div
          className="fixed bg-gray-800 border border-gray-600 rounded-md shadow-xl py-1 z-50"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => handleUnmerge(contextMenu.colId, contextMenu.seq)}
            className="w-full px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
          >
            <span>🔓</span>
            結合を解除
          </button>
        </div>
      )}

      <div className={`flex-1 overflow-auto ${isDragging ? 'select-none' : ''}`} ref={tableRef}>
        <table className="w-full text-sm border-collapse">
          {/* ヘッダー */}
          <thead className="sticky top-0 z-10">
            <tr className="bg-gray-800 border-b border-gray-600">
              <th className="w-12 px-2 py-2 text-center text-gray-400 font-medium">#</th>
              <th className="w-20 px-2 py-2 text-center text-gray-400 font-medium">開始</th>
              <th className="px-3 py-2 text-left text-gray-400 font-medium min-w-[120px]">名称</th>
              <th className="w-16 px-2 py-2 text-center text-gray-400 font-medium">時間</th>
              {columns.map(col => (
                <th
                  key={col.id}
                  className="px-3 py-2 text-left text-gray-400 font-medium min-w-[120px] border-l border-gray-600"
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
                registerInputRef={registerInputRef}
              />
            ))}
          </tbody>
        </table>
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
  registerInputRef: (key: string, el: HTMLInputElement | null) => void;
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
  registerInputRef,
}: CoolGroupProps) => {
  const cellKey = (seq: number, colId: string) => `${seq}:${colId}`;

  return (
    <>
      {/* クールヘッダー行 */}
      {group.coolId && showCoolHeaders && (
        <tr className="bg-blue-900/30">
          <td
            colSpan={4 + columns.length}
            className={`px-3 py-1.5 text-xs font-bold text-blue-300 tracking-wider ${
              groupIndex > 0 ? 'border-t-[3px] border-t-blue-500' : ''
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="bg-blue-600/40 rounded px-2 py-0.5">
                クール {group.coolNumber}
              </span>
              <span className="flex-1 border-t border-blue-700/50" />
            </div>
          </td>
        </tr>
      )}

      {/* エントリー行 */}
      {group.entries.map((entry) => {
        const isCustomEvent = entry.type === 'custom';
        const name = isCustomEvent ? entry.customEventName || '' : getBandName(entry.bandId);
        const duration = isCustomEvent ? entry.duration || 0 : getBandDuration(entry.bandId);

        return (
          <tr
            key={entry.entryId}
            className={`border-b border-gray-700/50 hover:bg-gray-800/30 ${
              isCustomEvent ? 'bg-purple-900/10' : ''
            }`}
          >
            {/* 通し番号 */}
            <td className="w-12 px-2 py-1 text-center text-gray-500 font-mono text-xs">
              {entry.sequenceNumber}
            </td>

            {/* 開始時刻 */}
            <td className="w-20 px-2 py-1 text-center text-gray-300 font-mono text-xs">
              {entry.startTime || '-'}
            </td>

            {/* 名称 */}
            <td className={`px-3 py-1 ${isCustomEvent ? 'text-purple-300' : 'text-gray-200'}`}>
              <span className="truncate block text-sm">{name}</span>
            </td>

            {/* 時間 */}
            <td className="w-16 px-2 py-1 text-center text-gray-400 text-xs">
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

              return (
                <td
                  key={col.id}
                  rowSpan={hasMerge ? cellData.rowSpan : undefined}
                  className={`border-l border-gray-600 p-0 relative transition-colors ${
                    hasMerge ? 'align-middle' : ''
                  } ${
                    isSelected ? 'bg-blue-500/20 ring-1 ring-blue-400/40 ring-inset' : ''
                  } ${
                    isFocused ? 'ring-2 ring-blue-500/70 ring-inset bg-gray-700/40' : ''
                  }`}
                  onMouseDown={(e) => handleMouseDown(entry.sequenceNumber, col.id, col, e)}
                  onMouseMove={() => handleMouseMove(entry.sequenceNumber, col.id)}
                  onContextMenu={(e) => handleContextMenu(e, entry.sequenceNumber, col.id)}
                >
                  <div className={`w-full ${
                    hasMerge ? 'absolute inset-0 flex items-center' : 'flex items-center min-h-[28px]'
                  }`}>
                    <input
                      ref={(el) => registerInputRef(key, el)}
                      type="text"
                      value={value}
                      onChange={(e) => handleCellChange(entry.sequenceNumber, entry.entryId, col, e.target.value)}
                      onBlur={() => handleCellBlur(entry.sequenceNumber, entry.entryId, col)}
                      onKeyDown={(e) => handleKeyDown(e, entry.sequenceNumber, entry.entryId, colIndex, col)}
                      onFocus={() => handleCellFocus(entry.sequenceNumber, colIndex)}
                      className={`w-full h-full px-2 text-sm bg-transparent border-0 outline-none text-gray-300 placeholder-gray-600 transition-colors ${
                        hasMerge ? 'py-0' : 'py-1'
                      } ${
                        isFocused ? '' : 'hover:bg-gray-800/40'
                      } ${
                        isSelected && !isFocused ? 'bg-blue-500/10' : ''
                      }`}
                      placeholder="-"
                      maxLength={100}
                    />
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
