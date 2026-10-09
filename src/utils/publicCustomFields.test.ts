import { describe, expect, it } from 'vitest';
import type { DailyCustomData } from '../types';
import { getPublicSequenceValue } from './publicCustomFields';

describe('getPublicSequenceValue', () => {
  const daily: DailyCustomData = {
    byEntity: {},
    bySequence: {
      1: { public: { value: '共通案内', rowSpan: 3 } },
      2: { public: { value: '', rowSpan: 0 } },
      3: { public: { value: '', rowSpan: 0 } },
      4: { public: { value: '個別案内' } },
      5: { public: { value: '', rowSpan: 0 } },
    },
  };

  it('repeats a merged value through the exact covered range', () => {
    expect([1, 2, 3].map(sequence => getPublicSequenceValue(daily, sequence, 'public'))).toEqual(['共通案内', '共通案内', '共通案内']);
  });

  it('does not repeat a value outside the merged range or for a missing column', () => {
    expect(getPublicSequenceValue(daily, 4, 'public')).toBe('個別案内');
    expect(getPublicSequenceValue(daily, 5, 'public')).toBe('');
    expect(getPublicSequenceValue(daily, 2, 'private')).toBe('');
  });
});
