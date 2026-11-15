import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/regional_2deg_istanbul_T2M.json';
import { parseRegionalResponse } from './power';
import { filterToPeriod } from '../menu/period';
import { trend } from '../stats/trend';
import type { RegionCell } from './region';
import {
  areaChangeAltitude,
  cellRect,
  cellRgb,
  cellTrends,
  degreeTicks,
  hitCell,
  isSignificant,
  landInBox,
  makeProjection,
  parseStops,
  pickAltitude,
  projX,
  projY,
  summarize,
  targetAltitude,
  toLandPolygons,
} from './detail';

const years = Array.from({ length: 20 }, (_, k) => 2000 + k);
const rising = years.map((y, k) => 10 + 0.05 * (y - 2000) + 0.01 * Math.sin(k));
const noisy = years.map((_, k) => 10 + ((k * 7919) % 13) * 0.1 * (k % 2 ? 1 : -1));
const cellsSynthetic: RegionCell[] = [
  { lat: 10, lng: 20, annual: rising, monthly: [] },
  { lat: 10.5, lng: 20, annual: noisy, monthly: [] },
  { lat: 11, lng: 20, annual: years.map((y) => (y < 2012 ? NaN : 11)), monthly: [] },
];

describe('cellTrends', () => {
  it('equals trend() on the sliced series, slope per decade', () => {
    const per: [number, number] = [2003, 2018];
    const out = cellTrends(cellsSynthetic, years, per);
    for (const k of [0, 1]) {
      const { years: ys, values } = filterToPeriod(years, cellsSynthetic[k].annual, per);
      const r = trend(values, ys);
      expect(out[k].slopeDecade).toBe(r.slope * 10);
      expect(out[k].p).toBe(r.p);
      expect(out[k].n).toBe(16);
    }
  });
  it('filters by period', () => {
    const full = cellTrends(cellsSynthetic, years, [2000, 2019]);
    const part = cellTrends(cellsSynthetic, years, [2000, 2009]);
    expect(full[0].n).toBe(20);
    expect(part[0].n).toBe(10);
    expect(part[0].slopeDecade).not.toBe(full[0].slopeDecade);
  });
  it('marks cells with fewer than 10 valid years as no data', () => {
    const out = cellTrends(cellsSynthetic, years, [2000, 2019]);
    expect(out[2]).toEqual({ lat: 11, lng: 20, slopeDecade: null, p: null, n: 8 });
    const short = cellTrends(cellsSynthetic, years, [2000, 2008]);
    expect(short.every((c) => c.slopeDecade === null)).toBe(true);
  });
});

describe('summarize', () => {
  it('counts significant cells and finds min/max', () => {
    const cells = [
      { lat: 0, lng: 0, slopeDecade: 0.31, p: 0.001, n: 30 },
      { lat: 0, lng: 1, slopeDecade: 0.62, p: 0.04, n: 30 },
      { lat: 0, lng: 2, slopeDecade: 0.4, p: 0.2, n: 30 },
      { lat: 0, lng: 3, slopeDecade: null, p: null, n: 3 },
    ];
    expect(isSignificant(cells[2])).toBe(false);
    expect(summarize(cells)).toEqual({ nCells: 4, nWithData: 3, nSignificant: 2, min: 0.31, max: 0.62 });
    expect(summarize([cells[3]])).toEqual({ nCells: 1, nWithData: 0, nSignificant: 0, min: null, max: null });
  });
});

