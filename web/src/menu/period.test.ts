import { describe, expect, it } from 'vitest';
import fixture from '../point/__fixtures__/power_istanbul_T2M.json';
import { analyze } from '../point/analysis';
import { parsePowerResponse } from '../point/power';
import { trend } from '../stats/trend';
import { FULL_PERIOD, clampPeriod, filterToPeriod, isFullPeriod, periodText } from './period';

describe('clampPeriod', () => {
  it('leaves valid periods alone and keeps the bounds', () => {
    expect(clampPeriod(1995, 2015)).toEqual([1995, 2015]);
    expect(clampPeriod(1981, 2025)).toEqual([1981, 2025]);
    expect(clampPeriod(1900, 3000)).toEqual([1981, 2025]);
    expect(clampPeriod(2015, 1995)).toEqual([1995, 2015]);
    expect(clampPeriod(NaN, NaN)).toEqual([1981, 2025]);
    expect(clampPeriod(1995.4, 2014.6)).toEqual([1995, 2015]);
  });
  it('keeps at least 10 years: the other end is pushed', () => {
    expect(clampPeriod(2000, 2005, 'start')).toEqual([2000, 2009]);
    expect(clampPeriod(2000, 2005, 'end')).toEqual([1996, 2005]);
    expect(clampPeriod(2000, 2000)).toEqual([2000, 2009]);
  });
  it('pulls the moved end back at the bounds', () => {
    expect(clampPeriod(2022, 2025, 'start')).toEqual([2016, 2025]);
    expect(clampPeriod(1981, 1983, 'end')).toEqual([1981, 1990]);
    expect(clampPeriod(2025, 2025, 'both')).toEqual([2016, 2025]);
  });
  it('never yields fewer than 10 years, for every start/end/moved combination', () => {
    for (let s = 1975; s <= 2030; s += 1) {
      for (let e = 1975; e <= 2030; e += 3) {
        for (const m of ['start', 'end', 'both'] as const) {
          const [a, b] = clampPeriod(s, e, m);
          expect(b - a + 1).toBeGreaterThanOrEqual(10);
          expect(a).toBeGreaterThanOrEqual(1981);
          expect(b).toBeLessThanOrEqual(2025);
        }
      }
    }
  });
  it('helpers', () => {
    expect(isFullPeriod([1981, 2025])).toBe(true);
    expect(isFullPeriod([1982, 2025])).toBe(false);
    expect(periodText([1995, 2015])).toBe('1995–2015');
  });
});

describe('filterToPeriod', () => {
  it('keeps years inside the inclusive period and drops NaN', () => {
    const years = [1990, 1991, 1992, 1993, 1994];
    const vals = [1, 2, NaN, 4, 5];
    expect(filterToPeriod(years, vals, [1991, 1994])).toEqual({ years: [1991, 1993, 1994], values: [2, 4, 5] });
    expect(filterToPeriod(years, vals, [1980, 2000]).years).toEqual([1990, 1991, 1993, 1994]);
  });
});

describe('analyze with a period (Istanbul T2M)', () => {
  const series = parsePowerResponse(fixture, 'T2M');
  it('full period equals the default call', () => {
    const a = analyze(series)!;
    const b = analyze(series, FULL_PERIOD)!;
    expect(b.slopeDecade).toBe(a.slopeDecade);
    expect(b.chart.trend).toEqual(a.chart.trend);
    expect(b.chart.shade).toBeNull();
    expect(a.years.length).toBe(45);
  });
  it('uses only the years in the period, equal to trend() on the slice', () => {
    const a = analyze(series, [1995, 2015])!;
    const ys = series.years.filter((y) => y >= 1995 && y <= 2015);
    const vs = series.annual.filter((_, k) => series.years[k] >= 1995 && series.years[k] <= 2015);
    const r = trend(vs, ys);
    expect(a.years).toEqual(ys);
    expect(a.annual).toEqual(vs);
    expect(a.nYears).toBe(21);
    expect(a.slopeDecade).toBe(r.slope * 10);
    expect(a.p).toBe(r.p);
    expect(a.period).toEqual([1995, 2015]);
    // the chart still shows the whole series; the trend line exists only inside the period
    expect(a.chart.annual.filter((v) => v !== null).length).toBe(45);
    expect(a.chart.shade).toEqual([1995, 2015]);
    a.chart.x.forEach((x, k) => {
      const inside = x >= 1995 && x <= 2015;
      expect(a.chart.trend[k] !== null).toBe(inside);
    });
  });
  it('needs 10 valid years inside the period', () => {
    const s = { ...series, annual: series.annual.map((v, k) => (series.years[k] >= 2000 && series.years[k] < 2005 ? NaN : v)) };
    expect(analyze(s, [1995, 2008])).toBeNull(); // 1995-1999 + 2005-2008 = 9 valid years
    expect(analyze(s, [1995, 2009])).not.toBeNull(); // 10
  });
});
