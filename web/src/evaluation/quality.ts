/**
 * Quality checks on a trend (evaluation layer): TypeScript mirror of pipeline/quality.py (quality_1d), tied to it by
 * pipeline/tests/fixtures/quality_cases.json. The definitions and thresholds are FIXED; see quality.py for the full text.
 *
 * Input: the valid years and values of the selected period. Fewer than MIN_YEARS (20) -> every flag is false and the
 * grade is "unchecked". Flags: STEP (a jump), ONE_YEAR (depends on one unusual year), REVERSAL (the two halves
 * disagree), END_SENSITIVE (depends on the first or last five years). Grade: only when the verdict kind is significant
 * or possible ("none" otherwise): doubtful = ONE_YEAR or two or more flags; caution = exactly one of STEP / REVERSAL /
 * END_SENSITIVE; robust = no flag. MANY_TESTS (Holm over the variables of one place) lives in holmAdjust /
 * gradeWithManyTests. The checks cannot prove the data is right; they catch patterns that are known signs of trouble.
 */
import { fmtP, fmtRate, trend, verdictKind, type VerdictKind } from '../stats/trend';

export const MIN_YEARS_QUALITY = 20;
const MIN_PART = 5;
const P_STEP = 0.05;
const RATIO_MAX = 0.5;
const FIT_MAX = 0.85;
const Z_OUTLIER = 3.5;
const MAD_SCALE = 0.6745;
const END_YEARS = 5;

export type Grade = 'none' | 'robust' | 'caution' | 'doubtful' | 'unchecked';
export type EndSide = 'first' | 'last' | 'both';

export interface QualityFlags {
  step: boolean;
  oneYear: boolean;
  reversal: boolean;
  endSensitive: boolean;
}

/** Every intermediate number, the flags and the grade (the same dict as quality_1d; null = not computed). */
export interface QualityResult {
  n: number;
  checked: boolean;
  slope: number | null;
  p: number | null;
  kind: VerdictKind | null;
  kStar: number | null;
  pettittK: number | null;
  pPettitt: number | null;
  withinSlope: number | null;
  ratio: number | null;
  fit: number | null;
  stepYear: number | null;
  stepSize: number | null;
  outlierYear: number | null;
  outlierZ: number | null;
  slopeWithout: number | null;
  pWithout: number | null;
  kindWithout: VerdictKind | null;
  slopeFirstHalf: number | null;
  pFirstHalf: number | null;
  slopeSecondHalf: number | null;
  pSecondHalf: number | null;
  slopeNoFirst: number | null;
  slopeNoLast: number | null;
  endSide: EndSide | null;
  flags: QualityFlags;
  grade: Grade;
}

/** Rate with an explicit sign, as analysis.ts signedRate (not imported: analysis.ts imports this file). */
function signedRate(x: number): string {
  const body = fmtRate(x);
  return x > 0 ? `+${body}` : x < 0 ? `-${body}` : body;
}

const sign = (x: number): number => (x > 0 ? 1 : x < 0 ? -1 : 0);

function median(v: number[]): number {
  const a = v.slice().sort((x, y) => x - y);
  const n = a.length;
  return n % 2 === 1 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}

function sumAbs(v: number[]): number {
  let s = 0;
  for (const x of v) s += Math.abs(x);
  return s;
}

export function gradeOf(kind: VerdictKind, flags: QualityFlags): Grade {
  if (kind === 'none') return 'none';
  if (flags.oneYear) return 'doubtful';
  const k = (flags.step ? 1 : 0) + (flags.reversal ? 1 : 0) + (flags.endSensitive ? 1 : 0);
  return k >= 2 ? 'doubtful' : k === 1 ? 'caution' : 'robust';
}

function emptyResult(n: number): QualityResult {
  return {
    n, checked: false, slope: null, p: null, kind: null,
    kStar: null, pettittK: null, pPettitt: null, withinSlope: null, ratio: null, fit: null, stepYear: null, stepSize: null,
    outlierYear: null, outlierZ: null, slopeWithout: null, pWithout: null, kindWithout: null,
    slopeFirstHalf: null, pFirstHalf: null, slopeSecondHalf: null, pSecondHalf: null,
    slopeNoFirst: null, slopeNoLast: null, endSide: null,
    flags: { step: false, oneYear: false, reversal: false, endSensitive: false },
    grade: 'unchecked',
  };
}

