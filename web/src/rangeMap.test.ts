import { describe, expect, it } from 'vitest';
import { trend } from './stats/trend';
import {
  bhAdjust,
  bilinearAt,
  bilinearToPixels,
  colorizeWeighted,
  computeCells,
  extractChunk,
  finishResult,
  fracSignificant,
  hexToRgb,
  interpStops,
  nearestCell,
  parseAnnualBin,
  percentile,
  roundUp2Sig,
  symmetricVmax,
  valueAtResult,
  type AnnualMeta,
} from './rangeMap';

describe('bhAdjust', () => {
  it('matches a hand-computed example', () => {
    // sorted p: .005 .01 .03 .04 -> p*m/rank = .02 .02 .04 .04 -> running min from the end -> .02 .02 .04 .04
    const q = bhAdjust([0.01, 0.04, 0.03, 0.005]);
    expect(Array.from(q).map((v) => +v.toFixed(12))).toEqual([0.02, 0.04, 0.04, 0.02]);
  });
  it('enforces monotonicity, caps at 1 and leaves NaN alone', () => {
    // p*m/rank = .04*3/1=.12, .03*3/2=.045, .9*3/3=.9 -> cummin from end: .12,.045,.9 -> min from end: .045? check
    const q = bhAdjust([0.04, 0.03, 0.9, NaN]);
    expect(Number.isNaN(q[3])).toBe(true);
    // finite sorted: .03 (r1), .04 (r2), .9 (r3), m = 3 -> .09, .06, .9 -> cummin from end: .06, .06, .9
    expect(q[1]).toBeCloseTo(0.06, 12);
    expect(q[0]).toBeCloseTo(0.06, 12);
    expect(q[2]).toBeCloseTo(0.9, 12);
    const big = bhAdjust([0.9, 0.95, 0.99]);
    big.forEach((v) => expect(v).toBeLessThanOrEqual(1));
  });
  it('is monotone in p on random input and never below p', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const p = Array.from({ length: 500 }, () => rnd() ** 2);
    const q = bhAdjust(p);
    const order = p.map((_, i) => i).sort((a, b) => p[a] - p[b]);
    for (let k = 1; k < order.length; k++) expect(q[order[k]]).toBeGreaterThanOrEqual(q[order[k - 1]] - 1e-15);
    p.forEach((v, i) => {
      expect(q[i]).toBeGreaterThanOrEqual(v - 1e-15);
      expect(q[i]).toBeLessThanOrEqual(1);
    });
  });
});

describe('vmax rounding (round up to 2 significant figures)', () => {
  it('matches the pipeline rule', () => {
    expect(roundUp2Sig(0.7351)).toBe(0.74);
    expect(roundUp2Sig(0.1001)).toBe(0.11);
    expect(roundUp2Sig(12.01)).toBe(13);
    expect(roundUp2Sig(0.74)).toBe(0.74);
    expect(roundUp2Sig(1)).toBe(1);
    expect(roundUp2Sig(0.0432)).toBe(0.044);
    expect(roundUp2Sig(0)).toBe(1);
    expect(roundUp2Sig(NaN)).toBe(1);
  });
  it('percentile is linear like numpy, and vmax uses |slope|', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([1, 2, 3, 4, 5], 98)).toBeCloseTo(4.92, 12);
    const slope = [-0.5, 0.2, NaN, 0.1, -0.05];
    expect(symmetricVmax(slope)).toBe(roundUp2Sig(percentile([0.5, 0.2, 0.1, 0.05], 98)));
  });
});

