/**
 * Sea and ocean pieces: pure helpers (mask lookup, cells.bin parsing, frame, city selection, land rim) and lazy
 * loaders for the static files written by pipeline/areas/seas.py. A sea reuses the country overlay: `seaAsRec` turns a
 * sea record into a CountryRec carrying a `sea` field. No network except same-origin static files.
 */
import { dataUrl } from '../data/data';
import { toLandPolygons, type LandPolygon, type Ring } from '../point/detail';
import {
  NO_COUNTRY,
  continuousLon,
  frameLng,
  nearestCellIndex,
  NLON,
  normalisePolygon,
  parseInt16Series,
  type CityRec,
  type CountryRec,
} from './country';

export const NO_SEA = NO_COUNTRY;
/** Coarse (ocean) cells are 1.0 x 1.25 degrees, about 100 km; the others are 0.5 x 0.625, about 50 km. */
export const COARSE_DLAT = 1.0;
export const MAX_SEA_CITIES = 12;

export interface SeaRec {
  idx: number;
  name: string;
  kind: string;
  nCells: number;
  dlat: number;
  dlng: number;
  /** [latMin, latMax, lngMin, lngMax] of the cell centres; for `wraps` the longitudes are unwrapped (may exceed 180). */
  bbox: [number, number, number, number];
  /** A water cell near the middle of the sea. */
  centre: [number, number];
  wraps: boolean;
}

export interface Frame {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
}

// ---- lookup --------------------------------------------------------------------------------------------------------

/** Sea index at the nearest full-resolution grid point (longitude wraps), or undefined. */
export function seaAt(mask: Uint8Array, lat: number, lng: number): number | undefined {
  const { i, j } = nearestCellIndex(lat, lng);
  const v = mask[i * NLON + j];
  return v === NO_SEA ? undefined : v;
}

/** The sea under a click, or undefined (land, water in no polygon, or a sea with no cell). */
export function pickSea(mask: Uint8Array, recs: SeaRec[], lat: number, lng: number): SeaRec | undefined {
  const idx = seaAt(mask, lat, lng);
  const rec = idx === undefined ? undefined : recs[idx];
  return rec && rec.nCells > 0 ? rec : undefined;
}

/** Case-insensitive lookup by index or name (a sea with no cell is never returned). */
export function findSea(recs: SeaRec[], nameOrIdx: string | number): SeaRec | undefined {
  const ok = (r: SeaRec | undefined) => (r && r.nCells > 0 ? r : undefined);
  if (typeof nameOrIdx === 'number') return ok(recs.find((r) => r.idx === nameOrIdx));
  const s = nameOrIdx.trim().toLowerCase();
  if (/^\d+$/.test(s)) return ok(recs.find((r) => r.idx === Number(s)));
  return ok(recs.find((r) => r.name.toLowerCase() === s) ?? recs.find((r) => r.name.toLowerCase().startsWith(s)));
}

/** Float32 LE pairs [lat, lng] -> cells (lat ascending, then lng ascending, as written). */
export function parseSeaCells(buf: ArrayBuffer): [number, number][] {
  const n = Math.floor(buf.byteLength / 8);
  const dv = new DataView(buf);
  const out: [number, number][] = [];
  for (let k = 0; k < n; k++) out.push([dv.getFloat32(k * 8, true), dv.getFloat32(k * 8 + 4, true)]);
  return out;
}

/** True for the coarse (ocean) grid. */
export const isCoarse = (rec: { dlat: number }): boolean => rec.dlat > 0.75;

/** "about 50 km" or "about 100 km". */
export const cellKm = (rec: { dlat: number }): number => (isCoarse(rec) ? 100 : 50);

// ---- frame ---------------------------------------------------------------------------------------------------------

/** The piece's frame: the bbox of the cell centres plus a margin of 8% of each span (at least 1 degree). */
export function seaFrame(rec: Pick<SeaRec, 'bbox'>): Frame {
  const [la0, la1, lo0, lo1] = rec.bbox;
  const mLat = Math.max(1, 0.08 * (la1 - la0));
  const mLng = Math.max(1, 0.08 * (lo1 - lo0));
  return { latMin: Math.max(-90, la0 - mLat), latMax: Math.min(90, la1 + mLat), lngMin: lo0 - mLng, lngMax: lo1 + mLng };
}

/** The frame as one rectangular polygon, so the country fit (`fitCountryProjection`) can be used as it is. */
export function frameRect(f: Frame): Ring[][] {
  return [[[[f.lngMin, f.latMin], [f.lngMax, f.latMin], [f.lngMax, f.latMax], [f.lngMin, f.latMax], [f.lngMin, f.latMin]]]];
}

