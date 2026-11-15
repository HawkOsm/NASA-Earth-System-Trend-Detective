import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/power_istanbul_T2M.json';
import { monthlyAnomalies, parsePowerResponse, snapToCell } from './power';
import { trend } from '../stats/trend';
import type { GridMeta } from '../data/data';

const GRID: GridMeta = { nlat: 361, nlon: 576, lat0: -90, dlat: 0.5, lon0: -180, dlon: 0.625 };

describe('snapToCell', () => {
  it('snaps Istanbul to its cell centre', () => {
    const c = snapToCell(41.01, 28.97, GRID);
    expect(c).toEqual({ lat: 41, lng: 28.75, i: 262, j: 334 });
  });
  it('clamps the poles', () => {
    expect(snapToCell(90.4, 0, GRID).i).toBe(360);
    expect(snapToCell(-95, 0, GRID).i).toBe(0);
  });
  it('wraps longitude past the last cell centre', () => {
    const c = snapToCell(0, 179.9, GRID);
    expect(c.j).toBe(0);
    expect(c.lng).toBe(-180);
    expect(snapToCell(0, -179.99, GRID).j).toBe(0);
    expect(snapToCell(0, 179.375, GRID).j).toBe(575);
  });
});

describe('parsePowerResponse (Istanbul T2M)', () => {
  const s = parsePowerResponse(fixture, 'T2M');
  it('parses annual and monthly', () => {
    expect(s.years.length).toBe(45);
    expect(s.years[0]).toBe(1981);
    expect(s.annual.length).toBe(45);
    expect(s.annual[0]).toBe(14.14);
    expect(s.annual[44]).toBe(16.23);
    expect(s.monthly.length).toBe(540);
    expect(s.monthlyT.length).toBe(540);
    expect(s.monthly[0]).toBe(5.17);
    expect(s.monthlyT[0]).toBeCloseTo(1981 + 0.5 / 12, 12);
    expect(s.units).toBe('C');
  });
  it('matches the pipeline trend for this cell', () => {
    const r = trend(s.annual, s.years);
    expect(Math.round(r.slope * 10 * 1000) / 1000).toBe(0.538);
    expect(Math.round(r.ciLow * 10 * 1000) / 1000).toBe(0.425);
    expect(Math.round(r.ciHigh * 10 * 1000) / 1000).toBe(0.651);
    expect(r.p).toBeLessThan(1e-8);
  });
  it('maps fill values to NaN', () => {
    const f = JSON.parse(JSON.stringify(fixture));
    f.properties.parameter.T2M['198101'] = -999.0;
    expect(parsePowerResponse(f, 'T2M').monthly[0]).toBeNaN();
  });
  it('throws a readable error for a missing parameter', () => {
    expect(() => parsePowerResponse(fixture, 'WS2M')).toThrow(/no data for WS2M/);
    expect(() => parsePowerResponse(null, 'T2M')).toThrow(/no data/);
  });
});

describe('monthlyAnomalies', () => {
  it('is NaN-safe and zero-mean per month', () => {
    const m: number[] = [];
    for (let y = 0; y < 5; y++) for (let k = 0; k < 12; k++) m.push(k * 10 + y);
    m[13] = NaN;
    const a = monthlyAnomalies(m);
    expect(a[13]).toBeNaN();
    for (let k = 0; k < 12; k++) {
      const vals = a.filter((_, idx) => idx % 12 === k && !Number.isNaN(a[idx]));
      expect(Math.abs(vals.reduce((x, y) => x + y, 0))).toBeLessThan(1e-9);
    }
    expect(a[0]).toBeCloseTo(-2, 12);
  });
});