/** The quality checks for the valid years `t` (ascending) and values `y` of the selected period. */
export function qualityOf(t: number[], y: number[]): QualityResult {
  const n = y.length;
  for (let i = 0; i < n; i++) if (Number.isNaN(y[i])) throw new Error('qualityOf needs the valid years only (no NaN)');
  const out = emptyResult(n);
  if (n < MIN_YEARS_QUALITY) return out;
  out.checked = true;
  const tr = trend(y, t);
  const slope = tr.slope;
  const kind = verdictKind(tr.p);
  out.slope = slope;
  out.p = tr.p;
  out.kind = kind;
  const flags = out.flags;

  // 1. STEP
  let kStar = 0;
  let best = -1;
  for (let k = 0; k < n - 1; k++) {
    let u = 0;
    for (let i = 0; i <= k; i++) for (let j = k + 1; j < n; j++) u += sign(y[j] - y[i]);
    if (Math.abs(u) > best) {
      best = Math.abs(u);
      kStar = k;
    }
  }
  const K = best;
  const pPet = Math.min(1, 2 * Math.exp((-6 * K * K) / (n ** 3 + n ** 2)));
  out.kStar = kStar;
  out.pettittK = K;
  out.pPettitt = pPet;
  if (kStar >= MIN_PART - 1 && kStar <= n - MIN_PART - 1) {
    const within: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        if (j <= kStar || i > kStar) within.push((y[j] - y[i]) / (t[j] - t[i]));
      }
    }
    const withinSlope = median(within);
    const m1 = median(y.slice(0, kStar + 1));
    const m2 = median(y.slice(kStar + 1));
    const stepRes = sumAbs(y.slice(0, kStar + 1).map((v) => v - m1)) + sumAbs(y.slice(kStar + 1).map((v) => v - m2));
    const r = y.map((v, i) => v - slope * t[i]);
    const rm = median(r);
    const lineRes = sumAbs(r.map((v) => v - rm));
    out.withinSlope = withinSlope;
    out.stepYear = Math.round(t[kStar + 1]);
    out.stepSize = m2 - m1;
    if (slope !== 0) out.ratio = withinSlope / slope;
    if (lineRes !== 0) out.fit = stepRes / lineRes;
    if (slope !== 0 && lineRes !== 0) flags.step = pPet < P_STEP && out.ratio! < RATIO_MAX && out.fit! < FIT_MAX;
  }

  // 2. ONE_YEAR
  {
    const r0 = y.map((v, i) => v - slope * t[i]);
    const rm = median(r0);
    const r = r0.map((v) => v - rm);
    const mad = median(r.map(Math.abs));
    if (mad !== 0) {
      const z = r.map((v) => (MAD_SCALE * v) / mad);
      let iStar = 0;
      for (let i = 1; i < n; i++) if (Math.abs(z[i]) > Math.abs(z[iStar])) iStar = i;
      if (Math.abs(z[iStar]) > Z_OUTLIER) {
        const yy = y.filter((_, i) => i !== iStar);
        const tt = t.filter((_, i) => i !== iStar);
        const tr2 = trend(yy, tt);
        const kind2 = verdictKind(tr2.p);
        out.outlierYear = Math.round(t[iStar]);
        out.outlierZ = z[iStar];
        out.slopeWithout = tr2.slope;
        out.pWithout = tr2.p;
        out.kindWithout = kind2;
        flags.oneYear = kind2 !== kind || sign(tr2.slope) * sign(slope) < 0;
      }
    }
  }

  // 3. REVERSAL
  const h = Math.floor(n / 2);
  const a = trend(y.slice(0, h), t.slice(0, h));
  const b = trend(y.slice(h), t.slice(h));
  out.slopeFirstHalf = a.slope;
  out.pFirstHalf = a.p;
  out.slopeSecondHalf = b.slope;
  out.pSecondHalf = b.p;
  flags.reversal = sign(a.slope) * sign(b.slope) < 0 && a.p < 0.1 && b.p < 0.1;

  // 4. END_SENSITIVE
  const sFirst = trend(y.slice(END_YEARS), t.slice(END_YEARS)).slope;
  const sLast = trend(y.slice(0, n - END_YEARS), t.slice(0, n - END_YEARS)).slope;
  out.slopeNoFirst = sFirst;
  out.slopeNoLast = sLast;
  const flipFirst = sign(sFirst) * sign(slope) < 0;
  const flipLast = sign(sLast) * sign(slope) < 0;
  flags.endSensitive = flipFirst || flipLast;
  if (flags.endSensitive) out.endSide = flipFirst && flipLast ? 'both' : flipFirst ? 'first' : 'last';

  out.grade = gradeOf(kind, flags);
  return out;
}

// ---- many tests (the Detective) --------------------------------------------------------------------------------------

/** Holm-adjusted p-values in the order of the input: adj_(i) = max over j <= i of min(1, (m - j + 1) p_(j)). */
export function holmAdjust(ps: number[]): number[] {
  const m = ps.length;
  const order = ps.map((_, i) => i).sort((i, j) => ps[i] - ps[j] || i - j);
  const out = new Array<number>(m).fill(0);
  let run = 0;
  order.forEach((i, rank) => {
    run = Math.max(run, Math.min(1, (m - rank) * ps[i]));
    out[i] = run;
  });
  return out;
}

/** MANY_TESTS: a significant line whose Holm-adjusted p is >= 0.05 gets the note and is at best "caution". */
export function gradeWithManyTests(grade: Grade, kind: VerdictKind, pAdjusted: number): { grade: Grade; manyTests: boolean } {
  const manyTests = kind === 'significant' && pAdjusted >= 0.05;
  return { grade: manyTests && grade === 'robust' ? 'caution' : grade, manyTests };
}

// ---- wording ---------------------------------------------------------------------------------------------------------

