/**
 * Pure functions for recomputing the trend map in the browser for an arbitrary period, from the coarse annual
 * grid exported by pipeline/export_annual_grid.py. Mirrors pipeline/export.py (bilinear_to_pixels,
 * overlay_rgb, round_up_2sig) and pipeline/trendstats.py (bh_adjust).
 */
import { trend } from './stats/trend';

export interface AnnualMeta {
  nlat: number;
  nlon: number;
  lat0: number;
  dlat: number;
  lon0: number;
  dlon: number;
  years: [number, number];
  scale: number;
  units: string;
}

export const ALPHA = 0.05;
export const TEX_W = 1440;
export const TEX_H = 720;

/** Parse {VAR}_annual.bin: Int16 little-endian, order [year][lat][lon]. */
export function parseAnnualBin(buf: ArrayBuffer, meta: AnnualMeta): Int16Array {
  const ny = meta.years[1] - meta.years[0] + 1;
  const n = ny * meta.nlat * meta.nlon;
  if (buf.byteLength !== 2 * n) {
    throw new Error(`annual grid size mismatch: ${buf.byteLength} bytes, expected ${2 * n}`);
  }
  const out = new Int16Array(n);
  const dv = new DataView(buf);
  for (let i = 0; i < n; i++) out[i] = dv.getInt16(2 * i, true); // explicit little-endian
  return out;
}

/** Copy the years [y0, y1] (inclusive, array indices) and cells [c0, c1) into a compact [year][cell] array. */
export function extractChunk(
  data: Int16Array,
  ncells: number,
  yi0: number,
  yi1: number,
  c0: number,
  c1: number,
): Int16Array {
  const ny = yi1 - yi0 + 1;
  const nc = c1 - c0;
  const out = new Int16Array(ny * nc);
  for (let k = 0; k < ny; k++) {
    const src = (yi0 + k) * ncells + c0;
    out.set(data.subarray(src, src + nc), k * nc);
  }
  return out;
}

export interface CellStats {
  /** Sen slope per decade. */
  slope: Float64Array;
  p: Float64Array;
}

/** trend() on every cell of a [year][cell] chunk. `years` are the calendar years of the chunk's rows. */
export function computeChunk(
  chunk: Int16Array,
  years: number[],
  nc: number,
  scale: number,
  onProgress?: (done: number) => void,
): CellStats {
  const ny = years.length;
  const slope = new Float64Array(nc);
  const p = new Float64Array(nc);
  const y = new Array<number>(ny);
  for (let c = 0; c < nc; c++) {
    for (let k = 0; k < ny; k++) y[k] = chunk[k * nc + c] * scale;
    const r = trend(y, years);
    slope[c] = r.slope * 10;
    p[c] = r.p;
    if (onProgress && (c & 1023) === 1023) onProgress(c + 1);
  }
  if (onProgress) onProgress(nc);
  return { slope, p };
}

/** Whole-grid, single-thread version (used by tests; the app splits the cells across workers). */
export function computeCells(data: Int16Array, meta: AnnualMeta, start: number, end: number): CellStats {
  const ncells = meta.nlat * meta.nlon;
  const yi0 = start - meta.years[0];
  const yi1 = end - meta.years[0];
  const years: number[] = [];
  for (let yr = start; yr <= end; yr++) years.push(yr);
  return computeChunk(extractChunk(data, ncells, yi0, yi1, 0, ncells), years, ncells, meta.scale);
}

/** Benjamini-Hochberg adjusted p-values over all finite entries; NaN stays NaN (pipeline/trendstats.py bh_adjust). */
export function bhAdjust(p: ArrayLike<number>): Float64Array {
  const n = p.length;
  const q = new Float64Array(n).fill(NaN);
  const idx: number[] = [];
  for (let i = 0; i < n; i++) if (Number.isFinite(p[i])) idx.push(i);
  const m = idx.length;
  if (m === 0) return q;
  idx.sort((a, b) => p[a] - p[b] || a - b);
  let running = Infinity;
  for (let r = m - 1; r >= 0; r--) {
    const v = (p[idx[r]] * m) / (r + 1);
    if (v < running) running = v;
    q[idx[r]] = Math.min(running, 1);
  }
  return q;
}

