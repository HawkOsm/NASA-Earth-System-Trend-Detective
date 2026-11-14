/**
 * Continents and "the world" as places: the pre-computed regions.json (pipeline/regions.py) turned into the same
 * ranked list the Detective shows for a point. Pure functions plus one loader (no React).
 *
 * Every number comes from regions.json (the trend of the cos(latitude)-weighted mean annual series over the region's
 * land cells, and the share of cells where the map shows a significant trend). Ranking is the one of whatsChanging.ts:
 * significant first, then possible, then no clear trend; inside a tier by |slope| / the variable's own `spread` from
 * summary.json; remaining ties by the order of the variables on the site.
 */
import { dataUrl } from './data';
import { rateUnits, rateUnitsLong } from './format';
import { type VerdictKind } from './stats/trend';
import { effectiveKind, effectiveVerdict } from './verdicts';
import type { VarQuality } from './quality';
import type { NoDataEntry, RankResult, RankedEntry, SummaryMeta } from './whatsChanging';

export interface RegionVar {
  slopePerDecade: number;
  ciLow: number;
  ciHigh: number;
  p: number;
  /** Cells of the region (all variables). */
  nCells: number;
  /** Cells of the region with a value in every year (the series is the weighted mean over these). */
  nWithData: number;
  /** Area-weighted share (0..1) of the cells with data where the map shows a significant rise / fall (BH q < 0.05). */
  fracRising: number;
  fracFalling: number;
  /** Quality checks of the region's series (pipeline/export_quality.py); absent in an older regions.json. */
  quality?: { step: boolean; oneYear: boolean; reversal: boolean; endSensitive: boolean; grade: VarQuality['grade']; stepYear: number | null; outlierYear: number | null };
}

export interface RegionRec {
  name: string;
  /** [lat, lng] the camera flies to. */
  centre: [number, number];
  /** Camera altitude (globe radii) that shows the region. */
  altitude: number;
  nCells: number;
  /** Names (as in countries.json) of its most populous countries, most populous first (may be empty). */
  topCountries: string[];
  variables: Record<string, RegionVar | null>;
}

export interface RegionsFile {
  years: [number, number];
  regions: RegionRec[];
}

/** Rough size of a full-resolution grid cell in km (0.5 x 0.625 degrees). */
export const REGION_CELL_KM = 50;

/** "4514" -> "4,514" (fixed format, independent of the browser's locale). */
export function groupDigits(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const TIER: Record<VerdictKind, number> = { significant: 0, possible: 1, none: 2 };

/** The second sentence of a region line, from the map shares and the cell counts ('' when there is nothing to add). */
export function shareSentence(rec: RegionRec, v: RegionVar): string {
  const world = rec.name === 'World';
  const partial = v.nWithData < 0.95 * v.nCells;
  const parts: string[] = [];
  if (partial) parts.push(`Based on the ${groupDigits(v.nWithData)} of ${groupDigits(v.nCells)} cells that have data.`);
  const rise = v.fracRising >= 0.01;
  const fall = v.fracFalling >= 0.01;
  if (rise || fall) {
    const where = partial ? 'of those cells' : world ? 'of the land' : 'of its land';
    const pct = (f: number) => `${Math.round(f * 100)}%`;
    const what = [rise ? `a significant rise on ${pct(v.fracRising)}` : '', fall ? `a significant fall on ${pct(v.fracFalling)}` : ''];
    // "rise on 12% of its land and a significant fall on 8%": the place words go after the first share only.
    const text = rise && fall ? `${what[0]} ${where} and ${what[1]}` : `${what[0] || what[1]} ${where}`;
    parts.push(`The map shows ${text}.`);
  }
  return parts.join(' ');
}

/** Smallest share of a region's cells that must have data for a variable to be reported for the region. */
export const MIN_COVERAGE = 0.05;

/**
 * The ranked list for one region, in the shape `rankAt` returns for a point (so buildAnswer / plainLine / the verdict
 * wording are reused), plus the second sentence of each line. A variable without a value for the region (sea ice)
 * is listed as "no data".
 */
export function regionRank(rec: RegionRec, meta: SummaryMeta): { rank: RankResult; extras: Map<string, string>; qualities: Map<string, VarQuality> } {
  const ranked: RankedEntry[] = [];
  const noData: NoDataEntry[] = [];
  const extras = new Map<string, string>();
  const qualities = new Map<string, VarQuality>();
  const order = new Map<string, number>();
  meta.variables.forEach((v, idx) => {
    order.set(v.variable, idx);
    const r = rec.variables[v.variable];
    // A value resting on under 5% of the region's cells (soil moisture from 3 of Antarctica's 19,091 cells) says
    // nothing about the region: treat it as no data rather than report a "continent-wide" trend.
    if (!r || r.nWithData < MIN_COVERAGE * r.nCells) {
      noData.push({ variable: v.variable, label: v.label, surface: v.surface });
      return;
    }
    const kind = effectiveKind(r.slopePerDecade, r.p);
    ranked.push({
      variable: v.variable,
      label: v.label,
      slopePerDecade: r.slopePerDecade,
      units: `${rateUnitsLong(v.units)} per decade`,
      unitsShort: rateUnits(v.units),
      p: r.p,
      pAdjusted: r.p,
      verdict: effectiveVerdict(r.slopePerDecade, r.p, rateUnitsLong(v.units)),
      kind,
      direction: r.slopePerDecade > 0 ? 'rising' : r.slopePerDecade < 0 ? 'falling' : 'flat',
      strength: v.spread > 0 ? Math.abs(r.slopePerDecade) / v.spread : 0,
    });
    const extra = shareSentence(rec, r);
    if (extra) extras.set(v.variable, extra);
    if (r.quality) {
      const { grade, stepYear, outlierYear, ...flags } = r.quality;
      qualities.set(v.variable, { grade, flags, stepYear, outlierYear });
    }
  });
  ranked.sort((a, b) => TIER[a.kind] - TIER[b.kind] || b.strength - a.strength || order.get(a.variable)! - order.get(b.variable)!);
  return { rank: { cell: { lat: rec.centre[0], lng: rec.centre[1] }, cellKm: REGION_CELL_KM, ranked, noData }, extras, qualities };
}

let cached: Promise<RegionRec[]> | null = null;

/** Fetch regions.json once; a failure is not cached, so a retry works. */
export function loadRegions(): Promise<RegionRec[]> {
  if (!cached) {
    cached = fetch(dataUrl('regions.json'))
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load regions.json: HTTP ${res.status}`);
        return res.json() as Promise<RegionsFile>;
      })
      .then((f) => f.regions)
      .catch((err) => {
        cached = null;
        throw err;
      });
  }
  return cached;
}
