import { describe, expect, it } from 'vitest';
import { analyze } from './analysis';
import { countryMeanSeries, parseInt16Series } from './country';
import { cleanApiValue, neverPresent, rulesFromMeta } from './noData';
import { parsePowerResponse, parseRegionalResponse } from './power';
import { bilinearToPixels, computeChunk } from './rangeMap';
import { areaMeanSeries } from './region';

/** A POWER-like monthly point response: one value per year in month 13 (and month 01), the rest filled. */
function resp(variable: string, annual: number[], fill = -999) {
  const parameter: Record<string, number> = {};
  annual.forEach((v, k) => {
    const y = 1981 + k;
    const w = Number.isNaN(v) ? fill : v;
    parameter[`${y}01`] = w;
    parameter[`${y}13`] = w;
  });
  return { header: { fill_value: fill }, parameters: { [variable]: { units: '1' } }, properties: { parameter: { [variable]: parameter } } };
}
const years45 = (f: (k: number) => number) => Array.from({ length: 45 }, (_, k) => f(k));

describe('cleanApiValue', () => {
  it('fill value, <= -900 and non-numbers are missing', () => {
    expect(cleanApiValue(-999, -999)).toBeNaN();
    expect(cleanApiValue(-950, -1)).toBeNaN();
    expect(cleanApiValue(-900, -1)).toBeNaN();
    expect(cleanApiValue(null, -999)).toBeNaN();
    expect(cleanApiValue(0, -999)).toBe(0);
    expect(cleanApiValue(-30.5, -999)).toBe(-30.5);
  });
  it('percent variables become whole percent', () => {
    expect(cleanApiValue(0.29, -999, 100)).toBe(29);
    expect(cleanApiValue(0.57, -999, 100)).toBe(57);
    expect(cleanApiValue(1, -999, 100)).toBe(100);
    expect(cleanApiValue(-999, -999, 100)).toBeNaN();
  });
});

describe('parsePowerResponse with rules', () => {
  const soil = rulesFromMeta({ display_scale: 100, zero_means_absent: false, units: '%' });
  it('scales a fraction to percent, uses the meta units, and keeps zeros for an ordinary variable', () => {
    const s = parsePowerResponse(resp('GWETROOT', years45((k) => (k % 2 ? 0.29 : 0))), 'GWETROOT', soil);
    expect(s.units).toBe('%');
    expect(s.annual[1]).toBe(29);
    expect(s.annual[0]).toBe(0);
  });
  it('the sea (all fill) is all NaN and analyze says not enough data, never a trend', () => {
    const s = parsePowerResponse(resp('GWETROOT', years45(() => NaN)), 'GWETROOT', soil);
    expect(s.annual.every(Number.isNaN)).toBe(true);
    expect(analyze(s)).toBeNull();
  });
  const snow = rulesFromMeta({ display_scale: 100, zero_means_absent: true, units: '%' });
  it('snow / sea ice: all zero in every year is no data (annual and monthly)', () => {
    const s = parsePowerResponse(resp('FRSNO', years45(() => 0)), 'FRSNO', snow);
    expect(s.annual.every(Number.isNaN)).toBe(true);
    expect(s.monthly.every(Number.isNaN)).toBe(true);
    expect(analyze(s)).toBeNull();
  });
  it('one non-zero year keeps the cell, zeros stay zeros', () => {
    const s = parsePowerResponse(resp('FRSNO', years45((k) => (k === 7 ? 0.03 : 0))), 'FRSNO', snow);
    expect(s.annual[7]).toBe(3);
    expect(s.annual[0]).toBe(0);
    expect(analyze(s)).not.toBeNull();
  });
  it('without rules an all-zero series is an ordinary series (dry desert precipitation)', () => {
    const s = parsePowerResponse(resp('PRECTOTCORR', years45(() => 0)), 'PRECTOTCORR');
    expect(s.annual.every((v) => v === 0)).toBe(true);
  });
  it('neverPresent', () => {
    expect(neverPresent([0, 0, NaN])).toBe(true);
    expect(neverPresent([NaN, NaN])).toBe(false);
    expect(neverPresent([0, 0.01])).toBe(false);
  });
});