/** Round up to 2 significant figures (pipeline/export.py round_up_2sig). Non-positive/NaN -> 1. */
export function roundUp2Sig(v: number): number {
  if (!(v > 0)) return 1;
  const e = Math.floor(Math.log10(v)) - 1;
  const scaled = Number((v / Math.pow(10, e)).toFixed(9));
  const out = Math.ceil(scaled) * Math.pow(10, e);
  return Number(out.toFixed(Math.max(0, -e)));
}

/** np.percentile (linear interpolation) of the finite values. */
export function percentile(values: ArrayLike<number>, q: number): number {
  const fin: number[] = [];
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) fin.push(values[i]);
  if (fin.length === 0) return NaN;
  fin.sort((a, b) => a - b);
  const pos = ((fin.length - 1) * q) / 100;
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, fin.length - 1);
  return fin[lo] + (pos - lo) * (fin[hi] - fin[lo]);
}

/** vmax = 98th percentile of |slope per decade| over finite cells, rounded up to 2 significant figures. */
export function symmetricVmax(slope: ArrayLike<number>): number {
  const abs: number[] = [];
  for (let i = 0; i < slope.length; i++) if (Number.isFinite(slope[i])) abs.push(Math.abs(slope[i]));
  return roundUp2Sig(percentile(abs, 98));
}

