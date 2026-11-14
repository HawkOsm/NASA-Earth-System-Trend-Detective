import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BADGE_LABEL,
  ROBUST_TEXT,
  UNCHECKED_TEXT,
  gradeWithManyTests,
  holmAdjust,
  lineQuality,
  manyTestsText,
  qualityOf,
  reasonSentences,
  shortReason,
  type QualityResult,
} from './quality';

const here = dirname(fileURLToPath(import.meta.url));
const file = resolve(here, '../../pipeline/tests/fixtures/quality_cases.json');
const fixture: { cases: { name: string; t: number[]; y: number[]; expected: QualityResult }[]; holm: { p: number[]; expected: number[] }[] } =
  JSON.parse(readFileSync(file, 'utf8'));

function close(name: string, actual: unknown, expected: unknown) {
  if (expected === null) {
    expect(actual, name).toBeNull();
    return;
  }
  expect(typeof actual, name).toBe('number');
  const a = actual as number;
  const e = expected as number;
  expect(Math.abs(a - e), `${name}: actual ${a} expected ${e}`).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(e)));
}

const NUMERIC = [
  'slope', 'p', 'kStar', 'pettittK', 'pPettitt', 'withinSlope', 'ratio', 'fit', 'stepYear', 'stepSize', 'outlierYear', 'outlierZ',
  'slopeWithout', 'pWithout', 'slopeFirstHalf', 'pFirstHalf', 'slopeSecondHalf', 'pSecondHalf', 'slopeNoFirst', 'slopeNoLast',
] as const;

describe('qualityOf vs the Python reference (tests/fixtures/quality_cases.json)', () => {
  it('has about 40 or more cases covering every flag and grade', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(40);
    const seen = new Set(fixture.cases.map((c) => c.expected.grade));
    for (const g of ['none', 'robust', 'caution', 'doubtful', 'unchecked']) expect(seen.has(g as never), g).toBe(true);
    for (const f of ['step', 'oneYear', 'reversal', 'endSensitive'] as const) expect(fixture.cases.some((c) => c.expected.flags[f]), f).toBe(true);
  });
  for (const c of fixture.cases) {
    it(c.name, () => {
      const r = qualityOf(c.t, c.y);
      const e = c.expected;
      expect(r.n).toBe(e.n);
      expect(r.checked).toBe(e.checked);
      expect(r.flags).toEqual(e.flags);
      expect(r.grade).toBe(e.grade);
      expect(r.kind).toBe(e.kind);
      expect(r.kindWithout).toBe(e.kindWithout);
      expect(r.endSide).toBe(e.endSide);
      expect(r.stepYear).toBe(e.stepYear);
      expect(r.outlierYear).toBe(e.outlierYear);
      for (const k of NUMERIC) close(k, r[k], e[k]);
    });
  }
  it('refuses NaN (the caller passes the valid years only)', () => {
    expect(() => qualityOf([1, 2], [1, NaN])).toThrow();
  });
});

describe('Holm adjustment (MANY_TESTS)', () => {
  it('hand-computed: p = 0.01, 0.04, 0.03, 0.2 -> 0.04, 0.09, 0.09, 0.2', () => {
    // sorted 0.01, 0.03, 0.04, 0.2 -> x4 = 0.04, x3 = 0.09, x2 = 0.08 (raised to the running max 0.09), x1 = 0.2
    const r = holmAdjust([0.01, 0.04, 0.03, 0.2]);
    [0.04, 0.09, 0.09, 0.2].forEach((e, i) => expect(r[i]).toBeCloseTo(e, 12));
  });
  it('caps at 1 and handles a single p', () => {
    expect(holmAdjust([0.4, 0.9])).toEqual([0.8, 0.9]);
    expect(holmAdjust([0.04])).toEqual([0.04]);
    expect(holmAdjust([])).toEqual([]);
  });
  it('matches the Python helper on the fixture', () => {
    for (const h of fixture.holm) {
      const r = holmAdjust(h.p);
      h.expected.forEach((e, i) => expect(Math.abs(r[i] - e)).toBeLessThanOrEqual(1e-12));
    }
  });
  it('a significant line that is not significant after Holm is at best caution', () => {
    expect(gradeWithManyTests('robust', 'significant', 0.06)).toEqual({ grade: 'caution', manyTests: true });
    expect(gradeWithManyTests('doubtful', 'significant', 0.06)).toEqual({ grade: 'doubtful', manyTests: true });
    expect(gradeWithManyTests('robust', 'significant', 0.049)).toEqual({ grade: 'robust', manyTests: false });
    expect(gradeWithManyTests('robust', 'possible', 0.5)).toEqual({ grade: 'robust', manyTests: false });
  });
  it('lineQuality: short reason for the first flag only, then the many-tests note', () => {
    const flags = { step: true, oneYear: false, reversal: true, endSensitive: false };
    const lq = lineQuality({ grade: 'doubtful', flags, stepYear: 1999, outlierYear: null }, 'significant', 0.2, 10);
    expect(lq.reasons).toEqual(['Looks like a jump around 1999 rather than a gradual change.', manyTestsText(10)]);
    expect(manyTestsText(10)).toBe('Significant on its own, but not after allowing for the 10 variables tested at this place.');
    expect(shortReason({ step: false, oneYear: false, reversal: false, endSensitive: false }, null, null)).toBeNull();
    const robust = lineQuality({ grade: 'robust', flags: { step: false, oneYear: false, reversal: false, endSensitive: false }, stepYear: null, outlierYear: null }, 'significant', 0.01, 5);
    expect(robust).toMatchObject({ grade: 'robust', reasons: [] });
  });
});

