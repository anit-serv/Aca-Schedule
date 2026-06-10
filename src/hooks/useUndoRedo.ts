import { useState, useRef, useCallback } from 'react';
import type { UndoRecord, SkippedOpInfo, OperationType } from '../types';

type PushableUndoRecord = Omit<UndoRecord, 'id' | 'sessionId' | 'timestamp' | 'invalidated'>;

const MAX_UNDO_SIZE = 50;

export const useUndoRedo = () => {
  const sessionId = useRef(crypto.randomUUID());
  const undoStackRef = useRef<UndoRecord[]>([]);
  const redoStackRef = useRef<UndoRecord[]>([]);
  const isUndoingRef = useRef(false);
  // undo/redoの連打による多重実行（並行書き込み・誤った競合判定）を防ぐ
  const isProcessingRef = useRef(false);

  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [skippedOps, setSkippedOps] = useState<SkippedOpInfo[]>([]);

  const updateCanState = useCallback(() => {
    setCanUndo(undoStackRef.current.some(op => !op.invalidated));
    setCanRedo(redoStackRef.current.some(op => !op.invalidated));
  }, []);

  const cascadeInvalidate = useCallback((targetId: string) => {
    undoStackRef.current = undoStackRef.current.map(op =>
      op.targetId === targetId ? { ...op, invalidated: true } : op
    );
    redoStackRef.current = redoStackRef.current.map(op =>
      op.targetId === targetId ? { ...op, invalidated: true } : op
    );
  }, []);

  const pushOperation = useCallback((record: PushableUndoRecord) => {
    if (isUndoingRef.current) return;

    const fullRecord: UndoRecord = {
      ...record,
      id: crypto.randomUUID(),
      sessionId: sessionId.current,
      timestamp: Date.now(),
      invalidated: false,
    };

    undoStackRef.current = [fullRecord, ...undoStackRef.current].slice(0, MAX_UNDO_SIZE);
    redoStackRef.current = [];

    setCanUndo(true);
    setCanRedo(false);
  }, []);

  const undo = useCallback(async () => {
    if (!undoStackRef.current.length) return;
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    try {
      const skipped: SkippedOpInfo[] = [];

      while (undoStackRef.current.length) {
        const op = undoStackRef.current[0];
        undoStackRef.current = undoStackRef.current.slice(1);

        if (op.invalidated) {
          skipped.push({ opType: op.opType as OperationType, reason: 'cascade' });
          continue;
        }

        if (op.isConflicted('undo')) {
          cascadeInvalidate(op.targetId);
          skipped.push({ opType: op.opType as OperationType, reason: 'external' });
          updateCanState();
          continue;
        }

        isUndoingRef.current = true;
        try {
          await op.undo();
          redoStackRef.current = [op, ...redoStackRef.current];
        } finally {
          isUndoingRef.current = false;
        }

        break;
      }

      if (skipped.length > 0) {
        setSkippedOps(skipped);
      }

      updateCanState();
    } finally {
      isProcessingRef.current = false;
    }
  }, [cascadeInvalidate, updateCanState]);

  const redo = useCallback(async () => {
    if (!redoStackRef.current.length) return;
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    try {
      const skipped: SkippedOpInfo[] = [];

      while (redoStackRef.current.length) {
        const op = redoStackRef.current[0];
        redoStackRef.current = redoStackRef.current.slice(1);

        if (op.invalidated) {
          skipped.push({ opType: op.opType as OperationType, reason: 'cascade' });
          continue;
        }

        if (op.isConflicted('redo')) {
          cascadeInvalidate(op.targetId);
          skipped.push({ opType: op.opType as OperationType, reason: 'external' });
          updateCanState();
          continue;
        }

        isUndoingRef.current = true;
        try {
          await op.redo();
          undoStackRef.current = [op, ...undoStackRef.current];
        } finally {
          isUndoingRef.current = false;
        }

        break;
      }

      if (skipped.length > 0) {
        setSkippedOps(skipped);
      }

      updateCanState();
    } finally {
      isProcessingRef.current = false;
    }
  }, [cascadeInvalidate, updateCanState]);

  const clearSkipped = useCallback(() => {
    setSkippedOps([]);
  }, []);

  return {
    sessionId: sessionId.current,
    isUndoingRef,
    pushOperation,
    undo,
    redo,
    canUndo,
    canRedo,
    skippedOps,
    clearSkipped,
  };
};
