import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/power_istanbul_T2M.json';
import { analyze, signedRate } from './analysis';
import { parsePowerResponse } from './power';

describe('analyze (Istanbul T2M)', () => {
  const a = analyze(parsePowerResponse(fixture, 'T2M'))!;
  it('reports the pipeline numbers with display units', () => {
    expect(a.nYears).toBe(45);
    expect(a.units).toBe('°C');
    expect(signedRate(a.slopeDecade)).toBe('+0.54');
    // ci_low*10 = 0.42499999999999982 (Python gives "0.42" too), so 0.42 not 0.43
    expect(signedRate(a.ciLowDecade)).toBe('+0.42');
    expect(signedRate(a.ciHighDecade)).toBe('+0.65');
    expect(a.kind).toBe('significant');
    expect(a.verdict).toBe('Rising by 0.54 °C per decade — statistically significant (p < 0.001).');
  });
  it('builds aligned, increasing chart data', () => {
    const c = a.chart;
    expect(c.x.length).toBe(c.monthly.length);
    expect(c.x.length).toBe(c.trend.length);
    for (let k = 1; k < c.x.length; k++) expect(c.x[k]).toBeGreaterThan(c.x[k - 1]);
    expect(c.annual.filter((v) => v !== null).length).toBe(45);
    const mean = c.annual.filter((v): v is number => v !== null).reduce((s, v) => s + v, 0) / 45;
    expect(Math.abs(mean)).toBeLessThan(1e-9);
  });
  it('returns null with fewer than 10 valid years', () => {
    const s = parsePowerResponse(fixture, 'T2M');
    s.annual = s.annual.map((v, k) => (k < 36 ? NaN : v));
    expect(analyze(s)).toBeNull();
  });
});
