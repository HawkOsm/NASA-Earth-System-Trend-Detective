/**
 * TypeScript port of pipeline/core/trendstats.py (trend_1d + verdict).
 * Sen slope, Mann-Kendall test with lag-1 Hamed-Rao variance correction, Sen confidence interval.
 * Slopes and CI are per unit of t (per YEAR when t is in years).
 */

export interface TrendResult {
  slope: number;
  ciLow: number;
  ciHigh: number;
  s: number;
  var0: number;
  r1: number;
  factor: number;
  var: number;
  z: number;
  p: number;
}

export const Z95 = 1.959964;

const SQRT_PI = Math.sqrt(Math.PI);

/**
 * Complementary error function, accurate to ~1e-15 relative for x >= 0 (and handled for x < 0).
 * x < 1: Taylor series of erf (all-positive terms form) then 1 - erf (loss of at most ~6x).
 * x >= 1: Laplace continued fraction for erfc evaluated with the modified Lentz algorithm.
 */
export function erfc(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x < 0) return 2 - erfc(-x);
  if (x === 0) return 1;
  if (x > 27.3) return 0;
  if (x < 1) {
    // erf(x) = 2/sqrt(pi) * exp(-x^2) * sum_{n>=0} 2^n x^(2n+1) / (1*3*5*...*(2n+1))
    const x2 = x * x;
    let term = x;
    let sum = x;
    for (let n = 1; n < 200; n++) {
      term *= (2 * x2) / (2 * n + 1);
      sum += term;
      if (term < sum * 1e-17) break;
    }
    return 1 - ((2 / SQRT_PI) * Math.exp(-x2) * sum);
  }
  // erfc(x) = exp(-x^2)/sqrt(pi) * 1/(x + (1/2)/(x + (2/2)/(x + (3/2)/(x + ...))))
  const tiny = 1e-300;
  let f = x;
  let C = x;
  let D = 0;
  for (let k = 1; k < 5000; k++) {
    const a = k / 2;
    D = x + a * D;
    if (D === 0) D = tiny;
    C = x + a / C;
    if (C === 0) C = tiny;
    D = 1 / D;
    const delta = C * D;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return Math.exp(-x * x) / SQRT_PI / f;
}

function interpSorted(sorted: Float64Array, k: number): number {
  const n = sorted.length;
  k = Math.min(Math.max(k, 0), n - 1);
  const lo = Math.floor(k);
  const hi = Math.min(lo + 1, n - 1);
  const frac = k - lo;
  return sorted[lo] + frac * (sorted[hi] - sorted[lo]);
}

function nanResult(): TrendResult {
  return {
    slope: NaN, ciLow: NaN, ciHigh: NaN, s: NaN, var0: NaN, r1: NaN,
    factor: NaN, var: NaN, z: NaN, p: NaN,
  };
}

/** Average (tie-aware) 1-based ranks. */
function averageRanks(v: number[]): number[] {
  const n = v.length;
  const idx = Array.from({ length: n }, (_, i) => i);
  idx.sort((a, b) => v[a] - v[b]);
  const ranks = new Array<number>(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && v[idx[j + 1]] === v[idx[i]]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[idx[k]] = avg;
    i = j + 1;
  }
  return ranks;
}

export function trend(y: number[], t: number[]): TrendResult {
  const n = y.length;
  for (let i = 0; i < n; i++) if (Number.isNaN(y[i])) return nanResult();

  // 1. pairwise slopes and Sen slope; 2. Mann-Kendall S
  const N = (n * (n - 1)) / 2;
  const slopes = new Float64Array(N);
  let s = 0;
  let m = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const dy = y[j] - y[i];
      slopes[m++] = dy / (t[j] - t[i]);
      s += dy > 0 ? 1 : dy < 0 ? -1 : 0;
    }
  }
  slopes.sort();
  const slope = N % 2 === 1 ? slopes[(N - 1) / 2] : (slopes[N / 2 - 1] + slopes[N / 2]) / 2;

  // 3. variance with tie correction (exact equality)
  const counts = new Map<number, number>();
  for (let i = 0; i < n; i++) counts.set(y[i], (counts.get(y[i]) ?? 0) + 1);
  let tie = 0;
  for (const g of counts.values()) tie += g * (g - 1) * (2 * g + 5);
  const var0 = (n * (n - 1) * (2 * n + 5) - tie) / 18;

  // 4. lag-1 Hamed-Rao correction on ranks of detrended residuals
  const e = y.map((yi, i) => yi - slope * t[i]);
  const R = averageRanks(e);
  let mean = 0;
  for (const r of R) mean += r;
  mean /= n;
  const d = R.map((r) => r - mean);
  let den = 0;
  for (const di of d) den += di * di;
  let num = 0;
  for (let i = 0; i < n - 1; i++) num += d[i] * d[i + 1];
  const r1 = den !== 0 ? num / den : 0;
  let factor = Math.abs(r1) > Z95 / Math.sqrt(n) ? 1 + ((2 * (n - 3)) / n) * r1 : 1;
  factor = Math.max(factor, 1);
  const variance = var0 * factor;

  // 5. z and two-sided p
  let z: number;
  if (variance === 0 || s === 0) z = 0;
  else if (s > 0) z = (s - 1) / Math.sqrt(variance);
  else z = (s + 1) / Math.sqrt(variance);
  const p = erfc(Math.abs(z) / Math.SQRT2);

  // 6. Sen confidence interval with the corrected variance
  const C = Z95 * Math.sqrt(variance);
  const ciLow = interpSorted(slopes, (N - C) / 2 - 1);
  const ciHigh = interpSorted(slopes, (N + C) / 2);

  return { slope, ciLow, ciHigh, s, var0, r1, factor, var: variance, z, p };
}

