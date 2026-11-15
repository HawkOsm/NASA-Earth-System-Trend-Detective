import { describe, expect, it } from 'vitest';
import { decadeMeans, fmtTick, fmtValue, niceStep, niceTicks, padDomain, trendHistogram } from './countryStats';

const years = Array.from({ length: 45 }, (_, k) => 1981 + k);

describe('decadeMeans', () => {
  it('buckets ten years from the first year and marks the short last bucket', () => {
    const d = decadeMeans(years, years.map((y) => y - 1981));
    expect(d.map((b) => b.label)).toEqual(['1981–90', '1991–00', '2001–10', '2011–20', '2021–25']);
    expect(d[0].mean).toBeCloseTo(4.5);
    expect(d[4].mean).toBeCloseTo(42);
    expect(d.map((b) => b.partial)).toEqual([false, false, false, false, true]);
    expect(d[4].n).toBe(5);
  });

  it('ignores missing years and drops a bucket with too few', () => {
    const vals = years.map((y) => (y <= 1988 ? NaN : 1));
    const d = decadeMeans(years, vals);
    expect(d[0].label).toBe('1991–00');
    expect(decadeMeans(years, years.map((y) => (y === 1985 ? NaN : 2)))[0]).toMatchObject({ n: 9, partial: true, mean: 2 });
  });

  it('returns nothing for an empty series', () => {
    expect(decadeMeans([], [])).toEqual([]);
  });
});

describe('niceStep / niceTicks', () => {
  it('rounds up to 1, 2 or 5 times a power of ten', () => {
    expect(niceStep(0.03)).toBeCloseTo(0.05);
    expect(niceStep(0.2)).toBeCloseTo(0.2);
    expect(niceStep(7)).toBe(10);
    expect(niceStep(0)).toBe(1);
  });

  it('gives ticks inside the range without float noise', () => {
    expect(niceTicks(0, 0.62, 3)).toEqual([0, 0.5]);
    expect(niceTicks(8.4, 13.1, 4)).toEqual([10, 12]);
    expect(niceTicks(-0.3, 0.3, 3)).toEqual([-0.2, 0, 0.2]);
  });
});

describe('trendHistogram', () => {
  const cell = (slopeDecade: number | null, p: number | null = 0.01) => ({ slopeDecade, p });

  it('counts every cell with a trend once, and the significant ones', () => {
    const cells = [cell(0.25), cell(0.31, 0.2), cell(0.44), cell(0.61), cell(null, null)];
    const bins = trendHistogram(cells, 0.05);
    expect(bins.reduce((s, b) => s + b.n, 0)).toBe(4);
    expect(bins.reduce((s, b) => s + b.nSig, 0)).toBe(3);
    expect(bins[0].lo).toBeLessThanOrEqual(0.25);
    expect(bins[bins.length - 1].hi).toBeGreaterThanOrEqual(0.61);
    for (let k = 1; k < bins.length; k++) expect(bins[k].lo).toBeCloseTo(bins[k - 1].hi);
  });

  it('handles one value, negative values and no values', () => {
    expect(trendHistogram([cell(0.5), cell(0.5)], 0.05)).toHaveLength(1);
    const neg = trendHistogram([cell(-0.4), cell(0.4)], 0.05);
    expect(neg[0].lo).toBeLessThanOrEqual(-0.4);
    expect(neg[0].n).toBe(1);
    expect(neg[neg.length - 1].n).toBe(1);
    expect(trendHistogram([cell(null, null)], 0.05)).toEqual([]);
  });
});

describe('labels and domains', () => {
  it('formats values to about three figures', () => {
    expect(fmtValue(12.3456)).toBe('12.3');
    expect(fmtValue(0.4567)).toBe('0.46');
    expect(fmtValue(287.4)).toBe('287');
    expect(fmtTick(0.30000000000000004)).toBe('0.3');
    expect(fmtTick(0)).toBe('0');
  });

  it('pads a domain, keeps zero at the edge when asked, and widens a single value', () => {
    const [lo, hi] = padDomain([0.3, 0.6], true, 0.1);
    expect(lo).toBe(0);
    expect(hi).toBeCloseTo(0.66);
    const [a, b] = padDomain([5], false);
    expect(a).toBeLessThan(5);
    expect(b).toBeGreaterThan(5);
    expect(padDomain([], false)).toEqual([0, 1]);
  });
});