describe('colour interpolation', () => {
  const hex = ['#000000', '#0a0a0a', '#141414', '#1e1e1e', '#282828', '#323232', '#3c3c3c', '#464646', '#505050', '#5a5a5a', '#ff0000'];
  const stops = hex.map(hexToRgb);
  it('hits the stops exactly at k/10', () => {
    for (let k = 0; k <= 10; k++) {
      const c = interpStops(stops, k / 10);
      c.forEach((v, i) => expect(v).toBeCloseTo(stops[k][i], 12));
    }
  });
  it('interpolates linearly between stops and clamps', () => {
    const c = interpStops(stops, 0.95); // halfway between stop 9 and 10
    expect(c[0]).toBeCloseTo((stops[9][0] + stops[10][0]) / 2, 12);
    expect(c[1]).toBeCloseTo((stops[9][1] + stops[10][1]) / 2, 12);
    expect(interpStops(stops, -3)).toEqual(stops[0]);
    expect(interpStops(stops, 7)).toEqual(stops[10]);
  });
  it('colorizeWeighted: significant keeps colour, non-significant is paler, NaN is grey', () => {
    const rd = ['#2166ac', '#4393c3', '#92c5de', '#d1e5f0', '#f7f7f7', '#f7f7f7', '#fddbc7', '#f4a582', '#d6604d', '#b2182b', '#67001f'];
    const out = colorizeWeighted([1, 1, NaN], [1, 0, 1], 1, rd);
    expect(Array.from(out.slice(0, 4))).toEqual([103, 0, 31, 255]); // x = 1 -> last stop, w = 1: full colour
    const pale = Array.from(out.slice(4, 7));
    expect(pale[1]).toBeGreaterThan(40); // the zero green channel is lifted towards grey
    expect(Array.from(out.slice(8, 12))).toEqual([128, 128, 128, 255]);
    // w = 0 and a mid-grey-ish stop: unchanged luminance blend formula
    const lum = 0.2126 * (103 / 255) + 0.7152 * 0 + 0.0722 * (31 / 255);
    const grey = 0.6 * lum + 0.4 * 0.82;
    expect(pale[0]).toBe(Math.round(255 * (0.25 * (103 / 255) + 0.75 * grey)));
  });
});

const tiny = { nlat: 3, nlon: 4, lat0: -90, dlat: 90, lon0: -180, dlon: 90 };

describe('bilinear sampling', () => {
  // rows (lat -90, 0, 90), columns lon -180, -90, 0, 90
  const grid = [0, 10, 20, 30, 100, 110, 120, 130, 200, 210, 220, 230];
  it('returns grid values at grid points', () => {
    expect(bilinearAt(grid, tiny, 0, -90)).toBe(110);
    expect(bilinearAt(grid, tiny, 90, 90)).toBe(230);
  });
  it('wraps longitude', () => {
    // lng 135 lies between column 3 (lon 90 -> 30) and column 0 (lon 180 -> 0), a third of the way
    expect(bilinearAt(grid, tiny, -90, 135)).toBeCloseTo(15, 12);
    expect(bilinearAt(grid, tiny, -90, 135 - 360)).toBeCloseTo(15, 12);
    expect(bilinearAt(grid, tiny, -90, 180)).toBeCloseTo(0, 12);
  });
  it('interpolates in both directions and clamps latitude', () => {
    expect(bilinearAt(grid, tiny, -45, -135)).toBeCloseTo(55, 12);
    expect(bilinearAt(grid, tiny, 120, -180)).toBe(200);
    expect(bilinearAt(grid, tiny, -120, -180)).toBe(0);
  });
  it('bilinearToPixels uses pixel centres (row 0 = north, column 0 starts at -180)', () => {
    const px = bilinearToPixels(grid, tiny, 8, 4);
    expect(px.length).toBe(32);
    // pixel (x=0,y=0): lng -157.5, lat 67.5
    expect(px[0]).toBeCloseTo(bilinearAt(grid, tiny, 67.5, -157.5), 12);
    // pixel (x=7, y=3): lng 157.5, lat -67.5 (wraps between column 3 and column 0)
    expect(px[3 * 8 + 7]).toBeCloseTo(bilinearAt(grid, tiny, -67.5, 157.5), 12);
  });
});

describe('annual .bin parsing', () => {
  const meta: AnnualMeta = { nlat: 2, nlon: 3, lat0: -90, dlat: 180, lon0: -180, dlon: 120, years: [1981, 1982], scale: 0.01, units: 'C' };
  it('reads little-endian Int16 in [year][lat][lon] order', () => {
    const vals = [1, -2, 300, 32767, -32768, 0, 12, 13, 14, -15, -16, -17];
    const buf = new ArrayBuffer(24);
    const dv = new DataView(buf);
    vals.forEach((v, i) => dv.setInt16(2 * i, v, true));
    const out = parseAnnualBin(buf, meta);
    expect(Array.from(out)).toEqual(vals);
    // year 1982, lat index 1, lon index 2 = 12th value
    expect(out[1 * 6 + 1 * 3 + 2]).toBe(-17);
  });
  it('rejects a wrongly sized buffer', () => {
    expect(() => parseAnnualBin(new ArrayBuffer(10), meta)).toThrow();
  });
});

