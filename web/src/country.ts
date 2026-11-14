/**
 * Country view: pure helpers (mask lookup, cell lists, Int16 parsing, area mean, outline normalisation, projection
 * fit, hit test, label placement, per-cell trends) and small lazy loaders for the static files written by
 * pipeline/countries.py. No network is involved except same-origin static files.
 */
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { MIN_YEARS } from './analysis';
import { dataUrl } from './data';
import { CELL_HALF_LAT, CELL_HALF_LNG, type DetailCell, type Ring } from './detail';
import { filterToPeriod, type Period } from './period';
import { trend, verdictKind } from './stats/trend';

// ---- grid ------------------------------------------------------------------------------------------------------

export const NLAT = 361;
export const NLON = 576;
export const LAT0 = -90;
export const DLAT = 0.5;
export const LON0 = -180;
export const DLON = 0.625;
export const NO_COUNTRY = 255;
export const MISSING_INT16 = -32768;

export interface CountryRec {
  idx: number;
  name: string;
  iso: string | null;
  nCells: number;
  tiny: boolean;
  /** [latMin, latMax, lngMin, lngMax] of the polygons (lng meaningless when `wraps`). */
  bbox: [number, number, number, number];
  /** A point inside the largest polygon. */
  centre: [number, number];
  tinyCell: [number, number] | null;
  wraps?: boolean;
  /** Set when this piece is a sea or ocean (see sea.ts): `idx` is then the sea index, not a country index. */
  sea?: { kind: string; dlat: number; dlng: number };
}

export interface CityRec {
  id: number;
  name: string;
  country: number;
  lat: number;
  lng: number;
  pop: number;
  capital: boolean;
  cell: [number, number];
}

/** Grid indices of the nearest cell: latitude clamps, longitude wraps. */
export function nearestCellIndex(lat: number, lng: number): { i: number; j: number } {
  const i = Math.min(Math.max(Math.round((lat - LAT0) / DLAT), 0), NLAT - 1);
  const j = (((Math.round((lng - LON0) / DLON) % NLON) + NLON) % NLON);
  return { i, j };
}

/** Country index at the nearest grid cell (longitude wraps), or undefined for water / no country. */
export function countryAt(mask: Uint8Array, lat: number, lng: number): number | undefined {
  const { i, j } = nearestCellIndex(lat, lng);
  const v = mask[i * NLON + j];
  return v === NO_COUNTRY ? undefined : v;
}

/**
 * Country under a click. A tiny country (smaller than a grid cell, so absent from the mask) is picked when the click
 * lies within its own outline's bounding box or, for the water cell that stands for it, in its single cell; otherwise
 * `countryAt`.
 */
export function pickCountry(mask: Uint8Array, recs: CountryRec[], lat: number, lng: number): number | undefined {
  for (const r of recs) {
    if (r.tiny && !r.wraps && lat >= r.bbox[0] && lat <= r.bbox[1] && lng >= r.bbox[2] && lng <= r.bbox[3]) return r.idx;
  }
  const hit = countryAt(mask, lat, lng);
  if (hit !== undefined) return hit;
  const { i, j } = nearestCellIndex(lat, lng);
  for (const r of recs) {
    if (r.tiny && r.tinyCell) {
      const t = nearestCellIndex(r.tinyCell[0], r.tinyCell[1]);
      if (t.i === i && t.j === j) return r.idx;
    }
  }
  return undefined;
}

/** [lat, lng] of a country's cells in mask order (latitude ascending, then longitude ascending). */
export function countryCells(mask: Uint8Array, rec: Pick<CountryRec, 'idx' | 'tiny' | 'tinyCell'>): [number, number][] {
  if (rec.tiny) return rec.tinyCell ? [[rec.tinyCell[0], rec.tinyCell[1]]] : [];
  const out: [number, number][] = [];
  for (let i = 0; i < NLAT; i++) {
    for (let j = 0; j < NLON; j++) {
      if (mask[i * NLON + j] === rec.idx) out.push([LAT0 + i * DLAT, LON0 + j * DLON]);
    }
  }
  return out;
}

/**
 * Int16 little-endian [nCells][nYears] (stored = round((v - offset) * 100), -32768 = missing) -> rows of numbers
 * (v = stored / 100 + offset), NaN for missing. The offset is 0 except for ozone (pipeline config int16_offset).
 */
