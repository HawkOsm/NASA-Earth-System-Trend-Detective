import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/regional_2deg_istanbul_T2M.json';
import { parseRegionalResponse } from './power';
import { areaMeanSeries, boxOutline, regionBox, type RegionCell, type RegionData } from './region';
import { trend } from '../stats/trend';

describe('regionBox', () => {
  it('is centred on the point with the requested size', () => {
    expect(regionBox(41.01, 28.97, 2)).toEqual({ latMin: 40.01, latMax: 42.01, lngMin: 27.97, lngMax: 29.97 });
    expect(regionBox(0, 0, 10)).toEqual({ latMin: -5, latMax: 5, lngMin: -5, lngMax: 5 });
  });
  it('shifts at the north pole', () => {
    expect(regionBox(89.5, 10, 5)).toEqual({ latMin: 85, latMax: 90, lngMin: 7.5, lngMax: 12.5 });
  });
  it('shifts at the south pole', () => {
    expect(regionBox(-90, 10, 10)).toEqual({ latMin: -90, latMax: -80, lngMin: 5, lngMax: 15 });
  });
  it('shifts at +180 and -180', () => {
    expect(regionBox(0, 179.9, 5)).toEqual({ latMin: -2.5, latMax: 2.5, lngMin: 175, lngMax: 180 });
    expect(regionBox(0, -180, 10)).toEqual({ latMin: -5, latMax: 5, lngMin: -180, lngMax: -170 });
  });
  it('preserves size and rounds to 3 decimals', () => {
    for (const [lat, lng, s] of [[89.9, 179.9, 5], [-89.99, -179.99, 2], [12.3456789, 98.7654321, 10]] as const) {
      const b = regionBox(lat, lng, s);
      expect(b.latMax - b.latMin).toBeCloseTo(s, 9);
      expect(b.lngMax - b.lngMin).toBeCloseTo(s, 9);
      for (const v of Object.values(b)) expect(Math.abs(v * 1000 - Math.round(v * 1000))).toBeLessThan(1e-6);
    }
    expect(regionBox(12.3456789, 98.7654321, 2)).toEqual({ latMin: 11.346, latMax: 13.346, lngMin: 97.765, lngMax: 99.765 });
  });
});

describe('boxOutline', () => {
  it('is a closed ring with points about every 0.5 degrees', () => {
    const o = boxOutline({ latMin: 0, latMax: 2, lngMin: 10, lngMax: 12 });
    expect(o[0]).toEqual(o[o.length - 1]);
    expect(o.length).toBe(4 * 4 + 1);
  });
});

describe('parseRegionalResponse (2 degree box around Istanbul)', () => {
  const r = parseRegionalResponse(fixture, 'T2M');
  const f0 = (fixture as any).features[0];
  it('has 15 cells, 45 years and units C', () => {
    expect(r.cells.length).toBe(15);
    expect(r.years.length).toBe(45);
    expect(r.years[0]).toBe(1981);
    expect(r.units).toBe('C');
    expect(r.cells[0].annual.length).toBe(45);
    expect(r.cells[0].monthly.length).toBe(540);
  });
  it('reads coordinates and values', () => {
    expect(r.cells[0].lng).toBe(f0.geometry.coordinates[0]);
    expect(r.cells[0].lat).toBe(f0.geometry.coordinates[1]);
    expect(r.cells[0].monthly[0]).toBe(f0.properties.parameter.T2M['198101']);
  });
  it('area mean of 1981 is the cos-weighted mean of the 15 annual values', () => {
    const { series, cells } = areaMeanSeries(r);
    expect(cells.length).toBe(15);
    let s = 0;
    let w = 0;
    for (const f of (fixture as any).features) {
      const wt = Math.cos((f.geometry.coordinates[1] * Math.PI) / 180);
      s += wt * f.properties.parameter.T2M['198113'];
      w += wt;
    }
    expect(Math.abs(series.annual[0] - s / w)).toBeLessThan(1e-12);
    const t = trend(series.annual, series.years);
    expect(Number.isFinite(t.slope)).toBe(true);
    expect(t.slope).toBeGreaterThan(0);
    expect(t.p).toBeLessThan(0.001);
  });
});

const mk = (lat: number, ann: number[], monthly?: number[]): RegionCell => ({
  lat,
  lng: 0,
  annual: ann,
  monthly: monthly ?? ann.flatMap((a) => new Array<number>(12).fill(a)),
});
const data = (cells: RegionCell[]): RegionData => ({
  years: [2000, 2001],
  monthlyT: Array.from({ length: 24 }, (_, k) => 2000 + (k + 0.5) / 12),
  units: 'C',
  cells,
});

describe('areaMeanSeries', () => {
  it('equal latitudes give the plain mean', () => {
    const { series } = areaMeanSeries(data([mk(10, [1, 3]), mk(10, [3, 5])]));
    expect(series.annual[0]).toBeCloseTo(2, 12);
    expect(series.annual[1]).toBeCloseTo(4, 12);
    expect(series.monthly[0]).toBeCloseTo(2, 12);
  });
  it('different latitudes give the cos-weighted mean', () => {
    const w0 = Math.cos(0);
    const w60 = Math.cos(Math.PI / 3); // 0.5
    const { series } = areaMeanSeries(data([mk(0, [10, 20]), mk(60, [40, 50])]));
    expect(series.annual[0]).toBeCloseTo((w0 * 10 + w60 * 40) / (w0 + w60), 12);
    expect(series.annual[0]).toBeCloseTo(20, 12);
    expect(series.annual[1]).toBeCloseTo(30, 12);
  });
  it('drops a cell with a fill annual value entirely', () => {
    const { series, cells } = areaMeanSeries(data([mk(0, [1, 1]), mk(0, [9, NaN])]));
    expect(cells.length).toBe(1);
    expect(series.annual).toEqual([1, 1]);
    expect(series.monthly[0]).toBe(1);
  });
  it('skips a fill month for that month only', () => {
    const m = new Array<number>(24).fill(5);
    m[3] = NaN;
    const { series, cells } = areaMeanSeries(data([mk(0, [1, 1], new Array<number>(24).fill(1)), mk(0, [5, 5], m)]));
    expect(cells.length).toBe(2);
    expect(series.monthly[3]).toBe(1);
    expect(series.monthly[4]).toBe(3);
    expect(series.annual[0]).toBe(3);
  });
});
