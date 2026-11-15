import { describe, expect, it } from 'vitest';
import { EMPTY_SHARE, emptyMapText, isEmptyMap } from './emptyMap';

describe('empty map notice', () => {
  it('shows for a recomputed period with nothing significant', () => {
    expect(isEmptyMap({ start: 2016, end: 2025, fracSignificant: 0, recomputed: true })).toBe(true);
    expect(isEmptyMap({ start: 2016, end: 2025, fracSignificant: EMPTY_SHARE - 1e-6, recomputed: true })).toBe(true);
  });

  it('does not show when part of the map is significant', () => {
    expect(isEmptyMap({ start: 2006, end: 2025, fracSignificant: 0.2284, recomputed: true })).toBe(false);
    expect(isEmptyMap({ start: 2011, end: 2025, fracSignificant: EMPTY_SHARE, recomputed: true })).toBe(false);
  });

  it('does not show for the precomputed full-period map or while a share is unknown', () => {
    expect(isEmptyMap({ start: 1981, end: 2025, fracSignificant: 0, recomputed: false })).toBe(false);
    expect(isEmptyMap({ start: 2016, end: 2025, fracSignificant: NaN, recomputed: true })).toBe(false);
  });

  it('names the period and the number of years', () => {
    const text = emptyMapText({ start: 2016, end: 2025, fracSignificant: 0, recomputed: true });
    expect(text).toContain('2016–2025');
    expect(text).toContain('only 10 years');
    expect(text).toContain('Try a longer period.');
  });
});
