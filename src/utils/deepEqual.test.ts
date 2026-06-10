import { describe, it, expect } from 'vitest';
import { deepEqual } from './deepEqual';

describe('deepEqual', () => {
  it('プリミティブ値を比較できる', () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual(1, 2)).toBe(false);
    expect(deepEqual('a', 'a')).toBe(true);
    expect(deepEqual('a', 'b')).toBe(false);
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(null, undefined)).toBe(false);
  });

  it('キーの順序が異なるオブジェクトも等しいと判定する', () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it('キー数が異なるオブジェクトは等しくない', () => {
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
  });

  it('Dateを値で比較する', () => {
    const a = new Date('2026-06-10T00:00:00Z');
    const b = new Date('2026-06-10T00:00:00Z');
    const c = new Date('2026-06-11T00:00:00Z');
    expect(deepEqual(a, b)).toBe(true);
    expect(deepEqual(a, c)).toBe(false);
    expect(deepEqual(a, 'not a date')).toBe(false);
  });

  it('配列を比較できる', () => {
    expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(deepEqual([1, 2, 3], [1, 2])).toBe(false);
    expect(deepEqual([1, 2, 3], [1, 3, 2])).toBe(false);
    expect(deepEqual([1, 2], { 0: 1, 1: 2 })).toBe(false);
  });

  it('ネストしたオブジェクトを比較できる', () => {
    const a = { x: { y: [1, { z: 'a' }] } };
    const b = { x: { y: [1, { z: 'a' }] } };
    const c = { x: { y: [1, { z: 'b' }] } };
    expect(deepEqual(a, b)).toBe(true);
    expect(deepEqual(a, c)).toBe(false);
  });
});