export function parseInt16Series(buf: ArrayBuffer, nYears: number, offset = 0): number[][] {
  const n = Math.floor(buf.byteLength / 2 / nYears);
  const dv = new DataView(buf);
  const rows: number[][] = [];
  for (let c = 0; c < n; c++) {
    const row = new Array<number>(nYears);
    for (let y = 0; y < nYears; y++) {
      const v = dv.getInt16((c * nYears + y) * 2, true);
      row[y] = v === MISSING_INT16 ? NaN : v / 100 + offset;
    }
    rows.push(row);
  }
  return rows;
}

/**
 * cos(latitude)-weighted mean per year over the cells. A cell with any missing year is dropped completely.
 * Returns the series and how many cells were used (series is all NaN when none was).
 */
export function countryMeanSeries(
  cells: { lat: number; lng: number }[] | [number, number][],
  values: number[][],
): { annual: number[]; nUsed: number } {
  const nYears = values[0]?.length ?? 0;
  const sum = new Array<number>(nYears).fill(0);
  let wsum = 0;
  let nUsed = 0;
  cells.forEach((c, k) => {
    const row = values[k];
    if (!row || row.some((v) => !Number.isFinite(v))) return;
    const lat = Array.isArray(c) ? c[0] : c.lat;
    const w = Math.cos((lat * Math.PI) / 180);
    for (let y = 0; y < nYears; y++) sum[y] += w * row[y];
    wsum += w;
    nUsed++;
  });
  return { annual: sum.map((s) => (wsum > 0 ? s / wsum : NaN)), nUsed };
}

// ---- outlines ----------------------------------------------------------------------------------------------------

/** Longitudes made continuous: a jump across +-180 is replaced by the short way round (mirror of countries.py). */
export function continuousLon(r: Ring): Ring {
  const out: Ring = [[r[0][0], r[0][1]]];
  let lon = r[0][0];
  for (let k = 1; k < r.length; k++) {
    let d = r[k][0] - r[k - 1][0];
    d -= 360 * Math.round(d / 360);
    lon += d;
    out.push([lon, r[k][1]]);
  }
  return out;
}

/**
 * One TopoJSON polygon made planar (mirror of countries.py). The country outlines are not cut at +-180, so a ring
 * that crosses it has its longitudes unwrapped (it then reaches past 180). The Antarctic polygon (outer ring along
 * the pole, coast as the hole) becomes the coast ring closed through the pole.
 */
export function normalisePolygon(poly: Ring[]): { rings: Ring[]; moved: boolean } {
  const maxLat = (r: Ring) => r.reduce((m, p) => Math.max(m, p[1]), -Infinity);
  if (poly.length > 1 && maxLat(poly[0]) <= -89.9) {
    const coast = continuousLon(poly[1]);
    const last = coast[coast.length - 1];
    return { rings: [[...coast, [last[0], -90], [coast[0][0], -90], coast[0]]], moved: false };
  }
  const un = poly.map((r) => {
    const c = continuousLon(r);
    const closes = Math.abs(c[c.length - 1][0] - c[0][0]) < 1e-6;
    const moved = closes && c.some((p, k) => Math.abs(p[0] - r[k][0]) > 1e-9);
    return { ring: closes ? c : r, moved };
  });
  const moved = un.some((u) => u.moved);
  let outer = un[0].ring;
  if (moved) {
    const min = Math.min(...outer.map((p) => p[0]));
    const sh = 360 * Math.ceil((-180 - min) / 360);
    outer = outer.map((p) => [p[0] + sh, p[1]]);
  }
  const lonMid = (r: Ring) => {
    let a = Infinity;
    let b = -Infinity;
    for (const p of r) {
      if (p[0] < a) a = p[0];
      if (p[0] > b) b = p[0];
    }
    return 0.5 * (a + b);
  };
  const centre = lonMid(outer);
  const rings: Ring[] = [outer];
  for (const u of un.slice(1)) {
    const sh = moved ? 360 * Math.round((centre - lonMid(u.ring)) / 360) : 0;
    rings.push(sh ? u.ring.map((p) => [p[0] + sh, p[1]]) : u.ring);
  }
  return { rings, moved };
}

