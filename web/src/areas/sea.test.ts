import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NLAT, NLON, countryMeanSeries, fitCountryProjection, hitCountryCell, parseInt16Series, cx, cy } from './country';
import {
  citiesInFrame,
  findSea,
  frameRect,
  landShifts,
  normaliseLand,
  parseSeaCells,
  pickSea,
  seaAsRec,
  seaAt,
  seaFrame,
  seaWrapRef,
  type SeaRec,
} from './sea';
import { toLandPolygons } from '../point/detail';
import { trend } from '../stats/trend';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = join(here, '..', '..', 'public', 'data');
const FIXTURE = join(here, '..', '..', '..', 'pipeline', 'tests', 'fixtures', 'sea_cases.json');

const ab = (name: string): ArrayBuffer => {
  const f = readFileSync(join(DATA, name));
  return f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer;
};
const mask = new Uint8Array(readFileSync(join(DATA, 'sea_mask.bin')));
const recs = JSON.parse(readFileSync(join(DATA, 'seas.json'), 'utf8')) as SeaRec[];
const byName = (n: string) => recs.find((r) => r.name === n)!;

describe('sea mask lookup (real sea_mask.bin)', () => {
  it('has the grid size and 118 records in feature order', () => {
    expect(mask.length).toBe(NLAT * NLON);
    expect(recs).toHaveLength(118);
    recs.forEach((r, k) => expect(r.idx).toBe(k));
  });
  it('finds the named seas', () => {
    expect(recs[seaAt(mask, 43, 34)!].name).toBe('Black Sea');
    expect(recs[seaAt(mask, 35, 18)!].name).toBe('Mediterranean Sea');
    expect(recs[seaAt(mask, 30, -170)!].name).toBe('North Pacific Ocean');
    expect(recs[seaAt(mask, 30, 170)!].name).toBe('North Pacific Ocean');
    expect(recs[seaAt(mask, 45.5, -4)!].name).toBe('Bay of Biscay');
  });
  it('land is no sea; longitude wraps', () => {
    expect(seaAt(mask, 39.93, 32.86)).toBeUndefined(); // Ankara
    expect(seaAt(mask, 30, 190)).toBe(seaAt(mask, 30, -170));
  });
  it('pickSea never returns a sea without cells', () => {
    expect(pickSea(mask, recs, 43, 34)?.name).toBe('Black Sea');
    expect(pickSea(mask, recs, 39.93, 32.86)).toBeUndefined();
    const fake = recs.map((r) => (r.name === 'Black Sea' ? { ...r, nCells: 0 } : r));
    expect(pickSea(mask, fake, 43, 34)).toBeUndefined();
    expect(findSea(fake, 'black sea')).toBeUndefined();
    expect(findSea(recs, 'black sea')?.idx).toBe(7);
    expect(findSea(recs, '7')?.idx).toBe(7);
    expect(findSea(recs, 'north pac')?.name).toBe('North Pacific Ocean');
  });
});

describe('cells.bin', () => {
  it('parses Float32 LE pairs, lat ascending then lng ascending', () => {
    const dv = new DataView(new ArrayBuffer(24));
    [[1.5, -2.25], [1.5, 3], [2, -180]].forEach(([a, b], k) => {
      dv.setFloat32(k * 8, a, true);
      dv.setFloat32(k * 8 + 4, b, true);
    });
    expect(parseSeaCells(dv.buffer)).toEqual([[1.5, -2.25], [1.5, 3], [2, -180]]);
  });
  it('the real Black Sea file matches the mask, the North Pacific uses the coarse grid', () => {
    const bs = byName('Black Sea');
    const cells = parseSeaCells(ab(`seas/${bs.idx}.cells.bin`));
    expect(cells).toHaveLength(bs.nCells);
    expect([bs.dlat, bs.dlng]).toEqual([0.5, 0.625]);
    for (let k = 1; k < cells.length; k++) {
      expect(cells[k][0] > cells[k - 1][0] || (cells[k][0] === cells[k - 1][0] && cells[k][1] > cells[k - 1][1])).toBe(true);
    }
    for (const [lat, lng] of cells) expect(seaAt(mask, lat, lng)).toBe(bs.idx);
    const np = byName('North Pacific Ocean');
    expect([np.dlat, np.dlng]).toEqual([1, 1.25]);
    const nc = parseSeaCells(ab(`seas/${np.idx}.cells.bin`));
    expect(nc).toHaveLength(np.nCells);
    for (const [lat, lng] of nc) {
      expect(Math.abs(lat - Math.round(lat))).toBe(0);
      expect(Math.abs((lng + 180) / 1.25 - Math.round((lng + 180) / 1.25))).toBeLessThan(1e-6);
      expect(seaAt(mask, lat, lng)).toBe(np.idx); // coarse membership = the full-resolution mask at that point
    }
  });
});

