/**
 * "What is changing here?": every variable at one place, ranked. Pure functions plus one loader (no React).
 *
 * Data: summary.bin + summary.json (pipeline/maps/export_summary.py): for each cell of the coarse annual grid (288 x 181,
 * 1.25 x 1.0 deg, about 100 km) and each variable, the Theil-Sen slope per decade, the Mann-Kendall p-value and the
 * Benjamini-Hochberg adjusted p-value for the whole 1981-2025 period. Only cells with data are stored.
 *
 * The numbers describe the ~100 km grid box around the place, so they can differ slightly from the 50 km cell a click
 * on the globe shows (see `cellKm` on the rank result).
 *
 * Ranking (documented in README, Method): significant (p < 0.05) first, then possible (0.05 to 0.10), then no clear
 * trend, using the same `verdictKind` thresholds as the click panel; inside a tier by `strength` = |slope per decade|
 * divided by that variable's own spread (the 98th percentile of |slope| over its cells with data, so variables with
 * different units are comparable), largest first; remaining ties by the order of the variables on the site.
 */
import { signedRate } from '../point/analysis';
import { dataUrl } from '../data/data';
import { rateUnits, rateUnitsLong } from '../data/format';
import { fmtP, type VerdictKind } from '../stats/trend';
import { effectiveKind, effectiveVerdict } from '../point/verdicts';

export interface SummaryVariable {
  variable: string;
  label: string;
  /** Base units of the variable ("C", "mm/day", "%"). */
  units: string;
  unitsShort: string;
  group: string;
  surface: string;
  count: number;
  /** 98th percentile of |slope per decade| over the cells with data. */
  spread: number;
  bitmapOffset: number;
  slopeOffset: number;
  pOffset: number;
  qOffset: number;
}

export interface SummaryMeta {
  nlat: number;
  nlon: number;
  lat0: number;
  dlat: number;
  lon0: number;
  dlon: number;
  years: [number, number];
  /** Rough size of a cell in km (the coarse grid): say "the roughly 100 km area around ...". */
  cellKm: number;
  variables: SummaryVariable[];
}

interface Block {
  meta: SummaryVariable;
  /** cell index -> row in the arrays, or -1 when the cell has no data. */
  rowOf: Int32Array;
  slope: Float32Array;
  p: Float32Array;
  q: Uint16Array;
}

export interface Summary extends SummaryMeta {
  blocks: Block[];
}

export interface RankedEntry {
  variable: string;
  label: string;
  slopePerDecade: number;
  /** Per-decade units in words, as the verdict sentence uses them ("°C per decade", "percentage points per decade"). */
  units: string;
  /** Short form of the rate units ("°C", "% pts"). */
  unitsShort: string;
  p: number;
  /** Benjamini-Hochberg adjusted p-value (stored as Uint16, error <= 1/65535). */
  pAdjusted: number;
  /** The one-sentence verdict of the click panel (stats/trend.ts verdict()). */
  verdict: string;
  kind: VerdictKind;
  direction: 'rising' | 'falling' | 'flat';
  /** |slope| / the variable's own spread. */
  strength: number;
}

export interface NoDataEntry {
  variable: string;
  label: string;
  surface: string;
}

export interface RankResult {
  /** Centre of the coarse cell the numbers belong to. */
  cell: { lat: number; lng: number };
  cellKm: number;
  ranked: RankedEntry[];
  /** Variables with no value in this cell (never shown as zero or as a trend). */
  noData: NoDataEntry[];
}

/** Parse summary.json + summary.bin. Throws on a wrong size. */
export function parseSummary(meta: SummaryMeta & { bytes?: number }, buf: ArrayBuffer): Summary {
  if (meta.bytes !== undefined && meta.bytes !== buf.byteLength) {
    throw new Error(`summary.bin has ${buf.byteLength} bytes, expected ${meta.bytes}`);
  }
  const ncell = meta.nlat * meta.nlon;
  const bytes = new Uint8Array(buf);
  const dv = new DataView(buf);
  const blocks = meta.variables.map((v): Block => {
    const rowOf = new Int32Array(ncell).fill(-1);
    let n = 0;
    for (let k = 0; k < ncell; k++) {
      if ((bytes[v.bitmapOffset + (k >> 3)] >> (k & 7)) & 1) rowOf[k] = n++;
    }
    if (n !== v.count) throw new Error(`summary: ${v.variable} has ${n} cells in the bitmap, expected ${v.count}`);
    const slope = new Float32Array(n);
    const p = new Float32Array(n);
    const q = new Uint16Array(n);
    for (let r = 0; r < n; r++) {
      slope[r] = dv.getFloat32(v.slopeOffset + 4 * r, true);
      p[r] = dv.getFloat32(v.pOffset + 4 * r, true);
      q[r] = dv.getUint16(v.qOffset + 2 * r, true);
    }
    return { meta: v, rowOf, slope, p, q };
  });
  return { ...meta, blocks };
}

