/** Pure numbers behind the country view's charts (CountryCharts.tsx): decade averages, the histogram of cell trends, axes. */

export interface DecadeMean {
  from: number;
  to: number;
  /** "1981–90". */
  label: string;
  mean: number;
  /** Valid years in the bucket. */
  n: number;
  /** Fewer valid years than the bucket is long (a short last bucket, or missing years). */
  partial: boolean;
}

export const DECADE_MIN_YEARS = 3;

/** Averages of ten-year buckets counted from the first year; a bucket with fewer than `minYears` valid years is left out. */
export function decadeMeans(years: number[], values: number[], minYears = DECADE_MIN_YEARS): DecadeMean[] {
  if (!years.length) return [];
  const first = years[0];
  const last = years[years.length - 1];
  const out: DecadeMean[] = [];
  for (let from = first; from <= last; from += 10) {
    const to = Math.min(from + 9, last);
    let sum = 0;
    let n = 0;
    years.forEach((yr, k) => {
      if (yr >= from && yr <= to && Number.isFinite(values[k])) {
        sum += values[k];
        n++;
      }
    });
    if (n < minYears) continue;
    out.push({ from, to, label: `${from}–${String(to).slice(-2)}`, mean: sum / n, n, partial: n < 10 });
  }
  return out;
}

/** The smallest of 1, 2, 5 x 10^k that is at least x (x > 0). */
export function niceStep(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(x)));
  const f = x / pow;
  const m = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return m * pow;
}

/** Round away the float noise of k * step. */
const snap = (v: number, step: number): number => {
  const d = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  return +v.toFixed(Math.min(d, 12));
};

/** Tick values at nice steps inside [lo, hi], about `target` of them. */
export function niceTicks(lo: number, hi: number, target = 4): number[] {
  if (!(hi > lo)) return [lo];
  const step = niceStep((hi - lo) / target);
  const out: number[] = [];
  for (let k = Math.ceil(lo / step - 1e-9); k * step <= hi + step * 1e-9; k++) out.push(snap(k * step, step));
  return out;
}

export interface HistBin {
  lo: number;
  hi: number;
  n: number;
  /** Of those, the cells significant on their own. */
  nSig: number;
}

/** Cell trends in equal bins with nice edges; cells without a trend are left out. */
export function trendHistogram(cells: { slopeDecade: number | null; p: number | null }[], alpha: number, target = 10): HistBin[] {
  const vals = cells.filter((c) => c.slopeDecade !== null) as { slopeDecade: number; p: number | null }[];
  if (!vals.length) return [];
  let min = Infinity;
  let max = -Infinity;
  for (const c of vals) {
    if (c.slopeDecade < min) min = c.slopeDecade;
    if (c.slopeDecade > max) max = c.slopeDecade;
  }
  const step = max > min ? niceStep((max - min) / target) : niceStep(Math.abs(min) / 10 || 0.1);
  const k0 = Math.floor(min / step + 1e-9);
  const nBins = Math.max(1, Math.floor(max / step + 1e-9) - k0 + 1);
  const bins: HistBin[] = Array.from({ length: nBins }, (_, i) => ({ lo: snap((k0 + i) * step, step), hi: snap((k0 + i + 1) * step, step), n: 0, nSig: 0 }));
  for (const c of vals) {
    const i = Math.min(nBins - 1, Math.max(0, Math.floor(c.slopeDecade / step + 1e-9) - k0));
    bins[i].n++;
    if (c.p !== null && c.p < alpha) bins[i].nSig++;
  }
  return bins;
}

/** A value for a label: about three significant figures, no exponent. */
export function fmtValue(v: number): string {
  const a = Math.abs(v);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

/** A tick label: the tick without float noise or trailing zeros. */
export function fmtTick(v: number): string {
  if (Math.abs(v) < 1e-9) return '0';
  return String(+v.toPrecision(4));
}

/** [lo, hi] around the values with a little room; `zero` forces 0 into it. A single value gets a band around it. */
export function padDomain(values: number[], zero: boolean, pad = 0.08): [number, number] {
  const vs = values.filter((v) => Number.isFinite(v));
  if (zero) vs.push(0);
  if (!vs.length) return [0, 1];
  let lo = Math.min(...vs);
  let hi = Math.max(...vs);
  if (hi === lo) {
    const d = Math.abs(lo) * 0.1 || 1;
    lo -= d;
    hi += d;
  }
  const r = (hi - lo) * pad;
  return [zero && lo === 0 ? 0 : lo - r, zero && hi === 0 ? 0 : hi + r];
}
