import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CHUNK_THRESHOLD,
  NLAT,
  NLON,
  cityMark,
  computeCellTrends,
  continuousLon,
  countryAt,
  countryCellRect,
  countryCells,
  countryMeanSeries,
  countryPolygons,
  countryWidthKm,
  cx,
  cy,
  findCountry,
  fitCountryProjection,
  leftOutText,
  mainPart,
  frameLng,
  hitCountryCell,
  labelOrder,
  nearestCellIndex,
  niceKm,
  normalisePolygon,
  parseInt16Series,
  pickCountry,
  placeLabels,
  spotTrend,
  type CityRec,
  type CountryRec,
} from './country';
import { filterToPeriod } from './period';
import { trend } from './stats/trend';
import type { Ring } from './detail';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = join(here, '..', 'public', 'data');
const FIXTURE = join(here, '..', '..', 'pipeline', 'tests', 'fixtures', 'country_cases.json');

function maskWith(cells: [number, number, number][]): Uint8Array {
  const m = new Uint8Array(NLAT * NLON).fill(255);
  for (const [lat, lng, v] of cells) {
    const { i, j } = nearestCellIndex(lat, lng);
    m[i * NLON + j] = v;
  }
  return m;
}

describe('mask lookup', () => {
  const mask = maskWith([
    [40, 33.125, 36],
    [0, -180, 7],
    [0.5, 179.375, 9],
    [90, 0, 3],
  ]);
  it('finds the country at the nearest grid cell', () => {
    expect(countryAt(mask, 39.93, 32.86)).toBe(36);
    expect(countryAt(mask, 40.2, 33.3)).toBe(36);
    expect(countryAt(mask, 0, -150)).toBeUndefined();
  });
  it('wraps longitude and clamps latitude', () => {
    expect(countryAt(mask, 0, -180)).toBe(7);
    expect(countryAt(mask, 0, 180)).toBe(7); // 180 is the cell at -180
    expect(countryAt(mask, 0.5, -180.4)).toBe(9); // -180.4 wraps to the cell at 179.375
    expect(countryAt(mask, 0, 540)).toBe(7);
    expect(countryAt(mask, 95, 0)).toBe(3);
  });
  it('a tiny country is found through its single cell', () => {
    const recs = [{ idx: 108, tiny: true, tinyCell: [44, 7.5], bbox: [43.73, 43.77, 7.38, 7.44] }] as unknown as CountryRec[];
    expect(pickCountry(mask, recs, 43.9, 7.4)).toBe(108); // its cell
    expect(pickCountry(mask, recs, 43.75, 7.4)).toBe(108); // its own outline
    expect(pickCountry(mask, recs, 10, 10)).toBeUndefined();
    expect(pickCountry(mask, recs, 40, 33.1)).toBe(36);
  });
});

describe('cells', () => {
  it('are listed in mask order: latitude ascending, then longitude ascending', () => {
    const mask = maskWith([
      [10, 20, 5],
      [10, 19.375, 5],
      [9.5, 30, 5],
      [11, 0, 5],
      [10, 20, 6],
    ]);
    const cells = countryCells(mask, { idx: 5, tiny: false, tinyCell: null });
    expect(cells).toEqual([
      [9.5, 30],
      [10, 19.375],
      [11, 0],
    ]);
  });
  it('a tiny country has exactly its tiny cell', () => {
    expect(countryCells(new Uint8Array(NLAT * NLON).fill(255), { idx: 1, tiny: true, tinyCell: [44, 7.5] })).toEqual([[44, 7.5]]);
  });
});

describe('Int16 parsing', () => {
  it('reads little-endian hundredths and maps -32768 to NaN', () => {
    const a = new Int16Array([1234, -5, -32768, 0, 32767, -32767]);
    const rows = parseInt16Series(a.buffer, 3);
    expect(rows).toHaveLength(2);
    expect(rows[0][0]).toBe(12.34);
    expect(rows[0][1]).toBe(-0.05);
    expect(Number.isNaN(rows[0][2])).toBe(true);
    expect(rows[1]).toEqual([0, 327.67, -327.67]);
  });
});