/** Longitude expressed in the frame centred on `ref` (within 180 degrees of it). */
export function frameLng(lng: number, ref: number): number {
  return ref + ((((lng - ref + 540) % 360) + 360) % 360) - 180;
}

/** All polygons of a country, planar, and for a wrapping country shifted into the frame of `refLng`. */
export function countryPolygons(coords: number[][][][], wraps: boolean, refLng: number): Ring[][] {
  return coords.map((poly) => {
    const { rings } = normalisePolygon(poly as Ring[]);
    return wraps ? rings.map((r) => r.map((p): [number, number] => [frameLng(p[0], refLng), p[1]])) : rings;
  });
}

// ---- projection ------------------------------------------------------------------------------------------------

export interface CountryProjection {
  width: number;
  height: number;
  /** Pixels per degree of latitude. */
  scale: number;
  /** x is scaled by cos(mid latitude) so the shape looks natural. */
  cosMid: number;
  lngMin: number;
  latMax: number;
  offX: number;
  offY: number;
  /** Fitted extent in degrees (frame longitudes). */
  lngSpan: number;
  latSpan: number;
  midLat: number;
}

export function polygonBounds(polys: Ring[][]): { latMin: number; latMax: number; lngMin: number; lngMax: number } {
  let latMin = Infinity;
  let latMax = -Infinity;
  let lngMin = Infinity;
  let lngMax = -Infinity;
  for (const p of polys) {
    for (const [x, y] of p[0]) {
      if (x < lngMin) lngMin = x;
      if (x > lngMax) lngMax = x;
      if (y < latMin) latMin = y;
      if (y > latMax) latMax = y;
    }
  }
  return { latMin, latMax, lngMin, lngMax };
}

/**
 * Fit a country's polygons (already in one longitude frame) into a canvas `width` px wide and at most `maxHeight`
 * px tall, equirectangular with x scaled by cos(mid latitude), north up, `margin` px around, letterboxed.
 */
export function fitCountryProjection(
  polys: Ring[][],
  width: number,
  maxHeight = 420,
  margin = 10,
): CountryProjection {
  return fitBoundsProjection(polygonBounds(polys), width, maxHeight, margin);
}

/** The same fit for a bounding box (a sea's frame is a rectangle, see sea.ts). */
export function fitBoundsProjection(
  b: { latMin: number; latMax: number; lngMin: number; lngMax: number },
  width: number,
  maxHeight = 420,
  margin = 10,
): CountryProjection {
  const midLat = (b.latMin + b.latMax) / 2;
  const cosMid = Math.max(Math.cos((midLat * Math.PI) / 180), 0.05);
  const lngSpan = Math.max(b.lngMax - b.lngMin, 1e-6);
  const latSpan = Math.max(b.latMax - b.latMin, 1e-6);
  const wAvail = Math.max(width - 2 * margin, 1);
  let scale = wAvail / (lngSpan * cosMid);
  let height = latSpan * scale + 2 * margin;
  if (height > maxHeight) {
    scale = (maxHeight - 2 * margin) / latSpan;
    height = maxHeight;
  }
  const offX = (width - lngSpan * cosMid * scale) / 2;
  const offY = (height - latSpan * scale) / 2;
  return { width, height, scale, cosMid, lngMin: b.lngMin, latMax: b.latMax, offX, offY, lngSpan, latSpan, midLat };
}

export const cx = (pr: CountryProjection, lng: number): number => pr.offX + (lng - pr.lngMin) * pr.cosMid * pr.scale;
export const cy = (pr: CountryProjection, lat: number): number => pr.offY + (pr.latMax - lat) * pr.scale;