export const BADGE_LABEL: Record<'robust' | 'caution' | 'doubtful', string> = {
  robust: 'Robust',
  caution: 'Use with caution',
  doubtful: 'Doubtful',
};

export const ROBUST_TEXT = 'Pattern checks passed: the change is gradual, not driven by one year, and consistent across the record.';
export const UNCHECKED_TEXT = 'Too few years to check (at least 20 are needed).';

export function manyTestsText(n: number): string {
  return `Significant on its own, but not after allowing for the ${n} variables tested at this place.`;
}

const RANK: Record<VerdictKind, number> = { none: 0, possible: 1, significant: 2 };

/** The ONE_YEAR sentence (also for a verdict of "none": a trend that appears when the year is left out). */
export function oneYearText(q: QualityResult, unitsLong: string): string | null {
  if (!q.flags.oneYear || q.kind === null || q.kindWithout === null) return null;
  const year = q.outlierYear!;
  if (q.kindWithout !== q.kind) {
    if (RANK[q.kindWithout] < RANK[q.kind]) return `Depends on one unusual year: without ${year} the trend is no longer significant.`;
    return `One unusual year hides a trend: without ${year} the change would be ${signedRate(q.slopeWithout! * 10)} ${unitsLong} per decade (${fmtP(q.pWithout!)}).`;
  }
  return `Depends on one unusual year: without ${year} the direction reverses.`;
}

/**
 * The reason sentences of a result, in the order STEP, ONE_YEAR, REVERSAL, END_SENSITIVE. A grade of "robust" gives
 * the "Checks passed" sentence, "unchecked" the "too few years" sentence, and "none" (no significant or possible trend)
 * only the "one unusual year hides a trend" sentence when it applies. `years` are the years the result was computed
 * from; `unitsLong` the display units in words ("°C", "percentage points").
 */
export function reasonSentences(q: QualityResult, years: number[], unitsLong: string): string[] {
  if (q.grade === 'unchecked') return [UNCHECKED_TEXT];
  if (q.grade === 'robust') return [ROBUST_TEXT];
  const out: string[] = [];
  if (q.grade === 'none') {
    if (q.kind === 'none' && q.kindWithout && q.kindWithout !== 'none') {
      const s = oneYearText(q, unitsLong);
      if (s) out.push(s);
    }
    return out;
  }
  if (q.flags.step) {
    out.push(
      `Looks like a jump: most of the change happened around ${q.stepYear} (about ${signedRate(q.stepSize!)} ${unitsLong}), ` +
        'with little trend before or after. Jumps like this can come from a change in the satellites feeding the dataset.',
    );
  }
  const one = oneYearText(q, unitsLong);
  if (one) out.push(one);
  if (q.flags.reversal) {
    const h = Math.floor(q.n / 2);
    const dir = q.slopeFirstHalf! > 0 ? 'rising' : 'falling';
    out.push(`The two halves disagree: ${years[0]}–${years[h - 1]} was ${dir}, ${years[h]}–${years[q.n - 1]} was the opposite.`);
  }
  if (q.flags.endSensitive) {
    const which = q.endSide === 'both' ? 'first and last' : q.endSide;
    out.push(`Depends on the ${which} five years: without them the direction reverses.`);
  }
  return out;
}

/** One short reason for a Detective line: the first flag only (STEP, ONE_YEAR, REVERSAL, END_SENSITIVE), or null. */
export function shortReason(flags: QualityFlags, stepYear: number | null, outlierYear: number | null): string | null {
  if (flags.step) return `Looks like a jump${stepYear ? ` around ${stepYear}` : ''} rather than a gradual change.`;
  if (flags.oneYear) return `Depends on one unusual year${outlierYear ? ` (${outlierYear})` : ''}.`;
  if (flags.reversal) return 'The two halves of the record disagree.';
  if (flags.endSensitive) return 'Depends on the first or last five years.';
  return null;
}

// ---- the Detective: quality of one variable at one place -------------------------------------------------------------

/** Flags, grade and years of one variable at one place (a coarse cell of quality.bin, or a region of regions.json). */
export interface VarQuality {
  grade: Grade;
  flags: QualityFlags;
  stepYear: number | null;
  outlierYear: number | null;
}

/** What a Detective line shows: the final grade (after the many-tests rule), its reasons (short, first flag only) and notes. */
export interface LineQuality {
  grade: Grade;
  flags: QualityFlags;
  manyTests: boolean;
  /** The lines under the badge: the short reason for the first flag, then the many-tests note. Empty for a robust line. */
  reasons: string[];
}

/** Grade a significant / possible Detective line: the stored quality, then MANY_TESTS from the Holm-adjusted p of the place. */
export function lineQuality(vq: VarQuality, kind: VerdictKind, pAdjusted: number, nTested: number): LineQuality {
  const { grade, manyTests } = gradeWithManyTests(vq.grade, kind, pAdjusted);
  const reasons: string[] = [];
  const first = shortReason(vq.flags, vq.stepYear, vq.outlierYear);
  if (first) reasons.push(first);
  if (manyTests) reasons.push(manyTestsText(nTested));
  return { grade, flags: vq.flags, manyTests, reasons };
}