describe('pipeline fixture vs the real data files', () => {
  const fx = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
    years: number[];
    cases: {
      variable: string; idx: number; name: string; nCells: number; nCellsUsed: number; series: number[];
      trend: { slopeDecade: number; ciLowDecade: number; ciHighDecade: number; p: number } | null;
    }[];
  };
  it('has 4 seas x 3 variables', () => {
    expect(fx.cases).toHaveLength(12);
    expect(new Set(fx.cases.map((c) => c.name))).toEqual(new Set(['Black Sea', 'Mediterranean Sea', 'North Pacific Ocean', 'Southern Ocean']));
  });
  for (const c of fx.cases) {
    it(`${c.name} ${c.variable}: mean series to 1e-9 and trend() slope / CI / p to 1e-9`, () => {
      const rec = recs[c.idx];
      expect(rec.name).toBe(c.name);
      expect(rec.nCells).toBe(c.nCells);
      const cells = parseSeaCells(ab(`seas/${c.idx}.cells.bin`));
      const buf = ab(`seas/${c.variable}/${c.idx}.bin`);
      expect(buf.byteLength).toBe(c.nCells * 45 * 2);
      const { annual, nUsed } = countryMeanSeries(cells, parseInt16Series(buf, 45));
      expect(nUsed).toBe(c.nCellsUsed);
      annual.forEach((v, k) => expect(Math.abs(v - c.series[k])).toBeLessThan(1e-9));
      const r = trend(annual, fx.years);
      expect(c.trend).not.toBeNull();
      expect(Math.abs(r.slope * 10 - c.trend!.slopeDecade)).toBeLessThan(1e-9);
      expect(Math.abs(r.ciLow * 10 - c.trend!.ciLowDecade)).toBeLessThan(1e-9);
      expect(Math.abs(r.ciHigh * 10 - c.trend!.ciHighDecade)).toBeLessThan(1e-9);
      expect(Math.abs(r.p - c.trend!.p)).toBeLessThan(1e-9);
    });
  }
});

describe('frame and fit', () => {
  it('is the bbox of the cell centres plus 8% (at least 1 degree) on every side', () => {
    const f = seaFrame({ bbox: [41, 47, 28.125, 41.25] });
    expect(f.latMin).toBeCloseTo(40, 9); // 8% of 6 = 0.48 < 1 degree
    expect(f.latMax).toBeCloseTo(48, 9);
    expect(f.lngMin).toBeCloseTo(28.125 - 1.05, 9); // 8% of 13.125 = 1.05
    expect(f.lngMax).toBeCloseTo(41.25 + 1.05, 9);
    const g = seaFrame({ bbox: [0, 58, 130, 282.5] });
    expect(g.latMin).toBe(-4.64);
    expect(g.lngMax).toBeCloseTo(282.5 + 12.2, 9);
    expect(seaFrame({ bbox: [-89.5, -72, 0, 10] }).latMin).toBe(-90); // clamped at the pole
  });
  it('a wrapping sea has one continuous frame, past 180', () => {
    const bering = byName('Bering Sea');
    expect(bering.wraps).toBe(true);
    const f = seaFrame(bering);
    expect(f.lngMax).toBeGreaterThan(180);
    expect(seaWrapRef(bering)).toBeCloseTo(0.5 * (bering.bbox[2] + bering.bbox[3]), 9);
    expect(seaWrapRef(byName('Black Sea'))).toBeNull();
  });
  it('fits through the country projection as a rectangle', () => {
    const f = seaFrame(byName('Black Sea'));
    const pr = fitCountryProjection(frameRect(f), 800, 600);
    expect(pr.lngSpan).toBeCloseTo(f.lngMax - f.lngMin, 9);
    expect(pr.latSpan).toBeCloseTo(f.latMax - f.latMin, 9);
    expect(cx(pr, f.lngMin)).toBeCloseTo(pr.offX, 9);
    expect(cy(pr, f.latMax)).toBeCloseTo(pr.offY, 9);
    expect(pr.width).toBe(800);
    expect(pr.height).toBeLessThanOrEqual(600);
  });
  it('seaAsRec carries the sea and its cell size', () => {
    const r = seaAsRec(byName('North Pacific Ocean'));
    expect(r.sea).toEqual({ kind: 'ocean', dlat: 1, dlng: 1.25 });
    expect(r.tiny).toBe(false);
    expect(r.wraps).toBe(true);
  });
});