/** cos(lat)-weighted fraction of finite cells with q < alpha. Cells are [lat][lon] row-major. */
export function fracSignificant(q: ArrayLike<number>, slope: ArrayLike<number>, meta: AnnualMeta): number {
  let num = 0;
  let den = 0;
  for (let i = 0; i < meta.nlat; i++) {
    const w = Math.cos(((meta.lat0 + i * meta.dlat) * Math.PI) / 180);
    for (let j = 0; j < meta.nlon; j++) {
      const k = i * meta.nlon + j;
      if (!Number.isFinite(slope[k])) continue;
      den += w;
      if (q[k] < ALPHA) num += w;
    }
  }
  return den > 0 ? num / den : 0;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

/** Linear interpolation between equally spaced colour stops, x in [0, 1]. Returns r, g, b in 0..1. */
export function interpStops(stops: [number, number, number][], x: number): [number, number, number] {
  const n = stops.length - 1;
  const pos = Math.min(Math.max(x, 0), 1) * n;
  const k = Math.min(Math.floor(pos), n - 1);
  const f = pos - k;
  const a = stops[k];
  const b = stops[k + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** Bilinear sample of a [lat][lon] grid at one point: longitude wraps, latitude clamps (bilinear_to_pixels). */
export function bilinearAt(
  grid: ArrayLike<number>,
  meta: Pick<AnnualMeta, 'nlat' | 'nlon' | 'lat0' | 'dlat' | 'lon0' | 'dlon'>,
  lat: number,
  lng: number,
): number {
  const { nlat, nlon, lat0, dlat, lon0, dlon } = meta;
  const fi = Math.min(Math.max((lat - lat0) / dlat, 0), nlat - 1);
  const i0 = Math.min(Math.floor(fi), nlat - 2);
  const wi = fi - i0;
  const fj = (lng - lon0) / dlon;
  const j0f = Math.floor(fj);
  const wj = fj - j0f;
  const j0 = ((j0f % nlon) + nlon) % nlon;
  const j1 = (j0 + 1) % nlon;
  const top = grid[i0 * nlon + j0] * (1 - wj) + grid[i0 * nlon + j1] * wj;
  const bot = grid[(i0 + 1) * nlon + j0] * (1 - wj) + grid[(i0 + 1) * nlon + j1] * wj;
  return top * (1 - wi) + bot * wi;
}

/** Bilinear resample of a [lat][lon] grid to a width x height image (row 0 = north, column 0 starts at -180). */
export function bilinearToPixels(
  grid: ArrayLike<number>,
  meta: Pick<AnnualMeta, 'nlat' | 'nlon' | 'lat0' | 'dlat' | 'lon0' | 'dlon'>,
  width = TEX_W,
  height = TEX_H,
): Float64Array {
  const out = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    const lat = 90 - ((y + 0.5) * 180) / height;
    for (let x = 0; x < width; x++) {
      const lng = -180 + ((x + 0.5) * 360) / width;
      out[y * width + x] = bilinearAt(grid, meta, lat, lng);
    }
  }
  return out;
}

/** The `render` block of {VAR}_meta.json: constants of the overlay rule (pipeline/config.py). */
export interface RenderConfig {
  basemap: string;
  color_floor: number;
  alpha_max: number;
  alpha_full_at: number;
  ocean: string;
  land: string;
}

/**
 * THE overlay rule, mirror of pipeline/export.py overlay_rgb (tied by pipeline/tests/fixtures/overlay_cases.json).
 * x = min(|s|/vmax, 1); colour position (sign(s) * (floor + (1 - floor) x) + 1) / 2 on the colormap (linear
 * interpolation between the stops); alpha = alpha_max * w * min(x / alpha_full_at, 1); out = (1 - alpha) base +
 * alpha colour. `base` is RGBA (alpha ignored); non-finite slope -> base. Returns opaque RGBA pixels.
 */
export function overlayPixels(
  slope: ArrayLike<number>,
  w: ArrayLike<number>,
  vmax: number,
  stopsHex: string[],
  base: ArrayLike<number>,
  render: Pick<RenderConfig, 'color_floor' | 'alpha_max' | 'alpha_full_at'>,
): Uint8ClampedArray {
  const stops = stopsHex.map(hexToRgb);
  const n = slope.length;
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const s = slope[i];
    let r = base[o];
    let g = base[o + 1];
    let b = base[o + 2];
    if (Number.isFinite(s) && s !== 0) {
      const x = Math.min(Math.abs(s) / vmax, 1);
      const wt = Number.isFinite(w[i]) ? w[i] : 0;
      const alpha = render.alpha_max * wt * Math.min(x / render.alpha_full_at, 1);
      if (alpha > 0) {
        const t = Math.sign(s) * (render.color_floor + (1 - render.color_floor) * x);
        const [cr, cg, cb] = interpStops(stops, (t + 1) / 2);
        r = (1 - alpha) * r + alpha * cr * 255;
        g = (1 - alpha) * g + alpha * cg * 255;
        b = (1 - alpha) * b + alpha * cb * 255;
      }
    }
    out[o] = Math.floor(r + 0.5);
    out[o + 1] = Math.floor(g + 0.5);
    out[o + 2] = Math.floor(b + 0.5);
    out[o + 3] = 255;
  }
  return out;
}

export interface RangeResult {
  variable: string;
  start: number;
  end: number;
  meta: AnnualMeta;
  slope: Float64Array;
  p: Float64Array;
  q: Float64Array;
  vmax: number;
  fracSignificant: number;
  /** Texture pixels (TEX_W x TEX_H RGBA). */
  rgba: Uint8ClampedArray;
}

/** From per-cell slope/p to q, vmax, significance fraction and the RGBA texture. */
export function finishResult(
  variable: string,
  start: number,
  end: number,
  meta: AnnualMeta,
  stats: CellStats,
  stopsHex: string[],
  base: Uint8ClampedArray,
  render: RenderConfig,
): RangeResult {
  const q = bhAdjust(stats.p);
  const vmax = symmetricVmax(stats.slope);
  const sig = new Float64Array(q.length);
  for (let i = 0; i < q.length; i++) sig[i] = q[i] < ALPHA ? 1 : 0;
  const rgba = overlayPixels(bilinearToPixels(stats.slope, meta), bilinearToPixels(sig, meta), vmax, stopsHex, base, render);
  return {
    variable,
    start,
    end,
    meta,
    slope: stats.slope,
    p: stats.p,
    q,
    vmax,
    fracSignificant: fracSignificant(q, stats.slope, meta),
    rgba,
  };
}

/** Nearest coarse cell (latitude clamps, longitude wraps). */
export function nearestCell(meta: AnnualMeta, lat: number, lng: number): { i: number; j: number } {
  const i = Math.min(Math.max(Math.round((lat - meta.lat0) / meta.dlat), 0), meta.nlat - 1);
  const j = ((Math.round((lng - meta.lon0) / meta.dlon) % meta.nlon) + meta.nlon) % meta.nlon;
  return { i, j };
}

export function valueAtResult(r: RangeResult, lat: number, lng: number) {
  const { i, j } = nearestCell(r.meta, lat, lng);
  const k = i * r.meta.nlon + j;
  return {
    lat: r.meta.lat0 + i * r.meta.dlat,
    lng: r.meta.lon0 + j * r.meta.dlon,
    slopeDecade: r.slope[k],
    p: r.p[k],
    q: r.q[k],
    n: r.end - r.start + 1,
  };
}
