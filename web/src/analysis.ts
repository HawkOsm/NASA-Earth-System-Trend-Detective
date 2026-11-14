import { monthlyAnomalies, type PointSeries } from './power';
import { fmtRate, senIntercept, trend, type TrendResult, type VerdictKind } from './stats/trend';
import { effectiveKind, effectiveVerdict } from './verdicts';
import { displayUnits, rateUnitsLong } from './format';
import { filterToPeriod, isFullPeriod, type Period } from './period';
import { qualityOf, type QualityResult } from './quality';

export const MIN_YEARS = 10;

export interface ChartData {
  /** x values (decimal years), strictly increasing. */
  x: number[];
  monthly: (number | null)[];
  annual: (number | null)[];
  trend: (number | null)[];
  xMin: number;
  xMax: number;
  /** Selected period when it is not the whole series (the chart shades it); null for the whole series. */
  shade: Period | null;
}

export interface Analysis {
  nYears: number;
  units: string;
  slopeDecade: number;
  ciLowDecade: number;
  ciHighDecade: number;
  p: number;
  verdict: string;
  kind: VerdictKind;
  chart: ChartData;
  result: TrendResult;
  /** The years the statistics were computed over (inclusive). */
  period: Period;
  /** Valid years and annual values inside the period (the ones used for the statistics). */
  years: number[];
  annual: number[];
  /** Quality checks of this trend (quality.ts): flags, grade and the numbers behind them. */
  quality: QualityResult;
}

const nz = (v: number): number | null => (Number.isNaN(v) ? null : v);

/**
 * Stats use only years inside `period` (default: the whole series) whose annual value is valid. Returns null
 * when fewer than MIN_YEARS are valid. The chart always covers the whole series; the annual anomalies are
 * relative to the mean of all valid years, and the trend line is drawn only across the period.
 */
export function analyze(series: PointSeries, period?: Period): Analysis | null {
  const allYears: number[] = [];
  const allAnn: number[] = [];
  series.years.forEach((yr, k) => {
    if (!Number.isNaN(series.annual[k])) {
      allYears.push(yr);
      allAnn.push(series.annual[k]);
    }
  });
  const first = series.years[0];
  const last = series.years[series.years.length - 1];
  const per: Period = period ?? [first, last];
  const { years, values: ann } = filterToPeriod(allYears, allAnn, per);
  if (years.length < MIN_YEARS) return null;
  const partial = !isFullPeriod(per, [first, last]);

  const result = trend(ann, years);
  const meanAnn = allAnn.reduce((a, b) => a + b, 0) / allAnn.length;
  const intercept = senIntercept(ann, years, result.slope);
  const units = displayUnits(series.units);

  // Merge monthly (mid-month) and annual (at integer year, the t used in the fit) onto one x axis.
  const anomalies = monthlyAnomalies(series.monthly);
  const pts = new Map<number, { m: number | null; a: number | null }>();
  series.monthlyT.forEach((t, k) => pts.set(t, { m: nz(anomalies[k]), a: null }));
  allYears.forEach((yr, k) => {
    const e = pts.get(yr) ?? { m: null, a: null };
    e.a = allAnn[k] - meanAnn;
    pts.set(yr, e);
  });
  const x = [...pts.keys()].sort((a, b) => a - b);
  const chart: ChartData = {
    x,
    monthly: x.map((t) => pts.get(t)!.m),
    annual: x.map((t) => pts.get(t)!.a),
    trend: x.map((t) =>
      partial && (t < per[0] || t > per[1]) ? null : result.slope * t + intercept - meanAnn,
    ),
    xMin: first,
    xMax: last + 1,
    shade: partial ? per : null,
  };

  const slopeDecade = result.slope * 10;
  return {
    nYears: years.length,
    units,
    slopeDecade,
    ciLowDecade: result.ciLow * 10,
    ciHighDecade: result.ciHigh * 10,
    p: result.p,
    verdict: effectiveVerdict(slopeDecade, result.p, rateUnitsLong(units)),
    kind: effectiveKind(slopeDecade, result.p),
    chart,
    result,
    period: per,
    years,
    annual: ann,
    // A trend of exactly zero is "no measurable change" (verdicts.ts): there is nothing to grade.
    quality: slopeDecade === 0 ? { ...qualityOf(years, ann), grade: 'none' as const } : qualityOf(years, ann),
  };
}

/** Rate with an explicit sign, e.g. "+0.54" / "-0.12" / "0.00". */
export function signedRate(x: number): string {
  const body = fmtRate(x);
  if (x > 0) return `+${body}`;
  if (x < 0) return `-${body}`;
  return body;
}
