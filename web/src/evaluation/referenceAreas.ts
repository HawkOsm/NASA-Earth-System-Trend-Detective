/**
 * The independent check for AREAS (a country, a sea, a continent, the World): public/data/reference/areas_<VAR>.json,
 * written by pipeline/reference_areas.py. The point check of reference.ts averaged over the area: the independent record
 * (NASA GISTEMP / GPCP) and MERRA-2 are both averaged over the same boxes, weighted by the area each box has inside the
 * area; the check applies when those boxes cover at least half of the area. The result has the shape of the point check
 * (RefCheck), so the same badge and sentences render it.
 */
import { dataUrl } from '../data/data';
import {
  boxAt,
  classSentence,
  CUSTOM_PERIOD_TEXT,
  hasReference,
  noReferenceReason,
  referenceCheck,
  type RefCheck,
  type RefData,
} from './reference';
import type { RankResult } from '../detective/whatsChanging';
import type { VerdictKind } from '../stats/trend';

export type AreaKind = 'countries' | 'seas' | 'regions';
export type UncheckedReason = 'coverage' | 'sea';

export interface AreaEntry {
  refSlope: number;
  refP: number;
  merraSlope: number;
  sizeDiffers: boolean;
  /** Share (0..1) of the area (by weight) that the records cover. */
  coverage: number;
  badYears: number[];
  /** The records that cover at least half of the area (first record first): its own numbers over its own boxes. */
  records?: { short: string; refSlope: number; refP: number; coverage: number }[];
}

export interface AreaRefData {
  source: { name: string; short: string; what: string; boxKm: number };
  /** Every record of the variable, in order (an area lists only those that cover it). */
  records?: { short: string; name: string; what: string }[];
  countries: Record<string, AreaEntry>;
  seas: Record<string, AreaEntry>;
  regions: Record<string, AreaEntry>;
  unchecked: { countries: Record<string, UncheckedReason>; seas: Record<string, UncheckedReason>; regions: Record<string, UncheckedReason> };
}

export const COVERAGE_REASON = 'the record covers less than half of this area';

export interface AreaCheck extends RefCheck {
  /** Share of the area the check rests on, or null when not checked. */
  coverage: number | null;
}

export interface AreaCheckInput {
  variable: string;
  data: AreaRefData | null;
  kind: AreaKind;
  /** String index of a country / sea, or the continent's name ("World"). */
  key: string;
  fullPeriod: boolean;
  verdictKind: VerdictKind;
  slope: number;
  unitsLong: string;
  series?: { years: number[]; values: number[] };
}

/** Point wording -> area wording ("for the roughly 220 km box around this place" -> "averaged over the same area"). */
export function areaWording(sentence: string, boxKm: number): string {
  return sentence
    .replace(`, for the roughly ${boxKm} km box around this place`, ', averaged over the same area')
    .replace(` for the roughly ${boxKm} km box around this place`, ' averaged over the same area')
    .replace('averaged over the same box', 'averaged over the same area');
}