describe('countryMeanSeries', () => {
  it('is the cos(lat)-weighted mean per year (hand computed)', () => {
    const cells: [number, number][] = [
      [0, 0],
      [60, 0],
    ];
    const values = [
      [10, 20],
      [4, 8],
    ];
    // weights 1 and 0.5 (cos 60)
    const { annual, nUsed } = countryMeanSeries(cells, values);
    expect(nUsed).toBe(2);
    expect(annual[0]).toBeCloseTo((10 * 1 + 4 * 0.5) / 1.5, 12);
    expect(annual[1]).toBeCloseTo((20 * 1 + 8 * 0.5) / 1.5, 12);
  });
  it('drops a cell with any missing year, completely', () => {
    const cells = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1 },
      { lat: 0, lng: 2 },
    ];
    const values = [
      [1, 2, 3],
      [100, NaN, 100],
      [3, 4, 5],
    ];
    const { annual, nUsed } = countryMeanSeries(cells, values);
    expect(nUsed).toBe(2);
    expect(annual).toEqual([2, 3, 4]);
  });
  it('is all NaN when no cell is complete', () => {
    const { annual, nUsed } = countryMeanSeries([[0, 0]], [[NaN, 1]]);
    expect(nUsed).toBe(0);
    expect(annual.every(Number.isNaN)).toBe(true);
  });
});

describe('outlines', () => {
  it('continuousLon replaces a jump over +-180 by the short way round', () => {
    const r = continuousLon([
      [179, 0],
      [-179, 1],
      [-178, 2],
      [179.5, 3],
    ]);
    expect(r.map((p) => p[0])).toEqual([179, 181, 182, 179.5]);
  });
  it('normalisePolygon unwraps a ring crossing the antimeridian', () => {
    const ring: Ring = [
      [179, 0],
      [-179, 0],
      [-179, 1],
      [179, 1],
      [179, 0],
    ];
    const { rings, moved } = normalisePolygon([ring]);
    expect(moved).toBe(true);
    expect(rings[0].map((p) => p[0])).toEqual([179, 181, 181, 179, 179]);
  });
  it('normalisePolygon leaves an ordinary polygon alone', () => {
    const ring: Ring = [
      [10, 0],
      [11, 0],
      [11, 1],
      [10, 0],
    ];
    const { rings, moved } = normalisePolygon([ring]);
    expect(moved).toBe(false);
    expect(rings[0]).toEqual(ring);
  });
  it('normalisePolygon turns the Antarctic pole ring + coast hole into the coast closed through the pole', () => {
    const pole: Ring = [
      [-180, -90],
      [180, -90],
      [-180, -90],
    ];
    const coast: Ring = [
      [-180, -70],
      [-90, -72],
      [0, -70],
      [90, -71],
      [179, -70],
      [-180, -70],
    ];
    const { rings } = normalisePolygon([pole, coast]);
    expect(rings).toHaveLength(1);
    const lats = rings[0].map((p) => p[1]);
    expect(Math.min(...lats)).toBe(-90);
    expect(rings[0][0]).toEqual(rings[0][rings[0].length - 1]);
  });
  it('frameLng keeps points within 180 degrees of the reference', () => {
    expect(frameLng(-175, 100)).toBe(185);
    expect(frameLng(175, -100)).toBe(-185);
    expect(frameLng(10, 20)).toBe(10);
  });
  it('countryPolygons puts a wrapping country in one frame', () => {
    const east: Ring = [[178, 0], [179.9, 0], [179.9, 1], [178, 0]];
    const west: Ring = [[-179.9, 0], [-179, 0], [-179, 1], [-179.9, 0]];
    const polys = countryPolygons([[east], [west]], true, 178);
    const xs = polys.flatMap((p) => p[0].map((q) => q[0]));
    expect(Math.min(...xs)).toBe(178);
    expect(Math.max(...xs)).toBeCloseTo(181, 9);
    const plain = countryPolygons([[west]], false, 0);
    expect(plain[0][0][0][0]).toBe(-179.9);
  });
});

