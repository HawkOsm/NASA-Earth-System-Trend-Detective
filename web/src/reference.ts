/**
 * The independent-record check (evaluation layer): pure functions on public/data/reference/<VAR>.json, written by
 * pipeline/reference.py. MERRA-2 averaged over the boxes of an independent observation record is compared with that record
 * (T2M: NASA GISTEMP, 2 degree boxes; PRECTOTCORR: GPCP, 2.5 degree boxes). This module says, for the box around a place,
 * whether the record confirms the site's trend, and caps the pattern-check grade accordingly.
 *
 * ELIGIBLE box (one definition, also used by the pipeline's `eligible` array): the box is used (>= 40 valid years in both
 * records) and, for T2M, is land (over the sea GISTEMP is water temperature, not air temperature); for PRECTOTCORR its centre
 * lies below 60 degrees latitude (GPCP is weak near the poles).
 */
import { dataUrl } from './data';
import { signedRate } from './analysis';
import { fmtP, trend } from './stats/trend';
import type { Grade } from './quality';
import type { VerdictKind } from './stats/trend';

export const REFERENCE_VARIABLES = ['T2M', 'PRECTOTCORR'] as const;
export const FULL_PERIOD_TEXT = '1981–2025';
const P_SIG = 0.05;

export interface RefSummary {
  confirmed: number | null;
  contradicted: number | null;
  unconfirmed: number | null;
  eligibleShareOfGlobe: number;
  nBoxes: number;
}

export interface RefData {
  source: { name: string; short: string; what: string; boxKm: number };
  lat0: number;
  dlat: number;
  nlat: number;
  lon0: number;
  dlon: number;
  nlon: number;
  years: number[];
  refSlope: (number | null)[];
  refP: (number | null)[];
  merraSlope: (number | null)[];
  merraP: (number | null)[];
  /** 0 box not used, 1 the two 95% ranges overlap, 2 they do not. */
  agree: number[];
  land: number[];
  eligible: number[];
  badYears: Record<string, number[]>;
  summary: RefSummary;
}

export type RefClass = 'none' | 'info' | 'confirmed' | 'unconfirmed' | 'contradicted';

export interface RefBox {
  index: number;
  /** Centre of the box. */
  lat: number;
  lng: number;
  refSlope: number;
  refP: number;
  /** MERRA-2's own trend averaged over the same box, and whether its 95% range overlaps the record's. */
  merraSlope: number | null;
  sizeDiffers: boolean;
  badYears: number[];
}

export const hasReference = (variable: string): boolean => (REFERENCE_VARIABLES as readonly string[]).includes(variable);

/** The box containing the point (lower edges inclusive, longitude wraps, the top row clamps); null if it is not ELIGIBLE. */
export function boxAt(ref: RefData, lat: number, lng: number): RefBox | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const i = Math.min(ref.nlat - 1, Math.max(0, Math.floor((lat - (ref.lat0 - ref.dlat / 2)) / ref.dlat)));
  const j0 = Math.floor((lng - (ref.lon0 - ref.dlon / 2)) / ref.dlon);
  const j = ((j0 % ref.nlon) + ref.nlon) % ref.nlon;
  const k = i * ref.nlon + j;
  if (!ref.eligible[k]) return null;
  const s = ref.refSlope[k];
  const p = ref.refP[k];
  if (s === null || s === undefined || p === null || p === undefined) return null;
  return { index: k, lat: ref.lat0 + i * ref.dlat, lng: ref.lon0 + j * ref.dlon, refSlope: s, refP: p, merraSlope: ref.merraSlope[k] ?? null, sizeDiffers: ref.agree?.[k] === 2, badYears: ref.badYears[String(k)] ?? [] };
}

/** The class of the site's trend at a place, from its own verdict kind and slope (full period only). */
export function classify(kind: VerdictKind, slope: number, box: RefBox | null): RefClass {
  if (!box) return 'none';
  if (kind === 'none') return 'info';
  if (box.refP >= P_SIG) return 'unconfirmed';
  return Math.sign(box.refSlope) === Math.sign(slope) ? 'confirmed' : 'contradicted';
}

const ORDER: Record<string, number> = { robust: 0, caution: 1, doubtful: 2 };