describe('area means with missing cells', () => {
  const rules = rulesFromMeta({ display_scale: 1, zero_means_absent: false });
  const region = (cellsAnnual: number[][]) =>
    parseRegionalResponse(
      {
        header: { fill_value: -999 },
        parameters: { EVLAND: { units: 'mm/day' } },
        features: cellsAnnual.map((a, k) => ({ geometry: { coordinates: [10 + k, 5] }, properties: resp('EVLAND', a).properties })),
      },
      'EVLAND',
      rules,
    );
  it('every cell missing -> all NaN series (the panel then says no data)', () => {
    const m = areaMeanSeries(region([years45(() => NaN), years45(() => NaN)]));
    expect(m.cells).toHaveLength(0);
    expect(m.series.annual.every(Number.isNaN)).toBe(true);
    expect(analyze(m.series)).toBeNull();
  });
  it('cells without data are dropped, the others averaged', () => {
    const m = areaMeanSeries(region([years45(() => NaN), years45((k) => 1 + k * 0.01)]));
    expect(m.cells).toHaveLength(1);
    expect(m.series.annual[0]).toBeCloseTo(1, 12);
  });
  it('countryMeanSeries: every cell missing -> NaN series, nUsed 0', () => {
    const r = countryMeanSeries([[0, 0], [1, 1]], [years45(() => NaN), years45(() => NaN)]);
    expect(r.nUsed).toBe(0);
    expect(r.annual.every(Number.isNaN)).toBe(true);
  });
});

describe('Int16 with offset and missing', () => {
  it('parseInt16Series adds the offset back and maps -32768 to NaN', () => {
    const raw = new Int16Array([-7152, 0, 10707, -32768]);
    const rows = parseInt16Series(raw.buffer as ArrayBuffer, 2, 300);
    expect(rows[0][0]).toBeCloseTo(228.48, 9);
    expect(rows[0][1]).toBeCloseTo(300, 9);
    expect(rows[1][0]).toBeCloseTo(407.07, 9);
    expect(rows[1][1]).toBeNaN();
    expect(parseInt16Series(new Int16Array([1234]).buffer as ArrayBuffer, 1)[0][0]).toBeCloseTo(12.34, 12);
  });
  it('computeChunk: offset is added, a missing cell has no trend, offset does not change the slope', () => {
    const years = Array.from({ length: 12 }, (_, k) => 2000 + k);
    const nc = 3;
    const chunk = new Int16Array(12 * nc);
    for (let k = 0; k < 12; k++) {
      chunk[k * nc + 0] = 100 * k - 500; // +1 unit / year
      chunk[k * nc + 1] = -32768;
      chunk[k * nc + 2] = 100 * k - 500;
    }
    const a = computeChunk(chunk, years, nc, 0.01, undefined, 300);
    const b = computeChunk(chunk, years, nc, 0.01, undefined, 0);
    expect(a.slope[0]).toBeCloseTo(10, 9);
    expect(a.slope[0]).toBeCloseTo(b.slope[0], 9);
    expect(a.slope[1]).toBeNaN();
    expect(a.p[1]).toBeNaN();
  });
  it('bilinear: no data keeps its edge and is not smeared', () => {
    const meta = { nlat: 4, nlon: 4, lat0: -90, dlat: 60, lon0: -180, dlon: 90 };
    const g = new Float64Array(16).fill(5);
    g[5] = NaN;
    const out = bilinearToPixels(g, meta, 8, 4);
    expect(out.some(Number.isNaN)).toBe(true);
    expect(out.every((v) => Number.isNaN(v) || Math.abs(v - 5) < 1e-9)).toBe(true);
  });
});

import { surfaceMessage } from './noData';
describe('surfaceMessage (no files are fetched for these pieces)', () => {
  it('land-only variable: a sea piece is no data, a country is not', () => {
    expect(surfaceMessage('Soil moisture', 'land', true)).toBe('Soil moisture is only defined over land.');
    expect(surfaceMessage('Soil moisture', 'land', false)).toBeNull();
  });
  it('sea-only variable: a country piece is no data, a sea is not', () => {
    expect(surfaceMessage('Sea ice', 'sea', false)).toBe('Sea ice is only defined over the sea.');
    expect(surfaceMessage('Sea ice', 'sea', true)).toBeNull();
  });
  it('any / missing surface always has pieces', () => {
    expect(surfaceMessage('Air temperature', 'any', true)).toBeNull();
    expect(surfaceMessage('Air temperature', undefined, false)).toBeNull();
  });
});