describe('projection', () => {
  const square: Ring[][] = [[[[10, 40], [20, 40], [20, 50], [10, 50], [10, 40]]]];
  it('fits the polygon with a margin, north up, x scaled by cos(mid latitude)', () => {
    const pr = fitCountryProjection(square, 400, 1000, 10);
    const cosMid = Math.cos((45 * Math.PI) / 180);
    expect(pr.cosMid).toBeCloseTo(cosMid, 12);
    // corners
    expect(cx(pr, 10)).toBeCloseTo(10, 9); // left margin (no letterbox: width-limited)
    expect(cx(pr, 20)).toBeCloseTo(390, 9);
    expect(cy(pr, 50)).toBeCloseTo(pr.offY, 9);
    expect(cy(pr, 40)).toBeGreaterThan(cy(pr, 50)); // north up
    // 10 degrees of longitude are cos(45) as wide as 10 degrees of latitude is tall
    const w = cx(pr, 20) - cx(pr, 10);
    const h = cy(pr, 40) - cy(pr, 50);
    expect(w / h).toBeCloseTo(cosMid, 9);
    expect(pr.height).toBeCloseTo(h + 20, 9);
  });
  it('caps the height and letterboxes horizontally', () => {
    const tall: Ring[][] = [[[[0, 0], [1, 0], [1, 40], [0, 40], [0, 0]]]];
    const pr = fitCountryProjection(tall, 400, 420, 10);
    expect(pr.height).toBe(420);
    expect(cy(pr, 40)).toBeCloseTo(10, 9);
    expect(cy(pr, 0)).toBeCloseTo(410, 9);
    expect(cx(pr, 0)).toBeGreaterThan(10); // centred, narrow
    expect(cx(pr, 0) + (cx(pr, 1) - cx(pr, 0)) / 2).toBeCloseTo(200, 9);
  });
  it('a wrapping country fits as one piece once unwrapped', () => {
    const east: Ring = [[178, -17], [180, -17], [180, -16], [178, -17]];
    const west: Ring = [[-180, -17], [-178, -17], [-178, -16], [-180, -17]];
    const polys = countryPolygons([[east], [west]], true, 179);
    const pr = fitCountryProjection(polys, 300, 420);
    expect(pr.lngSpan).toBeCloseTo(4, 9);
    expect(cx(pr, 182) - cx(pr, 178)).toBeCloseTo(300 - 2 * 10 - 2 * (pr.offX - 10), 6);
  });
  it('width in km uses the mid latitude', () => {
    const pr = fitCountryProjection(square, 400);
    expect(countryWidthKm(pr)).toBeCloseTo(10 * Math.cos((45 * Math.PI) / 180) * 111.32, 6);
  });
  it('niceKm picks 1, 2 or 5 times a power of ten', () => {
    expect(niceKm(730)).toBe(500);
    expect(niceKm(199)).toBe(100);
    expect(niceKm(200)).toBe(200);
    expect(niceKm(12)).toBe(10);
  });
});

describe('hit test', () => {
  const pr = fitCountryProjection([[[[10, 40], [20, 40], [20, 50], [10, 50], [10, 40]]]], 400, 1000, 10);
  const cells = [
    { lat: 45, lng: 15 },
    { lat: 45, lng: 15.625 },
    { lat: 46, lng: 15 },
  ];
  it('returns the cell whose rectangle holds the point', () => {
    for (const [k, c] of cells.entries()) {
      const r = countryCellRect(pr, c.lat, c.lng);
      expect(hitCountryCell(pr, cells, r.x + r.w / 2, r.y + r.h / 2)).toBe(k);
    }
  });
  it('returns -1 outside every cell', () => {
    expect(hitCountryCell(pr, cells, 1, 1)).toBe(-1);
  });
  it('cell rectangle is +-0.25 deg tall and +-0.3125 deg wide (scaled by cos at the projection)', () => {
    const r = countryCellRect(pr, 45, 15);
    expect(r.h).toBeCloseTo(0.5 * pr.scale, 9);
    expect(r.w).toBeCloseTo(0.625 * pr.cosMid * pr.scale, 9);
  });
});

describe('labels', () => {
  const bounds = { width: 300, height: 200 };
  it('skips a label that would collide with one already placed', () => {
    const placed = placeLabels(
      [
        { key: 1, x: 100, y: 100, w: 60, h: 12 },
        { key: 2, x: 140, y: 104, w: 60, h: 12 }, // collides with the first on the right and on the left
        { key: 3, x: 100, y: 140, w: 60, h: 12 },
      ],
      bounds,
    );
    expect(placed.map((p) => p.key)).toEqual([1, 3]);
  });
  it('moves a label to the left of its dot at the right edge, and skips it if it fits nowhere', () => {
    const p = placeLabels([{ key: 1, x: 280, y: 50, w: 60, h: 12 }], bounds);
    expect(p).toHaveLength(1);
    expect(p[0].x + p[0].w).toBeLessThanOrEqual(280);
    expect(placeLabels([{ key: 2, x: 150, y: 50, w: 400, h: 12 }], bounds)).toHaveLength(0);
  });
  it('earlier (higher priority) labels win', () => {
    const p = placeLabels(
      [
        { key: 9, x: 50, y: 50, w: 50, h: 12 },
        { key: 8, x: 52, y: 52, w: 50, h: 12 },
      ],
      bounds,
    );
    expect(p.map((x) => x.key)).toEqual([9]);
  });
  const mk = (id: number, pop: number, capital: boolean): CityRec => ({ id, name: `c${id}`, country: 1, lat: 0, lng: 0, pop, capital, cell: [0, 0] });
  it('labelOrder: capital first, then the largest, at most 7', () => {
    const cities = [mk(0, 10, false), mk(1, 50, false), mk(2, 5, true), ...Array.from({ length: 9 }, (_, k) => mk(3 + k, 20 + k, false))];
    const o = labelOrder(cities, 7);
    expect(o).toHaveLength(7);
    expect(o[0].id).toBe(2);
    expect(o[1].id).toBe(1);
  });
});