describe('projection', () => {
  const box = { latMin: 38, latMax: 43, lngMin: 26, lngMax: 31 };
  const pr = makeProjection(box, 300);
  it('maps box corners to canvas corners, north up, equal degrees scale', () => {
    expect(pr.height).toBeCloseTo(300);
    expect([projX(pr, 26), projY(pr, 43)]).toEqual([0, 0]);
    expect(projX(pr, 31)).toBeCloseTo(300);
    expect(projY(pr, 38)).toBeCloseTo(300);
    expect(projY(pr, 42)).toBeLessThan(projY(pr, 40));
    const wide = makeProjection({ latMin: 0, latMax: 2, lngMin: 0, lngMax: 4 }, 400);
    expect(wide.height).toBeCloseTo(200);
    expect(projX(wide, 1) - projX(wide, 0)).toBeCloseTo(projY(wide, 0) - projY(wide, 1));
  });
  it('cell rectangle is 0.625 x 0.5 degrees centred on the grid point', () => {
    const r = cellRect(pr, 40, 28.75);
    expect(r.w).toBeCloseTo(0.625 * pr.scale);
    expect(r.h).toBeCloseTo(0.5 * pr.scale);
    expect(r.x + r.w / 2).toBeCloseTo(projX(pr, 28.75));
    expect(r.y + r.h / 2).toBeCloseTo(projY(pr, 40));
  });
  it('hit-tests a canvas point back to its cell', () => {
    const cells = [
      { lat: 40, lng: 28.75 },
      { lat: 40.5, lng: 28.75 },
      { lat: 40, lng: 29.375 },
    ];
    for (let k = 0; k < cells.length; k++) {
      expect(hitCell(pr, cells, projX(pr, cells[k].lng) + 1, projY(pr, cells[k].lat) - 1)).toBe(k);
    }
    expect(hitCell(pr, cells, projX(pr, 27), projY(pr, 39))).toBe(-1);
  });
});

describe('colours and ticks', () => {
  const stops = parseStops(['#000000', '#ffffff', '#ff0000']);
  it('interpolates the colormap, clipping at +-vmax', () => {
    expect(cellRgb(0, 1, stops)).toEqual([255, 255, 255]);
    expect(cellRgb(-5, 1, stops)).toEqual([0, 0, 0]);
    expect(cellRgb(5, 1, stops)).toEqual([255, 0, 0]);
    expect(cellRgb(-0.5, 1, stops)).toEqual([128, 128, 128]);
  });
  it('gives whole-degree ticks', () => {
    expect(degreeTicks(38, 43)).toEqual([38, 39, 40, 41, 42, 43]);
    expect(degreeTicks(27.97, 29.97)).toEqual([28, 29]);
    expect(degreeTicks(-5, 5).length).toBeLessThanOrEqual(6);
  });
  it('picks land polygons that touch the box', () => {
    const polys = toLandPolygons([
      [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
      [[[50, 50], [51, 50], [51, 51], [50, 50]]],
    ]);
    expect(landInBox(polys, { latMin: -1, latMax: 2, lngMin: -1, lngMax: 2 })).toHaveLength(1);
  });
});

describe('camera altitude', () => {
  it('has the target altitude per area', () => {
    expect([0, 2, 5, 10].map(targetAltitude)).toEqual([0.7, 0.7, 0.9, 1.3]);
  });
  it('zooms in on pick, keeps a closer camera', () => {
    expect(pickAltitude(2.2, 0)).toBe(0.7);
    expect(pickAltitude(2.2, 10)).toBe(1.3);
    expect(pickAltitude(0.4, 5)).toBe(0.4);
    expect(pickAltitude(undefined, 5)).toBe(0.9);
  });
  it('zooms out when the area grows, otherwise follows the pick rule', () => {
    expect(areaChangeAltitude(0.7, 0, 10)).toBe(1.3);
    expect(areaChangeAltitude(0.7, 2, 5)).toBe(0.9);
    expect(areaChangeAltitude(1.5, 10, 0)).toBe(0.7);
    expect(areaChangeAltitude(0.5, 5, 2)).toBe(0.5);
    expect(areaChangeAltitude(2.2, 0, 10)).toBe(2.2);
  });
});

describe('Istanbul 2 degree fixture', () => {
  const data = parseRegionalResponse(fixture, 'T2M');
  it('has 15 cells whose slope equals 10 * trend(annual, years)', () => {
    expect(data.cells).toHaveLength(15);
    const out = cellTrends(data.cells, data.years, [data.years[0], data.years[data.years.length - 1]]);
    data.cells.forEach((c, k) => {
      const ys: number[] = [];
      const vs: number[] = [];
      c.annual.forEach((v, i) => {
        if (!Number.isNaN(v)) {
          ys.push(data.years[i]);
          vs.push(v);
        }
      });
      const r = trend(vs, ys);
      expect(out[k].lat).toBe(c.lat);
      expect(out[k].slopeDecade).toBe(10 * r.slope);
      expect(out[k].p).toBe(r.p);
    });
  });
});
