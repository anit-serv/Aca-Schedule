import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUndoRedo } from './useUndoRedo';

const makeOp = (overrides: Partial<{
  targetId: string;
  opType: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  isConflicted: (direction: 'undo' | 'redo') => boolean;
}> = {}) => ({
  targetId: overrides.targetId ?? 'target1',
  opType: (overrides.opType ?? 'band:add') as never,
  undo: overrides.undo ?? vi.fn().mockResolvedValue(undefined),
  redo: overrides.redo ?? vi.fn().mockResolvedValue(undefined),
  isConflicted: overrides.isConflicted ?? (() => false),
});

describe('useUndoRedo', () => {
  beforeEach(() => {
    vi.spyOn(window, 'alert').mockImplementation(() => {});
  });

  it('初期状態ではundo/redoできない', () => {
    const { result } = renderHook(() => useUndoRedo());
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it('pushOperationでcanUndoがtrueになり、canRedoはfalseのまま', () => {
    const { result } = renderHook(() => useUndoRedo());
    act(() => {
      result.current.pushOperation(makeOp());
    });
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it('undo→redoで状態が遷移する', async () => {
    const { result } = renderHook(() => useUndoRedo());
    const op = makeOp();
    act(() => {
      result.current.pushOperation(op);
    });

    await act(async () => {
      await result.current.undo();
    });
    expect(op.undo).toHaveBeenCalledTimes(1);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);

    await act(async () => {
      await result.current.redo();
    });
    expect(op.redo).toHaveBeenCalledTimes(1);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it('競合しているoperationはskipされ、cascadeInvalidateされる', async () => {
    const { result } = renderHook(() => useUndoRedo());
    const conflictingOp = makeOp({ targetId: 'shared', isConflicted: () => true });
    const otherOp = makeOp({ targetId: 'shared' });

    act(() => {
      // otherOpを先にpushし、その後conflictingOpをpush（undoスタックは新しい順）
      result.current.pushOperation(otherOp);
      result.current.pushOperation(conflictingOp);
    });

    await act(async () => {
      await result.current.undo();
    });

    // conflictingOpはskipされ、cascadeInvalidateにより同じtargetIdのotherOpも無効化される
    expect(conflictingOp.undo).not.toHaveBeenCalled();
    expect(otherOp.undo).not.toHaveBeenCalled();
    expect(result.current.skippedOps).toHaveLength(2);
    expect(result.current.skippedOps.map(s => s.reason).sort()).toEqual(['cascade', 'external']);
    expect(result.current.canUndo).toBe(false);
  });

  it('undo中の連打は無視される（多重実行ガード）', async () => {
    const { result } = renderHook(() => useUndoRedo());
    let resolveUndo: () => void = () => {};
    const op = makeOp({
      undo: vi.fn().mockImplementation(() => new Promise<void>(resolve => { resolveUndo = resolve; })),
    });

    act(() => {
      result.current.pushOperation(op);
    });

    let firstUndoPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      firstUndoPromise = result.current.undo();
      // 1回目が処理中の間に2回目を呼ぶ
      await result.current.undo();
      resolveUndo();
      await firstUndoPromise;
    });

    expect(op.undo).toHaveBeenCalledTimes(1);
  });

  it('undo失敗時は操作をundoスタックに戻し、alertを表示する', async () => {
    const { result } = renderHook(() => useUndoRedo());
    const op = makeOp({ undo: vi.fn().mockRejectedValue(new Error('failed')) });

    act(() => {
      result.current.pushOperation(op);
    });

    await act(async () => {
      await result.current.undo();
    });

    expect(window.alert).toHaveBeenCalled();
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it('スタックはMAX_UNDO_SIZE(50)を超えると古い操作が破棄される', async () => {
    const { result } = renderHook(() => useUndoRedo());
    const ops = Array.from({ length: 51 }, (_, i) => makeOp({ targetId: `t${i}` }));

    act(() => {
      ops.forEach(op => result.current.pushOperation(op));
    });

    // 50回undoすればスタックが空になり、51番目(最初にpushしたもの)は破棄されている
    for (let i = 0; i < 50; i++) {
      await act(async () => {
        await result.current.undo();
      });
    }
    expect(result.current.canUndo).toBe(false);
    expect(ops[0].undo).not.toHaveBeenCalled();
    expect(ops[50].undo).toHaveBeenCalledTimes(1);
  });
});
