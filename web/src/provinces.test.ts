import { describe, expect, it } from 'vitest';
import { countryMeanSeries, frameRing, provinceHeading, provinceTrend, sortProvinces, type ProvinceRec } from './country';

const years = Array.from({ length: 20 }, (_, i) => 2000 + i);
const prov = (cells: number[]): ProvinceRec => ({ name: 'P', type: 'Province', centre: [0, 0], rings: [], cells });

describe('province mean', () => {
  it('equals the hand-computed cos(latitude)-weighted mean of its cells', () => {
    // three country cells; the province holds cells 0 and 2
    const cells: [number, number][] = [[0, 10], [60, 10], [60, 11]];
    const values = [years.map((_, y) => y), years.map(() => 100), years.map((_, y) => 3 * y)];
    const pv = prov([0, 2]);
    const w0 = Math.cos(0);
    const w2 = Math.cos((60 * Math.PI) / 180); // 0.5
    const expected = years.map((_, y) => (w0 * y + w2 * 3 * y) / (w0 + w2));
    const { annual, nUsed } = countryMeanSeries([cells[0], cells[2]], [values[0], values[2]]);
    expect(nUsed).toBe(2);
    annual.forEach((v, y) => expect(v).toBeCloseTo(expected[y], 12));
    const t = provinceTrend(pv, cells, values, years, [2000, 2019]);
    // the weighted series is exactly linear with slope (1 + 3 * 0.5) / 1.5 = 5/3 per year -> 16.667 per decade
    expect(t.slopeDecade).toBeCloseTo(50 / 3, 9);
    expect(t.nCells).toBe(2);
    expect(t.nUsed).toBe(2);
  });

  it('gives no trend when no cell has a full series', () => {
    const cells: [number, number][] = [[0, 0]];
    const t = provinceTrend(prov([0]), cells, [years.map((_, y) => (y === 3 ? NaN : y))], years, [2000, 2019]);
    expect(t.slopeDecade).toBeNull();
    expect(t.p).toBeNull();
  });
});

describe('province list', () => {
  it('sorts largest rise first, no data last', () => {
    const l = sortProvinces([
      { name: 'b', slopeDecade: 0.1 },
      { name: 'none', slopeDecade: null },
      { name: 'a', slopeDecade: 0.4 },
      { name: 'c', slopeDecade: -0.2 },
    ]);
    expect(l.map((x) => x.name)).toEqual(['a', 'b', 'c', 'none']);
  });
  it('chooses the heading from the most common type', () => {
    expect(provinceHeading(['Province', 'Province', 'District'])).toBe('Provinces');
    expect(provinceHeading(['State', 'State', 'Federal District'])).toBe('States');
    expect(provinceHeading(['County', 'County'])).toBe('Counties');
    expect(provinceHeading(['', ''])).toBe('Regions');
    expect(provinceHeading([])).toBe('Regions');
  });
});

describe('frameRing', () => {
  it('moves a ring into the frame of a wrapping country', () => {
    const r: [number, number][] = [[-175, 65], [-170, 65], [-170, 68], [-175, 65]];
    expect(frameRing(r, 170)[0][0]).toBe(185);
    expect(frameRing(r, -170)[0][0]).toBe(-175);
    expect(frameRing(r, null)).toBe(r);
  });
});