/** Canvas rectangle of the grid cell centred on (lat, lng), lng in the same frame as the polygons. */
export function countryCellRect(
  pr: CountryProjection,
  lat: number,
  lng: number,
  halfLat = CELL_HALF_LAT,
  halfLng = CELL_HALF_LNG,
) {
  const x0 = cx(pr, lng - halfLng);
  const x1 = cx(pr, lng + halfLng);
  const y0 = cy(pr, lat + halfLat);
  const y1 = cy(pr, lat - halfLat);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Index of the cell whose rectangle holds the canvas point (nearest centre if several), or -1. */
export function hitCountryCell(
  pr: CountryProjection,
  cells: { lat: number; lng: number }[],
  x: number,
  y: number,
  halfLat = CELL_HALF_LAT,
  halfLng = CELL_HALF_LNG,
): number {
  let best = -1;
  let bestD = Infinity;
  cells.forEach((c, k) => {
    const r = countryCellRect(pr, c.lat, c.lng, halfLat, halfLng);
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) {
      const d = Math.hypot(x - (r.x + r.w / 2), y - (r.y + r.h / 2));
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
  });
  return best;
}

/** Width of the fitted country in km (at its mid latitude). */
export function countryWidthKm(pr: CountryProjection): number {
  return pr.lngSpan * pr.cosMid * 111.32;
}

/** A round length (1, 2 or 5 x 10^k km) that fits within `maxKm`. */
export function niceKm(maxKm: number): number {
  if (!(maxKm > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(maxKm)));
  for (const m of [5, 2, 1]) if (m * p <= maxKm) return m * p;
  return p;
}

// ---- labels ------------------------------------------------------------------------------------------------------

export interface LabelCandidate {
  key: number;
  /** Dot position. */
  x: number;
  y: number;
  /** Text size. */
  w: number;
  h: number;
}
export interface PlacedLabel {
  key: number;
  /** Top-left of the text box. */
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Place labels in priority order. Each goes to the right of its dot (or, if that leaves the canvas or collides, to
 * the left); a label that would collide with an already placed one, or with a dot-sized box of an earlier label,
 * is skipped.
 */
export function placeLabels(
  cands: LabelCandidate[],
  bounds: { width: number; height: number },
  gap = 5,
): PlacedLabel[] {
  const placed: PlacedLabel[] = [];
  for (const c of cands) {
    const tries = [
      { x: c.x + gap, y: c.y - c.h / 2 },
      { x: c.x - gap - c.w, y: c.y - c.h / 2 },
    ];
    for (const t of tries) {
      const box = { key: c.key, x: t.x, y: t.y, w: c.w, h: c.h };
      const inside = box.x >= 0 && box.y >= 0 && box.x + box.w <= bounds.width && box.y + box.h <= bounds.height;
      if (inside && !placed.some((p) => overlaps(p, box))) {
        placed.push(box);
        break;
      }
    }
  }
  return placed;
}

/** Which cities get a name label: the capital(s), then the largest by population, at most `max` in all. */
export function labelOrder<T extends CityRec>(cities: T[], max = 7): T[] {
  const caps = cities.filter((c) => c.capital);
  const rest = cities.filter((c) => !c.capital).sort((a, b) => b.pop - a.pop);
  return [...caps, ...rest].slice(0, Math.max(max, caps.length));
}

// ---- trends ------------------------------------------------------------------------------------------------------

export interface SpotTrend {
  slopeDecade: number | null;
  p: number | null;
  n: number;
}

/** The existing `trend()` on one series' years inside the period; fewer than MIN_YEARS valid years -> no data. */
export function spotTrend(years: number[], row: number[], period: Period): SpotTrend {
  const { years: ys, values } = filterToPeriod(years, row, period);
  if (ys.length < MIN_YEARS) return { slopeDecade: null, p: null, n: ys.length };
  const r = trend(values, ys);
  return { slopeDecade: r.slope * 10, p: r.p, n: ys.length };
}

export const CHUNK_THRESHOLD = 2000;
export const CHUNK_SIZE = 400;

/**
 * Trend of every cell. Up to CHUNK_THRESHOLD cells it is synchronous; for more it works in chunks, yielding to the
 * event loop between them (`isCancelled` is checked after each chunk; a cancelled run resolves to null).
 */
export async function computeCellTrends(
  cells: [number, number][],
  values: number[][],
  years: number[],
  period: Period,
  isCancelled: () => boolean = () => false,
  onProgress?: (done: number, total: number) => void,
): Promise<DetailCell[] | null> {
  const out: DetailCell[] = [];
  const step = cells.length > CHUNK_THRESHOLD ? CHUNK_SIZE : cells.length || 1;
  for (let a = 0; a < cells.length; a += step) {
    const b = Math.min(a + step, cells.length);
    for (let k = a; k < b; k++) {
      const t = spotTrend(years, values[k], period);
      out.push({ lat: cells[k][0], lng: cells[k][1], slopeDecade: t.slopeDecade, p: t.p, n: t.n });
    }
    if (step < cells.length) {
      onProgress?.(b, cells.length);
      await new Promise<void>((res) => setTimeout(res, 0));
      if (isCancelled()) return null;
    }
  }
  return out;
}

export type CityMarkKind = 'rising' | 'falling' | 'possible-rising' | 'possible-falling' | 'none' | 'nodata';

/** Mark for a city row, from the same verdict thresholds as the main verdict (p < 0.05, 0.05 to 0.10, else). */
export function cityMark(slopeDecade: number | null, p: number | null): { kind: CityMarkKind; symbol: string; label: string } {
  if (slopeDecade === null || p === null) return { kind: 'nodata', symbol: '·', label: 'no data' };
  const k = verdictKind(p);
  if (k === 'none' || slopeDecade === 0) return { kind: 'none', symbol: '–', label: 'no clear trend' };
  const up = slopeDecade > 0;
  if (k === 'significant') return up ? { kind: 'rising', symbol: '▲', label: 'rising' } : { kind: 'falling', symbol: '▼', label: 'falling' };
  return up
    ? { kind: 'possible-rising', symbol: '▲', label: 'possibly rising' }
    : { kind: 'possible-falling', symbol: '▼', label: 'possibly falling' };
}

// ---- lazy loaders ------------------------------------------------------------------------------------------------

function once<T>(load: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => {
    if (!p) {
      p = load().catch((err) => {
        p = null;
        throw err;
      });
    }
    return p;
  };
}

async function fetchOk(file: string): Promise<Response> {
  const res = await fetch(dataUrl(file));
  if (!res.ok) throw new Error(`Failed to load ${file}: HTTP ${res.status}`);
  return res;
}

export const loadMask = once(async () => new Uint8Array(await (await fetchOk('country_mask.bin')).arrayBuffer()));
export const loadCountries = once(async () => (await (await fetchOk('countries.json')).json()) as CountryRec[]);
export const loadCities = once(async () => (await (await fetchOk('cities.json')).json()) as CityRec[]);

const cityCache = new Map<string, Promise<number[][]>>();
/** Series of every city's grid cell for one variable. */
export function loadCitySeries(variable: string, nYears: number, offset = 0): Promise<number[][]> {
  let p = cityCache.get(variable);
  if (!p) {
    p = fetchOk(`${variable}_cities.bin`)
      .then((r) => r.arrayBuffer())
      .then((b) => parseInt16Series(b, nYears, offset));
    p.catch(() => cityCache.delete(variable));
    cityCache.set(variable, p);
  }
  return p;
}

const seriesCache = new Map<string, Promise<number[][]>>();
/** Series of every cell of a country (mask order) for one variable. */
export function loadCountrySeries(variable: string, idx: number, nYears: number, offset = 0): Promise<number[][]> {
  const key = `${variable}/${idx}`;
  let p = seriesCache.get(key);
  if (!p) {
    p = fetchOk(`countries/${variable}/${idx}.bin`)
      .then((r) => r.arrayBuffer())
      .then((b) => parseInt16Series(b, nYears, offset));
    p.catch(() => seriesCache.delete(key));
    seriesCache.set(key, p);
  }
  return p;
}

/** Raw (TopoJSON order, antimeridian-jumping) polygons of every country, a separate lazy chunk. */
export const loadOutlines = once(async () => {
  const mod = await import('world-atlas/countries-50m.json');
  const topo = (mod.default ?? mod) as unknown as Topology;
  const fc = feature(topo, topo.objects.countries as GeometryCollection);
  return fc.features.map((f): number[][][][] => {
    const g = f.geometry;
    if (!g) return [];
    if (g.type === 'Polygon') return [g.coordinates];
    if (g.type === 'MultiPolygon') return g.coordinates;
    return [];
  });
});

/** Case-insensitive lookup by index or name. */
export function findCountry(recs: CountryRec[], nameOrIdx: string | number): CountryRec | undefined {
  if (typeof nameOrIdx === 'number') return recs.find((r) => r.idx === nameOrIdx);
  const s = nameOrIdx.trim().toLowerCase();
  if (/^\d+$/.test(s)) return recs.find((r) => r.idx === Number(s));
  return recs.find((r) => r.name.toLowerCase() === s) ?? recs.find((r) => r.name.toLowerCase().startsWith(s));
}

// ---- provinces / states -----------------------------------------------------------------------------------------

/** One province / state as written by pipeline/provinces.py. `cells` index the country's cell list (mask order). */
export interface ProvinceRec {
  name: string;
  type: string;
  centre: [number, number];
  rings: Ring[];
  cells: number[];
}

export interface ProvinceTrend extends ProvinceRec {
  slopeDecade: number | null;
  p: number | null;
  /** Cells listed for the province / cells that actually had a full series. */
  nCells: number;
  nUsed: number;
}

const provinceCache = new Map<number, Promise<ProvinceRec[]>>();
/** Provinces of one country; a missing file (or one that is not valid) or fewer than 2 provinces gives []. */
export function loadProvinces(idx: number): Promise<ProvinceRec[]> {
  let p = provinceCache.get(idx);
  if (!p) {
    p = fetch(dataUrl(`provinces/${idx}.json`))
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const list = (j && Array.isArray(j.provinces) ? j.provinces : []) as ProvinceRec[];
        return list.length >= 2 ? list : [];
      })
      .catch(() => []);
    provinceCache.set(idx, p);
  }
  return p;
}

