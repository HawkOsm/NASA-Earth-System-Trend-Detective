/**
 * Pure logic for the close-up map (each grid cell's own trend around the selected spot) and for the
 * camera-altitude rule used when a location is picked.
 */
import { MIN_YEARS } from './analysis';
import { filterToPeriod, type Period } from './period';
import type { RegionBox, RegionCell } from './region';
import { hexToRgb, interpStops } from './rangeMap';
import { trend } from './stats/trend';

/** Grid-cell half sizes of the POWER (MERRA-2) grid, degrees. */
export const CELL_HALF_LAT = 0.25;
export const CELL_HALF_LNG = 0.3125;
/** Box side used for the close-up when the selection is a single grid cell. */
export const POINT_DETAIL_SIZE = 5;
export const ALPHA_CELL = 0.05;

export interface DetailCell {
  lat: number;
  lng: number;
  /** Trend per decade in the variable's units; null = no data (fewer than MIN_YEARS valid years in the period). */
  slopeDecade: number | null;
  p: number | null;
  /** Number of valid years used. */
  n: number;
}

/** Each cell's own Theil-Sen trend (same `trend()` and period filtering as the side panel). */
export function cellTrends(cells: RegionCell[], years: number[], period: Period): DetailCell[] {
  return cells.map((c) => {
    const { years: ys, values } = filterToPeriod(years, c.annual, period);
    if (ys.length < MIN_YEARS) return { lat: c.lat, lng: c.lng, slopeDecade: null, p: null, n: ys.length };
    const r = trend(values, ys);
    return { lat: c.lat, lng: c.lng, slopeDecade: r.slope * 10, p: r.p, n: ys.length };
  });
}

export interface DetailSummary {
  nCells: number;
  nWithData: number;
  nSignificant: number;
  min: number | null;
  max: number | null;
}

export function isSignificant(c: DetailCell): boolean {
  return c.p !== null && c.p < ALPHA_CELL;
}

export function summarize(cells: DetailCell[]): DetailSummary {
  let nWithData = 0;
  let nSignificant = 0;
  let min: number | null = null;
  let max: number | null = null;
  for (const c of cells) {
    if (c.slopeDecade === null) continue;
    nWithData++;
    if (isSignificant(c)) nSignificant++;
    if (min === null || c.slopeDecade < min) min = c.slopeDecade;
    if (max === null || c.slopeDecade > max) max = c.slopeDecade;
  }
  return { nCells: cells.length, nWithData, nSignificant, min, max };
}

/** Colormap lookup: value / vmax clipped to [-1, 1], linear interpolation between the stops. Returns 0..255 RGB. */
export function cellRgb(slope: number, vmax: number, stops: [number, number, number][]): [number, number, number] {
  const x = Math.min(Math.max(slope / vmax, -1), 1);
  const [r, g, b] = interpStops(stops, (x + 1) / 2);
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

export function parseStops(hex: string[]): [number, number, number][] {
  return hex.map(hexToRgb);
}

/** Opacity of a cell: solid when significant on its own, faded otherwise. */
export function cellAlpha(c: DetailCell): number {
  return isSignificant(c) ? 0.9 : 0.3;
}

// ---- geometry -------------------------------------------------------------------------------------------------

export interface Projection {
  width: number;
  height: number;
  box: RegionBox;
  /** Canvas pixels per degree (same in both directions). */
  scale: number;
}

/** Canvas of the given width for the box, with the same pixels per degree in x and y (north up). */
export function makeProjection(box: RegionBox, width: number): Projection {
  const scale = width / (box.lngMax - box.lngMin);
  return { width, height: (box.latMax - box.latMin) * scale, box, scale };
}

export const projX = (pr: Projection, lng: number): number => (lng - pr.box.lngMin) * pr.scale;
export const projY = (pr: Projection, lat: number): number => (pr.box.latMax - lat) * pr.scale;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Canvas rectangle of the grid cell centred on (lat, lng). */
export function cellRect(pr: Projection, lat: number, lng: number): Rect {
  const x0 = projX(pr, lng - CELL_HALF_LNG);
  const x1 = projX(pr, lng + CELL_HALF_LNG);
  const y0 = projY(pr, lat + CELL_HALF_LAT);
  const y1 = projY(pr, lat - CELL_HALF_LAT);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Index of the cell under a canvas point, or -1. */
export function hitCell(pr: Projection, cells: { lat: number; lng: number }[], x: number, y: number): number {
  let best = -1;
  let bestD = Infinity;
  cells.forEach((c, k) => {
    const r = cellRect(pr, c.lat, c.lng);
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

/** Whole-degree tick values inside [lo, hi] with a step that gives about `target` ticks at most. */
export function degreeTicks(lo: number, hi: number, target = 5): number[] {
  const span = hi - lo;
  let step = 1;
  for (const s of [1, 2, 5, 10, 20]) {
    step = s;
    if (span / s <= target) break;
  }
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(v);
  return out;
}

export function latLabel(lat: number): string {
  return `${Math.abs(lat)}°${lat >= 0 ? 'N' : 'S'}`;
}
export function lngLabel(lng: number): string {
  return `${Math.abs(lng)}°${lng >= 0 ? 'E' : 'W'}`;
}

// ---- camera altitude -------------------------------------------------------------------------------------------

/** Camera altitude (globe radii) that suits an Area size (0 = single grid cell). */
export function targetAltitude(sizeDeg: number): number {
  if (sizeDeg >= 10) return 1.3;
  if (sizeDeg >= 5) return 0.9;
  return 0.7;
}

export const WHOLE_GLOBE_ALTITUDE = 2.2;
export const WHOLE_GLOBE_BUTTON_BELOW = 1.6;

/** Altitude when a location is picked: the target, unless the camera is already closer (then keep it). */
export function pickAltitude(current: number | undefined, sizeDeg: number): number {
  const t = targetAltitude(sizeDeg);
  return current !== undefined && Number.isFinite(current) ? Math.min(current, t) : t;
}

/**
 * Altitude when the Area size changes while a location is selected: zoom out if the new target is higher than
 * the old one (and the camera is closer than it); otherwise the pick rule (zoom in, or keep a closer camera).
 */
export function areaChangeAltitude(current: number | undefined, oldSize: number, newSize: number): number {
  const t = targetAltitude(newSize);
  if (current === undefined || !Number.isFinite(current)) return t;
  if (t > targetAltitude(oldSize)) return Math.max(current, t);
  return Math.min(current, t);
}

// ---- land (Natural Earth 50 m) -----------------------------------------------------------------------------------

export type Ring = [number, number][];
export interface LandPolygon {
  rings: Ring[];
  /** Bounding box of the outer ring: [lngMin, latMin, lngMax, latMax]. */
  bbox: [number, number, number, number];
}

export function toLandPolygons(polys: number[][][][]): LandPolygon[] {
  return polys.map((rings) => {
    let a = Infinity;
    let b = Infinity;
    let c = -Infinity;
    let d = -Infinity;
    for (const [x, y] of rings[0]) {
      if (x < a) a = x;
      if (x > c) c = x;
      if (y < b) b = y;
      if (y > d) d = y;
    }
    return { rings: rings as Ring[], bbox: [a, b, c, d] };
  });
}

export function landInBox(polys: LandPolygon[], box: RegionBox): LandPolygon[] {
  return polys.filter(
    (p) => p.bbox[2] >= box.lngMin && p.bbox[0] <= box.lngMax && p.bbox[3] >= box.latMin && p.bbox[1] <= box.latMax,
  );
}
