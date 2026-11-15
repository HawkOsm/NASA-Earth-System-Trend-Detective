import { verdict, verdictKind, type VerdictKind } from '../stats/trend';

/**
 * A trend of exactly zero is never reported as a change.
 *
 * With coarsely stepped data (whole percent for snow, sea ice and soil moisture) more than half of all pairs of
 * years can show no change at all. The Theil–Sen slope, the median of those pairwise changes, is then exactly 0,
 * while the Mann–Kendall test can still come out "significant" because the remaining pairs lean one way. Calling
 * "0.00 per decade" a significant rise or fall would be wrong, so the verdict kind is "none" and the sentence says
 * what was found. Every place that shows a verdict goes through these two functions.
 */
export const ZERO_TREND_TEXT =
  'No measurable change: in more than half of all pairs of years the value did not change, so the typical change is zero.';

export function effectiveKind(slopePerDecade: number, p: number): VerdictKind {
  return slopePerDecade === 0 ? 'none' : verdictKind(p);
}

export function effectiveVerdict(slopePerDecade: number, p: number, units: string): string {
  return slopePerDecade === 0 ? ZERO_TREND_TEXT : verdict(slopePerDecade, p, units);
}