/** cos(latitude)-weighted mean of the province's cells' series, then the trend for the period. */
export function provinceTrend(
  prov: ProvinceRec,
  cells: [number, number][],
  values: number[][],
  years: number[],
  period: Period,
): ProvinceTrend {
  const ks = prov.cells.filter((k) => k >= 0 && k < cells.length);
  const { annual, nUsed } = countryMeanSeries(ks.map((k) => cells[k]), ks.map((k) => values[k]));
  const t = nUsed > 0 ? spotTrend(years, annual, period) : { slopeDecade: null, p: null };
  return { ...prov, slopeDecade: t.slopeDecade, p: t.p, nCells: ks.length, nUsed };
}

export function provinceTrends(
  provs: ProvinceRec[],
  cells: [number, number][],
  values: number[][],
  years: number[],
  period: Period,
): ProvinceTrend[] {
  return provs.map((pv) => provinceTrend(pv, cells, values, years, period));
}

/** Largest rise first, no data last, then by name. */
export function sortProvinces<T extends { name: string; slopeDecade: number | null }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    if (a.slopeDecade === null && b.slopeDecade === null) return a.name.localeCompare(b.name);
    if (a.slopeDecade === null) return 1;
    if (b.slopeDecade === null) return -1;
    return b.slopeDecade - a.slopeDecade || a.name.localeCompare(b.name);
  });
}