describe('trends', () => {
  const years = Array.from({ length: 20 }, (_, k) => 2000 + k);
  const rising = years.map((y, k) => 10 + 0.05 * (y - 2000) + 0.01 * Math.sin(k));
  it('spotTrend equals trend() on the period slice and reports no data under 10 years', () => {
    const per: [number, number] = [2003, 2018];
    const t = spotTrend(years, rising, per);
    const { years: ys, values } = filterToPeriod(years, rising, per);
    const r = trend(values, ys);
    expect(t.slopeDecade).toBe(r.slope * 10);
    expect(t.p).toBe(r.p);
    const holes = years.map((_, k) => (k < 12 ? NaN : 1 + k));
    expect(spotTrend(years, holes, [2000, 2019])).toEqual({ slopeDecade: null, p: null, n: 8 });
  });
  it('computeCellTrends gives the same numbers in chunks (large country) and can be cancelled', async () => {
    const n = CHUNK_THRESHOLD + 50;
    const cells: [number, number][] = Array.from({ length: n }, (_, k) => [k * 0.001, 0]);
    const values = cells.map((_, k) => years.map((y) => 10 + (k % 7) * 0.01 * (y - 2000) + ((k * y) % 5) * 0.01));
    const out = await computeCellTrends(cells, values, years, [2000, 2019]);
    expect(out).toHaveLength(n);
    for (const k of [0, 1, 1000, n - 1]) {
      const t = spotTrend(years, values[k], [2000, 2019]);
      expect(out![k].slopeDecade).toBe(t.slopeDecade);
      expect(out![k].lat).toBe(cells[k][0]);
    }
    let calls = 0;
    const cancelled = await computeCellTrends(cells, values, years, [2000, 2019], () => ++calls >= 2);
    expect(cancelled).toBeNull();
  });
  it('cityMark follows the verdict thresholds', () => {
    expect(cityMark(0.3, 0.01).kind).toBe('rising');
    expect(cityMark(-0.3, 0.049).kind).toBe('falling');
    expect(cityMark(0.3, 0.07).kind).toBe('possible-rising');
    expect(cityMark(-0.3, 0.07).kind).toBe('possible-falling');
    expect(cityMark(0.3, 0.5).kind).toBe('none');
    expect(cityMark(null, null).kind).toBe('nodata');
  });
  it('findCountry by name or index', () => {
    const recs = [{ idx: 0, name: 'Zimbabwe' }, { idx: 36, name: 'Turkey' }] as CountryRec[];
    expect(findCountry(recs, 'turkey')?.idx).toBe(36);
    expect(findCountry(recs, 0)?.name).toBe('Zimbabwe');
    expect(findCountry(recs, '36')?.name).toBe('Turkey');
    expect(findCountry(recs, 'Atlantis')).toBeUndefined();
  });
});

interface Case {
  variable: string;
  idx: number;
  name: string;
  nCells: number;
  nCellsUsed: number;
  series: number[];
  trend: { slopeDecade: number; ciLowDecade: number; ciHighDecade: number; p: number } | null;
}