describe('hit test with the sea cell size', () => {
  it('uses the coarse half-cell (0.5 x 0.625) for an ocean', () => {
    const f = { latMin: 0, latMax: 10, lngMin: 0, lngMax: 10 };
    const pr = fitCountryProjection(frameRect(f), 500, 500, 0);
    const cells = [{ lat: 5, lng: 5 }];
    const lng = 5 + 0.6; // inside a coarse cell (half width 0.625), outside a full-resolution one (0.3125)
    const x = cx(pr, lng);
    const y = cy(pr, 5);
    expect(hitCountryCell(pr, cells, x, y, 0.5, 0.625)).toBe(0);
    expect(hitCountryCell(pr, cells, x, y)).toBe(-1);
    expect(hitCountryCell(pr, cells, cx(pr, 5 + 0.7), y, 0.5, 0.625)).toBe(-1);
    expect(hitCountryCell(pr, cells, cx(pr, 5), cy(pr, 5.45), 0.5, 0.625)).toBe(0);
    expect(hitCountryCell(pr, cells, cx(pr, 5), cy(pr, 5.45))).toBe(-1);
  });
});

describe('cities on the shores', () => {
  const mk = (id: number, lat: number, lng: number, pop: number) => ({ id, name: `c${id}`, country: 0, lat, lng, pop, capital: false, cell: [lat, lng] as [number, number] });
  it('takes the cities in the frame, at most 12, most populous first', () => {
    const cities = [mk(0, 41, 29, 100), mk(1, 50, 29, 5), mk(2, 42, 30, 300), ...Array.from({ length: 20 }, (_, k) => mk(10 + k, 43, 31, 10 + k))];
    const out = citiesInFrame(cities, { latMin: 40, latMax: 48, lngMin: 27, lngMax: 42 }, null);
    expect(out).toHaveLength(12);
    expect(out[0].id).toBe(2);
    expect(out[1].id).toBe(0);
    expect(out.some((c) => c.id === 1)).toBe(false);
  });
  it('compares longitude in the sea frame for a wrapping sea', () => {
    const cities = [mk(0, 60, -175, 5), mk(1, 60, 170, 4), mk(2, 60, 100, 9)];
    const out = citiesInFrame(cities, { latMin: 50, latMax: 70, lngMin: 160, lngMax: 200 }, 180);
    expect(out.map((c) => c.id)).toEqual([0, 1]);
  });
});

describe('land rim', () => {
  it('unwraps a polygon that crosses 180 and draws it at the shift that meets the frame', () => {
    const ring = [[170, 60], [-170, 60], [-170, 70], [170, 70], [170, 60]];
    const land = normaliseLand(toLandPolygons([[ring]] as unknown as number[][][][]));
    expect(land[0].bbox[0]).toBeGreaterThanOrEqual(-180);
    expect(land[0].bbox[2]).toBeGreaterThan(180);
    const hit = landShifts(land, { latMin: 55, latMax: 75, lngMin: 175, lngMax: 195 });
    expect(hit.map((h) => h.shift)).toEqual([0]);
    const west = landShifts(land, { latMin: 55, latMax: 75, lngMin: -185, lngMax: -175 });
    expect(west.map((h) => h.shift)).toEqual([-360]);
  });
  it('closes the Antarctic coast through the pole', () => {
    const coast: number[][] = [];
    for (let l = -180; l <= 180; l += 30) coast.push([l, -70]);
    coast[coast.length - 1] = [179.9, -70];
    const land = normaliseLand(toLandPolygons([[coast]] as unknown as number[][][][]));
    expect(land[0].rings[0].some((p) => p[1] === -90)).toBe(true);
  });
});
