import { monthlyAnomalies, type PointSeries } from './power';
import { fmtRate, senIntercept, trend, verdict, verdictKind, type TrendResult, type VerdictKind } from './stats/trend';
import { displayUnits } from './format';

export const MIN_YEARS = 10;

export interface ChartData {
  /** x values (decimal years), strictly increasing. */
  x: number[];
  monthly: (number | null)[];
  annual: (number | null)[];
  trend: (number | null)[];
  xMin: number;
  xMax: number;
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
}

const nz = (v: number): number | null => (Number.isNaN(v) ? null : v);

/** Stats use only years whose annual value is valid. Returns null when fewer than MIN_YEARS are valid. */
export function analyze(series: PointSeries): Analysis | null {
  const years: number[] = [];
  const ann: number[] = [];
  series.years.forEach((yr, k) => {
    if (!Number.isNaN(series.annual[k])) {
      years.push(yr);
      ann.push(series.annual[k]);
    }
  });
  if (years.length < MIN_YEARS) return null;

  const result = trend(ann, years);
  const meanAnn = ann.reduce((a, b) => a + b, 0) / ann.length;
  const intercept = senIntercept(ann, years, result.slope);
  const units = displayUnits(series.units);

  // Merge monthly (mid-month) and annual (at integer year, the t used in the fit) onto one x axis.
  const anomalies = monthlyAnomalies(series.monthly);
  const pts = new Map<number, { m: number | null; a: number | null }>();
  series.monthlyT.forEach((t, k) => pts.set(t, { m: nz(anomalies[k]), a: null }));
  years.forEach((yr, k) => {
    const e = pts.get(yr) ?? { m: null, a: null };
    e.a = ann[k] - meanAnn;
    pts.set(yr, e);
  });
  const x = [...pts.keys()].sort((a, b) => a - b);
  const chart: ChartData = {
    x,
    monthly: x.map((t) => pts.get(t)!.m),
    annual: x.map((t) => pts.get(t)!.a),
    trend: x.map((t) => result.slope * t + intercept - meanAnn),
    xMin: series.years[0],
    xMax: series.years[series.years.length - 1] + 1,
  };

  const slopeDecade = result.slope * 10;
  return {
    nYears: years.length,
    units,
    slopeDecade,
    ciLowDecade: result.ciLow * 10,
    ciHighDecade: result.ciHigh * 10,
    p: result.p,
    verdict: verdict(slopeDecade, result.p, units),
    kind: verdictKind(result.p),
    chart,
    result,
  };
}

/** Rate with an explicit sign, e.g. "+0.54" / "-0.12" / "0.00". */
export function signedRate(x: number): string {
  const body = fmtRate(x);
  if (x > 0) return `+${body}`;
  if (x < 0) return `-${body}`;
  return body;
}