describe('per-cell computation on a synthetic grid', () => {
  const meta: AnnualMeta = { nlat: 3, nlon: 4, lat0: -90, dlat: 90, lon0: -180, dlon: 90, years: [1981, 2025], scale: 0.01, units: 'C' };
  const ny = 45;
  const ncells = 12;
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const data = new Int16Array(ny * ncells);
  for (let k = 0; k < ny; k++) {
    for (let c = 0; c < ncells; c++) {
      // different trend per cell, noise, and a few repeated values (ties)
      data[k * ncells + c] = Math.round(1000 + (c - 5) * 3 * k + 150 * (rnd() - 0.5)) - (c === 3 ? (k % 3) * 0 : 0);
    }
  }
  for (let k = 0; k < ny; k++) data[k * ncells + 7] = 500 + (k % 4); // constant-ish cell with ties

  it('each cell equals trend() on the sliced series', () => {
    for (const [s, e] of [[1995, 2015], [1981, 2025], [2010, 2019]] as const) {
      const res = computeCells(data, meta, s, e);
      const years: number[] = [];
      for (let y = s; y <= e; y++) years.push(y);
      for (let c = 0; c < ncells; c++) {
        const y: number[] = [];
        for (let yr = s; yr <= e; yr++) y.push(data[(yr - 1981) * ncells + c] * 0.01);
        const r = trend(y, years);
        expect(res.slope[c]).toBe(r.slope * 10);
        expect(res.p[c]).toBe(r.p);
      }
    }
  });

  it('chunked computation equals whole-grid computation', () => {
    const whole = computeCells(data, meta, 1990, 2012);
    const years: number[] = [];
    for (let y = 1990; y <= 2012; y++) years.push(y);
    const a = computeCellsChunk(0, 5);
    const b = computeCellsChunk(5, 12);
    function computeCellsChunk(c0: number, c1: number) {
      return computeCellsViaChunk(c0, c1);
    }
    function computeCellsViaChunk(c0: number, c1: number) {
      const chunk = extractChunk(data, ncells, 1990 - 1981, 2012 - 1981, c0, c1);
      expect(chunk.length).toBe(years.length * (c1 - c0));
      return computeCellsFromChunk(chunk, c1 - c0);
    }
    function computeCellsFromChunk(chunk: Int16Array, nc: number) {
      const slope: number[] = [];
      const p: number[] = [];
      for (let c = 0; c < nc; c++) {
        const y = years.map((_, k) => chunk[k * nc + c] * 0.01);
        const r = trend(y, years);
        slope.push(r.slope * 10);
        p.push(r.p);
      }
      return { slope, p };
    }
    expect([...a.slope, ...b.slope]).toEqual(Array.from(whole.slope));
    expect([...a.p, ...b.p]).toEqual(Array.from(whole.p));
  });

  it('finishResult: q, vmax, significance share, texture and valueAt are consistent', () => {
    const stats = computeCells(data, meta, 1995, 2015);
    const stops = ['#000000', '#101010', '#202020', '#303030', '#404040', '#505050', '#606060', '#707070', '#808080', '#909090', '#ffffff'];
    const r = finishResult('T2M', 1995, 2015, meta, stats, stops);
    expect(r.q.length).toBe(ncells);
    expect(r.vmax).toBe(symmetricVmax(stats.slope));
    expect(r.rgba.length).toBe(1440 * 720 * 4);
    expect(r.fracSignificant).toBeCloseTo(fracSignificant(r.q, stats.slope, meta), 12);
    const v = valueAtResult(r, 0.2, -88); // nearest cell: lat index 1, lon index 1
    expect(v).toMatchObject({ lat: 0, lng: -90, n: 21 });
    expect(v.slopeDecade).toBe(stats.slope[1 * 4 + 1]);
    expect(v.q).toBe(r.q[1 * 4 + 1]);
    expect(nearestCell(meta, 0, 178)).toEqual({ i: 1, j: 0 }); // wraps to lon -180
  });
});