describe('pipeline fixture vs the real data files', () => {
  const fx = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { years: number[]; cases: Case[] };
  const mask = new Uint8Array(readFileSync(join(DATA, 'country_mask.bin')));
  const recs = JSON.parse(readFileSync(join(DATA, 'countries.json'), 'utf8')) as CountryRec[];

  it('has 4 countries x 3 variables', () => {
    expect(fx.cases).toHaveLength(12);
    expect(new Set(fx.cases.map((c) => c.name)).size).toBe(4);
    expect(mask.length).toBe(NLAT * NLON);
    expect(recs).toHaveLength(241);
  });

  for (const c of fx.cases) {
    it(`${c.name} ${c.variable}: mean series to 1e-9 and trend() slope / CI / p to 1e-9`, () => {
      const rec = recs[c.idx];
      expect(rec.name).toBe(c.name);
      expect(rec.nCells).toBe(c.nCells);
      const cells = countryCells(mask, rec);
      expect(cells).toHaveLength(c.nCells);
      const file = readFileSync(join(DATA, 'countries', c.variable, `${c.idx}.bin`));
      const buf = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
      expect(buf.byteLength).toBe(c.nCells * 45 * 2);
      const values = parseInt16Series(buf, 45);
      const { annual, nUsed } = countryMeanSeries(cells, values);
      expect(nUsed).toBe(c.nCellsUsed);
      expect(annual).toHaveLength(45);
      annual.forEach((v, k) => expect(Math.abs(v - c.series[k])).toBeLessThan(1e-9));
      const r = trend(annual, fx.years);
      expect(c.trend).not.toBeNull();
      expect(Math.abs(r.slope * 10 - c.trend!.slopeDecade)).toBeLessThan(1e-9);
      expect(Math.abs(r.ciLow * 10 - c.trend!.ciLowDecade)).toBeLessThan(1e-9);
      expect(Math.abs(r.ciHigh * 10 - c.trend!.ciHighDecade)).toBeLessThan(1e-9);
      expect(Math.abs(r.p - c.trend!.p)).toBeLessThan(1e-9);
    });
  }

  it('the real mask finds Ankara, Paris and the open Pacific', () => {
    expect(recs[countryAt(mask, 39.93, 32.86)!].name).toBe('Turkey');
    expect(recs[countryAt(mask, 48.85, 2.35)!].name).toBe('France');
    expect(countryAt(mask, 0, -150)).toBeUndefined();
    expect(pickCountry(mask, recs, 43.75, 7.4)).toBe(recs.find((r) => r.name === 'Monaco')!.idx);
    expect(recs[pickCountry(mask, recs, 43.5, 7.0)!].name).toBe('France');
  });
});

describe('main part of a country (the frame of the lifted view)', () => {
  const box = (lng0: number, lat0: number, w: number, h: number): Ring[] => [
    [[lng0, lat0], [lng0 + w, lat0], [lng0 + w, lat0 + h], [lng0, lat0 + h], [lng0, lat0]],
  ];
  it('a single polygon is its own main part', () => {
    const polys = [box(0, 40, 10, 8)];
    expect(mainPart(polys)).toEqual({ polys, left: 0 });
  });
  it('leaves out a small territory an ocean away (France and French Guiana)', () => {
    const mainland = box(-5, 42, 13, 9);
    const corsica = box(8.5, 41.4, 1, 1.6);
    const guiana = box(-54.5, 2.1, 3, 3.6);
    const r = mainPart([guiana, mainland, corsica]);
    expect(r.left).toBe(1);
    expect(r.polys).toEqual([mainland, corsica]); // original order kept
    const pr = fitCountryProjection(r.polys, 600, 420);
    expect(pr.lngSpan).toBeCloseTo(14.5, 9);
  });
  it('keeps large or nearby parts (Alaska and Hawaii with the lower 48)', () => {
    const lower48 = box(-125, 25, 58, 24);
    const alaska = box(-170, 55, 40, 16);
    const hawaii = box(-160, 19, 5, 3);
    expect(mainPart([lower48, alaska, hawaii]).left).toBe(0);
  });
  it('never leaves out a part holding a fifth of the area, however far', () => {
    const a = box(0, 0, 10, 10);
    const b = box(100, 0, 6, 6);
    expect(mainPart([a, b]).left).toBe(0);
  });
  it('a scattered island state is framed on its largest island', () => {
    const big = box(-157.5, 1.7, 0.4, 0.3);
    const atolls = [box(173, 1.3, 0.1, 0.1), box(-171.7, -2.8, 0.05, 0.05), box(176.4, -1.4, 0.03, 0.03)];
    const r = mainPart([atolls[0], big, atolls[1], atolls[2]]);
    expect(r.polys).toEqual([big]);
    expect(r.left).toBe(3);
  });
  it('islands within about 550 km of a small main island stay in the frame', () => {
    const main = box(177.2, -18.3, 1.4, 1);
    const second = box(178.5, -17, 1.4, 0.8);
    const outer = box(181, -19.2, 0.2, 0.2); // 178 W in the country's own frame
    expect(mainPart([main, second, outer]).left).toBe(0);
  });
  it('a part skipped at first joins once the frame has grown towards it', () => {
    const main = box(0, 0, 4, 4);
    const far = box(13, 0, 0.5, 0.5); // 9 degrees from the main part: too far at first
    const bridge = box(7, 0, 3, 3); // joins, and the frame then reaches to 10
    expect(mainPart([main, far, bridge]).left).toBe(0);
  });
  it('says how many parts are outside the view', () => {
    expect(leftOutText(0)).toBe('');
    expect(leftOutText(1)).toContain('One distant part');
    expect(leftOutText(4)).toContain('4 distant parts');
  });
});