describe('sentence wording', () => {
  const byName = (n: string) => {
    const c = fixture.cases.find((x) => x.name === n)!;
    return { c, q: qualityOf(c.t, c.y) };
  };
  it('badge labels', () => {
    expect(BADGE_LABEL).toEqual({ robust: 'Robust', caution: 'Use with caution', doubtful: 'Doubtful' });
  });
  it('robust and unchecked', () => {
    const r = byName('clean trend');
    expect(reasonSentences(r.q, r.c.t, '°C')).toEqual([ROBUST_TEXT]);
    expect(ROBUST_TEXT).toBe('Checks passed: the change is gradual, not driven by one year, and consistent across the record.');
    const u = byName('n = 19');
    expect(reasonSentences(u.q, u.c.t, '°C')).toEqual(['Too few years to check (at least 20 are needed).']);
    expect(UNCHECKED_TEXT).toBe('Too few years to check (at least 20 are needed).');
  });
  it('step', () => {
    const { c, q } = byName('pure step at 1999');
    const s = reasonSentences(q, c.t, 'mm/day');
    expect(s).toHaveLength(1);
    expect(s[0]).toMatch(
      /^Looks like a jump: most of the change happened around 1999 \(about [+-]\d[\d.e-]* mm\/day\), with little trend before or after\. Jumps like this can come from a change in the satellites feeding the dataset\.$/,
    );
  });
  it('one unusual year: trend disappears / hides a trend / direction reverses', () => {
    const a = byName('one unusual year destroys a significant trend');
    expect(reasonSentences(a.q, a.c.t, '°C')).toEqual([`Depends on one unusual year: without ${a.q.outlierYear} the trend is no longer significant.`]);
    const b = byName('one unusual year hides a trend');
    expect(b.q.grade).toBe('none');
    const sb = reasonSentences(b.q, b.c.t, '°C');
    expect(sb).toHaveLength(1);
    expect(sb[0]).toMatch(new RegExp(`^One unusual year hides a trend: without ${b.q.outlierYear} the change would be [+-]\\d[\\d.e-]* °C per decade \\(p = [\\d.e-]+\\)\\.$`));
    const c = byName('one unusual year flips the sign (same verdict kind)');
    expect(c.q.kindWithout).toBe(c.q.kind);
    expect(c.q.grade).toBe('none'); // no trend to grade: the sign-flip sentence is only for graded trends
    expect(reasonSentences(c.q, c.c.t, '°C')).toEqual([]);
  });
  it('reversal and end sensitivity', () => {
    const r = byName('reversal only: rise then a smaller fall');
    expect(reasonSentences(r.q, r.c.t, '°C')).toEqual(['The two halves disagree: 1981–2002 was rising, 2003–2025 was the opposite.']);
    const f = byName('reversal only: fall then a smaller rise');
    expect(reasonSentences(f.q, f.c.t, '°C')).toEqual(['The two halves disagree: 1981–2002 was falling, 2003–2025 was the opposite.']);
    const e1 = byName('end-sensitive only: the first years drive it');
    expect(reasonSentences(e1.q, e1.c.t, '°C')).toEqual(['Depends on the first five years: without them the direction reverses.']);
    const e2 = byName('end-sensitive only: the last years drive it');
    expect(reasonSentences(e2.q, e2.c.t, '°C')).toEqual(['Depends on the last five years: without them the direction reverses.']);
  });
});