/** Card heading: the most common `type` of the country, pluralised ("Provinces", "States"); "Regions" if none. */
export function provinceHeading(types: string[]): string {
  const count = new Map<string, number>();
  for (const t of types) {
    const s = t.trim();
    if (s) count.set(s, (count.get(s) ?? 0) + 1);
  }
  let best = '';
  let bestN = 0;
  count.forEach((n, t) => {
    if (n > bestN) {
      best = t;
      bestN = n;
    }
  });
  if (!best) return 'Regions';
  const w = best.charAt(0).toUpperCase() + best.slice(1);
  if (/(s|x|ch|sh)$/i.test(w)) return w;
  if (/[^aeiou]y$/i.test(w)) return `${w.slice(0, -1)}ies`;
  return `${w}s`;
}

/** A province ring moved by whole turns of 360 degrees into the longitude frame of a wrapping country. */
export function frameRing(ring: Ring, wrapRef: number | null): Ring {
  if (wrapRef === null) return ring;
  let a = Infinity;
  let b = -Infinity;
  for (const p of ring) {
    if (p[0] < a) a = p[0];
    if (p[0] > b) b = p[0];
  }
  const sh = 360 * Math.round((wrapRef - (a + b) / 2) / 360);
  return sh ? ring.map((p): [number, number] => [p[0] + sh, p[1]]) : ring;
}
