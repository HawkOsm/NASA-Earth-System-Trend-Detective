import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { erfc, senIntercept, trend, verdict, verdictKind } from './trend';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(here, '../../../pipeline/tests/fixtures');

interface StatsCase {
  name: string;
  t: number[];
  y: number[];
  expected: Record<string, number>;
}

const statsCases: StatsCase[] = JSON.parse(readFileSync(resolve(fixtures, 'stats_cases.json'), 'utf8'));
const verdictCases: { slope_per_decade: number; p: number; units: string; expected: string }[] = JSON.parse(
  readFileSync(resolve(fixtures, 'verdict_cases.json'), 'utf8'),
);

function expectClose(name: string, actual: number, expected: number, tol = 1e-12) {
  if (Number.isNaN(expected)) {
    expect(actual, name).toBeNaN();
  } else {
    expect(Math.abs(actual - expected), `${name}: actual ${actual} expected ${expected}`).toBeLessThanOrEqual(tol);
  }
}

describe('trend vs Python reference fixtures', () => {
  it('has the expected number of cases', () => {
    expect(statsCases.length).toBe(23);
  });
  for (const c of statsCases) {
    it(c.name, () => {
      const r = trend(c.y, c.t);
      const e = c.expected;
      expectClose('slope', r.slope, e.slope);
      expectClose('ci_low', r.ciLow, e.ci_low);
      expectClose('ci_high', r.ciHigh, e.ci_high);
      expectClose('s', r.s, e.s);
      expectClose('var0', r.var0, e.var0);
      expectClose('r1', r.r1, e.r1);
      expectClose('factor', r.factor, e.factor);
      expectClose('var', r.var, e.var);
      expectClose('z', r.z, e.z);
      expectClose('p', r.p, e.p);
      if (e.p > 0) {
        expect(Math.abs(r.p - e.p) / e.p, `p relative: actual ${r.p} expected ${e.p}`).toBeLessThanOrEqual(1e-9);
      }
    });
  }
  it('returns all NaN when y contains NaN', () => {
    const r = trend([1, 2, NaN, 4], [0, 1, 2, 3]);
    for (const v of Object.values(r)) expect(v).toBeNaN();
  });
});

describe('verdict vs Python fixtures', () => {
  it('has at least 40 cases', () => {
    expect(verdictCases.length).toBeGreaterThanOrEqual(40);
  });
  it('is character-identical for every case', () => {
    for (const c of verdictCases) {
      expect(verdict(c.slope_per_decade, c.p, c.units), JSON.stringify(c)).toBe(c.expected);
    }
  });
  it('verdictKind thresholds', () => {
    expect(verdictKind(0.0499)).toBe('significant');
    expect(verdictKind(0.05)).toBe('possible');
    expect(verdictKind(0.0999)).toBe('possible');
    expect(verdictKind(0.1)).toBe('none');
  });
});

describe('erfc', () => {
  // scipy.special.erfc reference values
  const ref: [number, number][] = [
    [0, 1.0],
    [0.1, 0.8875370839817152],
    [0.5, 0.4795001221869535],
    [1, 0.15729920705028516],
    [1.5, 0.03389485352468927],
    [2, 0.004677734981047266],
    [3, 2.2090496998585445e-05],
    [4, 1.541725790028002e-08],
    [5, 1.5374597944280347e-12],
    [6, 2.1519736712498913e-17],
    [7, 4.183825607779414e-23],
    [8, 1.1224297172982928e-29],
  ];
  for (const [x, v] of ref) {
    it(`erfc(${x})`, () => {
      expect(Math.abs(erfc(x) - v) / v).toBeLessThanOrEqual(1e-14);
    });
  }
});

// --- seeded PRNG (mulberry32) + Box-Muller -----------------------------------------------------
function makeRng(seed: number) {
  let a = seed >>> 0;
  const uni = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = () => {
    const u = 1 - uni();
    const v = uni();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return { uni, normal };
}

const YEARS45 = Array.from({ length: 45 }, (_, i) => 1981 + i);

describe('statistical behaviour', () => {
  it('recovers a known slope and detects it', () => {
    const slopes: number[] = [];
    let sig = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const rng = makeRng(seed);
      const y = YEARS45.map((t) => 10 + 0.03 * (t - 2003) + 0.2 * rng.normal());
      const r = trend(y, YEARS45);
      slopes.push(r.slope);
      if (r.p < 0.05) sig++;
    }
    slopes.sort((a, b) => a - b);
    const median = (slopes[99] + slopes[100]) / 2;
    expect(Math.abs(median - 0.03)).toBeLessThanOrEqual(0.002);
    expect(sig / 200).toBeGreaterThanOrEqual(0.95);
  });

  it('has a sane false-positive rate on white noise', () => {
    let sig = 0;
    for (let seed = 1; seed <= 2000; seed++) {
      const rng = makeRng(100000 + seed);
      const y = YEARS45.map(() => rng.normal());
      if (trend(y, YEARS45).p < 0.05) sig++;
    }
    const rate = sig / 2000;
    expect(rate).toBeGreaterThanOrEqual(0.02);
    expect(rate).toBeLessThanOrEqual(0.07);
  });
});

describe('senIntercept', () => {
  it('is the median of y - slope*t', () => {
    expect(senIntercept([1, 3, 2], [0, 1, 2], 0)).toBe(2);
    expect(senIntercept([2, 4, 6, 8], [0, 1, 2, 3], 2)).toBe(2);
    expect(senIntercept([5, 7, 100], [0, 1, 2], 2)).toBe(5);
  });
});
