/** Period selection: the years the trend is computed over (inclusive). */

export const FULL_START = 1981;
export const FULL_END = 2025;
/** The period must contain at least this many years (end - start + 1 >= MIN_PERIOD_YEARS). */
export const MIN_PERIOD_YEARS = 10;

export type Period = [number, number];
export const FULL_PERIOD: Period = [FULL_START, FULL_END];

export function isFullPeriod(p: Period, full: Period = FULL_PERIOD): boolean {
  return p[0] === full[0] && p[1] === full[1];
}

export function periodText(p: Period): string {
  return `${p[0]}–${p[1]}`;
}

/**
 * Clamp a requested period into [full[0], full[1]] with at least MIN_PERIOD_YEARS years. `moved` says which
 * end the user just changed: the other end is pushed (and, at the bounds, the moved end is pulled back).
 * For 'both' (a programmatic request) the end is pushed first.
 */
export function clampPeriod(
  start: number,
  end: number,
  moved: 'start' | 'end' | 'both' = 'both',
  full: Period = FULL_PERIOD,
): Period {
  const lo = full[0];
  const hi = full[1];
  const minSpan = MIN_PERIOD_YEARS - 1;
  let s = Math.min(Math.max(Math.round(Number.isFinite(start) ? start : lo), lo), hi);
  let e = Math.min(Math.max(Math.round(Number.isFinite(end) ? end : hi), lo), hi);
  if (s > e) [s, e] = [e, s];
  if (e - s < minSpan) {
    if (moved === 'end') {
      s = e - minSpan;
      if (s < lo) {
        s = lo;
        e = lo + minSpan;
      }
    } else {
      e = s + minSpan;
      if (e > hi) {
        e = hi;
        s = hi - minSpan;
      }
    }
  }
  return [s, e];
}

/** Keep only the entries whose year lies in [start, end] (inclusive) and whose value is not NaN. */
export function filterToPeriod(
  years: number[],
  values: number[],
  period: Period,
): { years: number[]; values: number[] } {
  const ys: number[] = [];
  const vs: number[] = [];
  for (let k = 0; k < years.length; k++) {
    if (years[k] >= period[0] && years[k] <= period[1] && !Number.isNaN(values[k])) {
      ys.push(years[k]);
      vs.push(values[k]);
    }
  }
  return { years: ys, values: vs };
}