/** Longitude frame reference for a wrapping sea (null: longitudes are used as they are). */
export function seaWrapRef(rec: { wraps?: boolean; bbox: [number, number, number, number] }): number | null {
  return rec.wraps ? 0.5 * (rec.bbox[2] + rec.bbox[3]) : null;
}

/** A sea record as a CountryRec for the shared overlay (idx is the SEA index). */
export function seaAsRec(s: SeaRec): CountryRec {
  return {
    idx: s.idx,
    name: s.name,
    iso: null,
    nCells: s.nCells,
    tiny: false,
    bbox: s.bbox,
    centre: s.centre,
    tinyCell: null,
    wraps: s.wraps,
    sea: { kind: s.kind, dlat: s.dlat, dlng: s.dlng },
  };
}

/** Cities inside the frame (longitudes compared in the sea's frame), the `max` most populous first. */
export function citiesInFrame<T extends CityRec>(cities: T[], frame: Frame, wrapRef: number | null, max = MAX_SEA_CITIES): T[] {
  return cities
    .filter((c) => {
      const lng = wrapRef === null ? c.lng : frameLng(c.lng, wrapRef);
      return c.lat >= frame.latMin && c.lat <= frame.latMax && lng >= frame.lngMin && lng <= frame.lngMax;
    })
    .sort((a, b) => b.pop - a.pop || a.id - b.id)
    .slice(0, max);
}

// ---- land rim ------------------------------------------------------------------------------------------------------

/**
 * Natural Earth land made planar: a ring that crosses +-180 has its longitudes unwrapped (it then reaches past 180),
 * and the Antarctic coast (a ring that goes right round without closing) is closed through the pole. The result is
 * drawn at shifts of -360, 0 and +360 degrees (see `landShifts`).
 */
export function normaliseLand(land: LandPolygon[]): LandPolygon[] {
  const polys = land.map((l) => {
    const outer = l.rings[0];
    const c = continuousLon(outer);
    const open = Math.abs(c[c.length - 1][0] - c[0][0]) > 1;
    const south = outer.some((p) => p[1] < -60);
    if (open && south) {
      const last = c[c.length - 1];
      return [[...c, [last[0], -90], [c[0][0], -90], c[0]] as Ring, ...l.rings.slice(1)];
    }
    return normalisePolygon(l.rings).rings;
  });
  return toLandPolygons(polys as unknown as number[][][][]);
}

/** Land polygons that touch the frame, with the longitude shift (-360, 0 or 360) that brings them into it. */
export function landShifts(land: LandPolygon[], f: Frame): { poly: LandPolygon; shift: number }[] {
  const out: { poly: LandPolygon; shift: number }[] = [];
  for (const poly of land) {
    for (const shift of [-360, 0, 360]) {
      if (poly.bbox[2] + shift >= f.lngMin && poly.bbox[0] + shift <= f.lngMax && poly.bbox[3] >= f.latMin && poly.bbox[1] <= f.latMax) {
        out.push({ poly, shift });
      }
    }
  }
  return out;
}

// ---- colours -------------------------------------------------------------------------------------------------------

/** `a` mixed with `b` (both 0..255 triples) by `t`; used for the darkened water and muted land around a sea. */
export function mixRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// ---- lazy loaders --------------------------------------------------------------------------------------------------

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

export const loadSeaMask = once(async () => new Uint8Array(await (await fetchOk('sea_mask.bin')).arrayBuffer()));
export const loadSeas = once(async () => (await (await fetchOk('seas.json')).json()) as SeaRec[]);
/** Polygons of every sea: { idx: [polygon: [ring: [lng, lat][]]] }. */
export const loadSeaOutlines = once(async () => (await (await fetchOk('seas/outlines.json')).json()) as Record<string, number[][][][]>);

const cellCache = new Map<number, Promise<[number, number][]>>();
export function loadSeaCells(idx: number): Promise<[number, number][]> {
  let p = cellCache.get(idx);
  if (!p) {
    p = fetchOk(`seas/${idx}.cells.bin`).then((r) => r.arrayBuffer()).then(parseSeaCells);
    p.catch(() => cellCache.delete(idx));
    cellCache.set(idx, p);
  }
  return p;
}

const seriesCache = new Map<string, Promise<number[][]>>();
export function loadSeaSeries(variable: string, idx: number, nYears: number, offset = 0): Promise<number[][]> {
  const key = `${variable}/${idx}`;
  let p = seriesCache.get(key);
  if (!p) {
    p = fetchOk(`seas/${variable}/${idx}.bin`).then((r) => r.arrayBuffer()).then((b) => parseInt16Series(b, nYears, offset));
    p.catch(() => seriesCache.delete(key));
    seriesCache.set(key, p);
  }
  return p;
}