/** Median of y_i - slope * t_i (intercept of the Sen trend line). */
export function senIntercept(y: number[], t: number[], slope: number): number {
  const r = y.map((yi, i) => yi - slope * t[i]).sort((a, b) => a - b);
  const n = r.length;
  if (n === 0) return NaN;
  return n % 2 === 1 ? r[(n - 1) / 2] : (r[n / 2 - 1] + r[n / 2]) / 2;
}

// ---------------------------------------------------------------------------------------------
// Verdict text (character-identical to Python's verdict()).

/** Digits after the first `keep` digits of a decimal string are exactly "5000...0" -> a true tie. */
function isExactHalf(rest: string): boolean {
  return /^50*$/.test(rest);
}

/** Python's format(x, '.2f') for finite x (round-half-even on the exact binary value). */
export function fmtFixed2(x: number): string {
  const neg = x < 0 || Object.is(x, -0);
  const a = Math.abs(x);
  const long = a.toFixed(60); // exact for any double that is a decimal tie at 2 places
  const dot = long.indexOf('.');
  const rest = long.slice(dot + 3);
  let out = a.toFixed(2);
  if (isExactHalf(rest)) {
    // tie: pick the even last digit
    const trunc = long.slice(0, dot + 3);
    const last = Number(trunc[trunc.length - 1]);
    out = last % 2 === 0 ? trunc : a.toFixed(2);
  }
  return (neg ? '-' : '') + out;
}

/** Python's format(x, '.2g') for finite x. */
export function fmtG2(x: number): string {
  if (x === 0) return Object.is(x, -0) ? '-0' : '0';
  const neg = x < 0;
  const a = Math.abs(x);
  const long = a.toExponential(60);
  const [mant, expStr] = long.split('e');
  const digits = mant.replace('.', '');
  let sig = a.toExponential(1); // d.de+X, rounds ties away; fix below
  if (isExactHalf(digits.slice(2))) {
    const first2 = Number(digits.slice(0, 2));
    const rounded = first2 % 2 === 0 ? first2 : first2 + 1;
    // rounded == 100 carries into the exponent
    const e0 = Number(expStr);
    sig = rounded === 100 ? `1.0e${e0 + 1 >= 0 ? '+' : '-'}${Math.abs(e0 + 1)}` :
      `${String(rounded)[0]}.${String(rounded)[1]}e${e0 >= 0 ? '+' : '-'}${Math.abs(e0)}`;
  }
  const [m2, e2] = sig.split('e');
  const exp = Number(e2);
  let out: string;
  if (exp < -4 || exp >= 2) {
    // exponent form: strip trailing zeros of the mantissa, exponent has at least 2 digits
    let mm = m2;
    if (mm.includes('.')) mm = mm.replace(/0+$/, '').replace(/\.$/, '');
    out = `${mm}e${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
  } else {
    // fixed form with 2 significant digits, trailing zeros stripped
    const dm = m2.replace('.', '');
    let s: string;
    if (exp >= 0) {
      s = dm.slice(0, exp + 1).padEnd(exp + 1, '0');
      const frac = dm.slice(exp + 1);
      if (frac) s += '.' + frac;
    } else {
      s = '0.' + '0'.repeat(-exp - 1) + dm;
    }
    if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
    out = s;
  }
  return (neg ? '-' : '') + out;
}

export function fmtP(p: number): string {
  if (p < 0.001) return 'p < 0.001';
  return `p = ${fmtG2(p)}`;
}

/** The p text without the "p = " prefix ("< 0.001" below 0.001). */
export function fmtPValue(p: number): string {
  if (p < 0.001) return '< 0.001';
  return fmtG2(p);
}

export function fmtRate(x: number): string {
  const a = Math.abs(x);
  return a >= 0.01 || a === 0 ? fmtFixed2(a) : fmtG2(a);
}

export function verdict(slopePerDecade: number, p: number, units: string, alpha = 0.05): string {
  let direction: string;
  if (slopePerDecade > 0) direction = 'rising';
  else if (slopePerDecade < 0) direction = 'falling';
  else direction = 'flat, changing';
  const rate = `${fmtRate(slopePerDecade)} ${units} per decade`;
  const ptxt = fmtP(p);
  if (p < alpha) {
    const cap = direction.charAt(0).toUpperCase() + direction.slice(1);
    return `${cap} by ${rate} — statistically significant (${ptxt}).`;
  }
  if (p < 0.1) {
    return (
      `Possible trend, needs more years: the best estimate is ${direction} by ${rate}, ` +
      `but it is not yet statistically significant (${ptxt}).`
    );
  }
  return `No clear trend: the best estimate is ${direction} by ${rate}, but this could be chance (${ptxt}).`;
}

export type VerdictKind = 'significant' | 'possible' | 'none';

export function verdictKind(p: number, alpha = 0.05): VerdictKind {
  if (p < alpha) return 'significant';
  if (p < 0.1) return 'possible';
  return 'none';
}