/** The worse of the pattern grade and the cap: unconfirmed -> at best caution, contradicted -> doubtful. */
export function combineGrade(pattern: Grade, cls: RefClass | null): Grade {
  if (pattern !== 'robust' && pattern !== 'caution' && pattern !== 'doubtful') return pattern;
  const cap: Grade = cls === 'contradicted' ? 'doubtful' : cls === 'unconfirmed' ? 'caution' : pattern;
  return ORDER[cap] > ORDER[pattern] ? cap : pattern;
}

const sourceText = (ref: RefData) => `${ref.source.short} (${ref.source.what})`;

/** "2020", "2020 and 2021", "2020, 2021 and 2022", "2020, 2021, 2022 and 2 more". */
export function yearsText(years: number[]): string {
  if (years.length <= 1) return years.join('');
  if (years.length <= 3) return `${years.slice(0, -1).join(', ')} and ${years[years.length - 1]}`;
  return `${years.slice(0, 3).join(', ')} and ${years.length - 3} more`;
}

export function noReferenceReason(variable: string, lat: number): string {
  if (variable === 'T2M') return 'over the sea the temperature record measures the water, not the air';
  if (variable === 'PRECTOTCORR' && Math.abs(lat) >= 60) return 'the rainfall record is unreliable near the poles';
  return 'the record has too few years here';
}

export const NOT_COMPARED_TEXT = 'No independent record has been compared for this variable yet.';
export const CUSTOM_PERIOD_TEXT = `The independent check covers the full period ${FULL_PERIOD_TEXT} only.`;
export const COUNTRY_NOTE = 'The independent check is shown for single places (Point).';

/** The sentence for a class; `unitsLong` is the display units in words ("°C", "mm/day"). */
export function classSentence(cls: RefClass, ref: RefData, box: RefBox, unitsLong: string): string {
  const src = sourceText(ref);
  const rate = `${signedRate(box.refSlope)} ${unitsLong} per decade`;
  const km = ref.source.boxKm;
  if (cls === 'confirmed') {
    // Same direction, but the two 95% ranges do not overlap: say so, with MERRA-2's value for the same box.
    const size =
      box.sizeDiffers && box.merraSlope !== null
        ? ` The size differs, though: averaged over the same box MERRA-2 shows ${signedRate(box.merraSlope)} ${unitsLong} per decade.`
        : '';
    return `Confirmed by an independent record: ${src} shows ${rate} for the roughly ${km} km box around this place (${fmtP(box.refP)}).${size}`;
  }
  if (cls === 'unconfirmed')
    return `Not confirmed by an independent record: ${src} shows no significant change for the roughly ${km} km box around this place (${rate}, ${fmtP(box.refP)}).`;
  if (cls === 'contradicted')
    return `Contradicted by an independent record: ${src} shows the opposite, ${rate} (${fmtP(box.refP)}), for the roughly ${km} km box around this place.`;
  // The site sees no clear trend, but the record does: say so plainly instead of only quoting the number.
  if (box.refP < 0.05)
    return `MERRA-2 shows no clear trend here, but an independent record does: ${src} shows ${rate} for the roughly ${km} km box around this place (${fmtP(box.refP)}).`;
  return `Independent record: ${src} shows ${rate} for the roughly ${km} km box around this place (${fmtP(box.refP)}).`;
}

export interface RefCheck {
  /** null: a custom period is selected (no class, no cap). */
  cls: RefClass | null;
  short: string | null;
  /** The main sentence (always set). */
  sentence: string;
  refSlope: number | null;
  refP: number | null;
  boxLat: number | null;
  boxLng: number | null;
  badYears: number[];
  /** "GPCP (...) disagrees with MERRA-2 here for 2020." or null. */
  badSentence: string | null;
  /** The site's trend with the flagged years left out (click panel only), or null. */
  slopeWithout: number | null;
  pWithout: number | null;
  withoutSentence: string | null;
}

export interface CheckInput {
  variable: string;
  ref: RefData | null;
  lat: number;
  lng: number;
  fullPeriod: boolean;
  kind: VerdictKind;
  /** The site's slope per decade. */
  slope: number;
  unitsLong: string;
  /** The years and annual values the site's trend was computed from; given only where "Without ..." is wanted. */
  series?: { years: number[]; values: number[] };
}