/** Nearest coarse cell: [lat index, lon index] (longitude wraps, latitude is clamped to the grid). */
export function nearestCell(s: SummaryMeta, lat: number, lng: number): [number, number] {
  const i = Math.min(s.nlat - 1, Math.max(0, Math.round((lat - s.lat0) / s.dlat)));
  const j = ((Math.round((lng - s.lon0) / s.dlon) % s.nlon) + s.nlon) % s.nlon;
  return [i, j];
}

const TIER: Record<VerdictKind, number> = { significant: 0, possible: 1, none: 2 };

/** Rank every variable at the coarse cell nearest to (lat, lng). Synchronous. */
export function rankAt(s: Summary, lat: number, lng: number): RankResult {
  const [i, j] = nearestCell(s, lat, lng);
  const k = i * s.nlon + j;
  const ranked: RankedEntry[] = [];
  const noData: NoDataEntry[] = [];
  const order = new Map<string, number>();
  s.blocks.forEach((b, idx) => {
    const v = b.meta;
    order.set(v.variable, idx);
    const r = b.rowOf[k];
    if (r < 0) {
      noData.push({ variable: v.variable, label: v.label, surface: v.surface });
      return;
    }
    const slope = b.slope[r];
    const p = b.p[r];
    const kind = effectiveKind(slope, p);
    ranked.push({
      variable: v.variable,
      label: v.label,
      slopePerDecade: slope,
      units: `${rateUnitsLong(v.units)} per decade`,
      unitsShort: rateUnits(v.units),
      p,
      pAdjusted: b.q[r] / 65535,
      verdict: effectiveVerdict(slope, p, rateUnitsLong(v.units)),
      kind,
      direction: slope > 0 ? 'rising' : slope < 0 ? 'falling' : 'flat',
      strength: v.spread > 0 ? Math.abs(slope) / v.spread : 0,
    });
  });
  ranked.sort(
    (a, b) => TIER[a.kind] - TIER[b.kind] || b.strength - a.strength || order.get(a.variable)! - order.get(b.variable)!,
  );
  return { cell: { lat: s.lat0 + i * s.dlat, lng: s.lon0 + j * s.dlon }, cellKm: s.cellKm, ranked, noData };
}

/** One plain line, e.g. "Hottest temperature of the year: +0.38 °C per decade — possible trend (p = 0.07)". */
export function plainLine(e: RankedEntry): string {
  const rate = e.slopePerDecade === 0 ? `0.00 ${e.units}` : `${signedRate(e.slopePerDecade)} ${e.units}`;
  const tail =
    e.kind === 'significant'
      ? `statistically significant (${fmtP(e.p)})`
      : e.kind === 'possible'
        ? `possible trend (${fmtP(e.p)})`
        : `no clear trend (${fmtP(e.p)})`;
  return `${e.label}: ${rate} — ${tail}`;
}

let cached: Promise<Summary> | null = null;

/** Fetch summary.json and summary.bin once; a failure is not cached, so a retry works. */
export function loadSummary(): Promise<Summary> {
  if (!cached) {
    const get = async (file: string) => {
      const res = await fetch(dataUrl(file));
      if (!res.ok) throw new Error(`Failed to load ${file}: HTTP ${res.status}`);
      return res;
    };
    cached = Promise.all([get('summary.json').then((r) => r.json() as Promise<SummaryMeta>), get('summary.bin').then((r) => r.arrayBuffer())])
      .then(([meta, buf]) => parseSummary(meta, buf))
      .catch((err) => {
        cached = null;
        throw err;
      });
  }
  return cached;
}