/** The check of one area, or the reason it has none. `data` null with a reference variable: not loaded (caller waits). */
export function areaCheck(inp: AreaCheckInput): AreaCheck {
  const base = (c: RefCheck, coverage: number | null): AreaCheck => ({ ...c, boxLat: null, boxLng: null, coverage });
  if (!hasReference(inp.variable) || !inp.data) {
    return base(referenceCheck({ variable: inp.variable, ref: null, lat: 0, lng: 0, fullPeriod: inp.fullPeriod, kind: inp.verdictKind, slope: inp.slope, unitsLong: inp.unitsLong }), null);
  }
  const d = inp.data;
  const short = d.source.short;
  const none = (sentence: string, cls: RefCheck['cls'] = 'none'): AreaCheck =>
    base({ cls, n: 0, k: 0, c: 0, records: [], short, sentence, refSlope: null, refP: null, boxLat: null, boxLng: null, badYears: [], badSentence: null, slopeWithout: null, pWithout: null, withoutSentence: null }, null);
  if (!inp.fullPeriod) return none(CUSTOM_PERIOD_TEXT, null);
  const entry = d[inp.kind][inp.key];
  if (!entry) {
    const why = d.unchecked[inp.kind][inp.key] ?? 'coverage';
    const reason = why === 'sea' ? noReferenceReason('T2M', 0) : COVERAGE_REASON;
    return none(`No independent record can check this here (${reason}).`);
  }
  // A one-box RefData holding the area's numbers: referenceCheck then gives the class, the sentences, the bad years and the
  // "Without ..." line exactly as for a point; only the place wording is changed.
  const listed = new Map((entry.records ?? []).map((r) => [r.short, r]));
  const records = d.records?.length
    ? d.records.map((r) => {
        const e = listed.get(r.short);
        return { short: r.short, name: r.name, what: r.what, refSlope: [e ? e.refSlope : null], refP: [e ? e.refP : null], available: [e ? 1 : 0] };
      })
    : undefined;
  const one: RefData = {
    source: d.source,
    records, lat0: 0, dlat: 1, nlat: 1, lon0: 0, dlon: 1, nlon: 1, years: [],
    refSlope: [entry.refSlope], refP: [entry.refP], merraSlope: [entry.merraSlope], merraP: [null], agree: [entry.sizeDiffers ? 2 : 1],
    land: [1], eligible: [1], badYears: entry.badYears.length ? { '0': entry.badYears } : {},
    summary: { confirmed: null, contradicted: null, unconfirmed: null, eligibleShareOfGlobe: 0, nBoxes: 1 },
  };
  const c = referenceCheck({ variable: inp.variable, ref: one, lat: 0, lng: 0, fullPeriod: true, kind: inp.verdictKind, slope: inp.slope, unitsLong: inp.unitsLong, series: inp.series });
  const km = d.source.boxKm;
  const box = boxAt(one, 0, 0);
  const sentence = box ? areaWording(classSentence(c.cls ?? 'none', one, box, inp.unitsLong, inp.slope), km) : c.sentence;
  return base({ ...c, sentence }, entry.coverage);
}

/** The Detective's per-line checks for a continent or the World: cls and short name for each temperature / rainfall line. */
export function areaLineChecks(rank: RankResult, refs: Map<string, AreaRefData>, kind: AreaKind, key: string): Map<string, { cls: RefCheck['cls']; short: string | null; n: number; k: number; c: number }> {
  const out = new Map<string, { cls: RefCheck['cls']; short: string | null; n: number; k: number; c: number }>();
  for (const e of rank.ranked) {
    const data = refs.get(e.variable);
    if (!data || !hasReference(e.variable)) continue;
    const c = areaCheck({ variable: e.variable, data, kind, key, fullPeriod: true, verdictKind: e.kind, slope: e.slopePerDecade, unitsLong: e.units.replace(/ per decade$/, '') });
    out.set(e.variable, { cls: c.cls, short: c.short, n: c.n, k: c.k, c: c.c });
  }
  return out;
}

// ---- loader ------------------------------------------------------------------------------------------------------------

const cache = new Map<string, Promise<AreaRefData | null>>();

/** One fetch per variable, cached; null (no fetch) for a variable without a reference. A failure is not cached. */
export function loadAreaReference(variable: string): Promise<AreaRefData | null> {
  if (!hasReference(variable)) return Promise.resolve(null);
  let p = cache.get(variable);
  if (!p) {
    p = fetch(dataUrl(`reference/areas_${variable}.json`))
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load reference/areas_${variable}.json: HTTP ${res.status}`);
        return res.json() as Promise<AreaRefData>;
      })
      .catch((err) => {
        cache.delete(variable);
        throw err;
      });
    cache.set(variable, p);
  }
  return p;
}

/** Test hook: forget what was loaded. */
export function resetAreaReferenceCache(): void {
  cache.clear();
}