const EMPTY: Omit<RefCheck, 'cls' | 'short' | 'sentence'> = {
  refSlope: null, refP: null, boxLat: null, boxLng: null, badYears: [], badSentence: null, slopeWithout: null, pWithout: null, withoutSentence: null,
};

export const MIN_YEARS_WITHOUT = 10;

/** Everything the site says about the independent check at one place. `ref` null with a reference variable: not loaded (caller waits). */
export function referenceCheck(inp: CheckInput): RefCheck {
  if (!hasReference(inp.variable) || !inp.ref) return { ...EMPTY, cls: 'none', short: null, sentence: NOT_COMPARED_TEXT };
  const ref = inp.ref;
  const short = ref.source.short;
  if (!inp.fullPeriod) return { ...EMPTY, cls: null, short, sentence: CUSTOM_PERIOD_TEXT };
  const box = boxAt(ref, inp.lat, inp.lng);
  if (!box) {
    return { ...EMPTY, cls: 'none', short, sentence: `No independent record can check this here (${noReferenceReason(inp.variable, inp.lat)}).` };
  }
  const cls = classify(inp.kind, inp.slope, box);
  const out: RefCheck = {
    ...EMPTY,
    cls,
    short,
    sentence: classSentence(cls, ref, box, inp.unitsLong),
    refSlope: box.refSlope,
    refP: box.refP,
    boxLat: box.lat,
    boxLng: box.lng,
    badYears: box.badYears,
  };
  if (box.badYears.length) {
    out.badSentence = `${sourceText(ref)} disagrees with MERRA-2 here for ${yearsText(box.badYears)}.`;
    if (inp.series) {
      const bad = new Set(box.badYears);
      const years: number[] = [];
      const values: number[] = [];
      inp.series.years.forEach((y, k) => {
        if (!bad.has(y)) {
          years.push(y);
          values.push(inp.series!.values[k]);
        }
      });
      if (years.length >= MIN_YEARS_WITHOUT && years.length < inp.series.years.length) {
        const t = trend(values, years);
        out.slopeWithout = t.slope * 10;
        out.pWithout = t.p;
        out.withoutSentence = `Without ${yearsText(box.badYears)}: ${signedRate(t.slope * 10)} ${inp.unitsLong} per decade (${fmtP(t.p)}).`;
      }
    }
  }
  return out;
}

/** Short Detective reason for an unconfirmed / contradicted line, or the "· Confirmed by X" tail, or null. */
export function shortCheckText(cls: RefClass | null, short: string | null): { reason: string | null; tail: string | null } {
  if (!short) return { reason: null, tail: null };
  if (cls === 'unconfirmed') return { reason: `Not confirmed by ${short}.`, tail: null };
  if (cls === 'contradicted') return { reason: `Contradicted by ${short}.`, tail: null };
  if (cls === 'confirmed') return { reason: null, tail: ` · Confirmed by ${short}` };
  return { reason: null, tail: null };
}

/** The Menu line: "Independent check (SHORT): NN% of the significant area confirmed, ...". null when there is no summary. */
export function summaryLine(variable: string, ref: RefData | null): string | null {
  const s = ref?.summary;
  if (!ref || !s || s.confirmed === null || s.unconfirmed === null || s.contradicted === null) return null;
  const pc = (x: number) => `${Math.round(x * 100)}%`;
  return (
    `Checked against ${ref.source.short}${variable === 'T2M' ? ' (land)' : ''}: ${pc(s.confirmed)} confirmed · ` +
    `${pc(s.unconfirmed)} not confirmed · ${pc(s.contradicted)} contradicted`
  );
}

// ---- loader ------------------------------------------------------------------------------------------------------------

const cache = new Map<string, Promise<RefData | null>>();

/** One fetch per variable, cached; null (no fetch) for a variable without a reference. A failure is not cached. */
export function loadReference(variable: string): Promise<RefData | null> {
  if (!hasReference(variable)) return Promise.resolve(null);
  let p = cache.get(variable);
  if (!p) {
    p = fetch(dataUrl(`reference/${variable}.json`))
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load reference/${variable}.json: HTTP ${res.status}`);
        return res.json() as Promise<RefData>;
      })
      .catch((err) => {
        cache.delete(variable);
        throw err;
      });
    cache.set(variable, p);
  }
  return p;
}

