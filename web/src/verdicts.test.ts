import { describe, expect, it } from 'vitest';
import { verdict, verdictKind } from './stats/trend';
import { ZERO_TREND_TEXT, effectiveKind, effectiveVerdict } from './verdicts';

describe('a zero trend is never called a change', () => {
  it('kind is "none" for a slope of exactly zero, whatever the p-value', () => {
    expect(effectiveKind(0, 0.0001)).toBe('none');
    expect(effectiveKind(0, 0.07)).toBe('none');
    expect(effectiveKind(0, 0.9)).toBe('none');
    expect(effectiveKind(-0, 0.0001)).toBe('none');
  });
  it('any non-zero slope keeps the ordinary rule', () => {
    for (const [s, p] of [[0.3, 0.001], [-0.3, 0.07], [1e-9, 0.02], [-2, 0.5]] as const) {
      expect(effectiveKind(s, p)).toBe(verdictKind(p));
      expect(effectiveVerdict(s, p, 'mm/day')).toBe(verdict(s, p, 'mm/day'));
    }
  });
  it('the sentence for a zero slope does not say rising, falling or significant', () => {
    const text = effectiveVerdict(0, 0.0001, 'percentage points');
    expect(text).toBe(ZERO_TREND_TEXT);
    expect(text).not.toMatch(/rising|falling|significant/i);
  });
});
