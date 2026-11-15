/**
 * The independent-record check (evaluation layer): pure functions on public/data/reference/<VAR>.json, written by
 * pipeline/evaluation/reference.py. MERRA-2 averaged over the boxes of independent observation records is compared with each record
 * (T2M: NASA GISTEMP and GHCN-CAMS, 2 degree boxes; PRECTOTCORR: GPCP, CMAP, GPCC and PREC/L, 2.5 degree boxes). This module
 * says, for the box around a place, how many of the records confirm the site's trend ("confirmed by k of n"), and caps the
 * pattern-check grade accordingly.
 *
 * Class of a site trend with sign s (kind significant or possible): n = records available at the box, k = records whose own
 * trend is significant (p < 0.05) with sign s, c = significant with the opposite sign.
 *   contradicted if c > k; confirmed if MORE THAN HALF of the records confirm (2k > n) and k > c; partly if 1 <= k (neither of those);
 *   unconfirmed if k = 0 and c = 0. Without any available record: none; if the site's kind is none: info.
 *
 * ELIGIBLE box (one definition, also used by the pipeline's `eligible` array): the box is used (>= 40 valid years in both
 * records) and, for T2M, is land (over the sea GISTEMP is water temperature, not air temperature); for PRECTOTCORR its centre
 * lies below 60 degrees latitude (GPCP is weak near the poles).
 */
import { dataUrl } from '../data/data';
import { signedRate } from '../point/analysis';
import { fmtP, trend } from '../stats/trend';
import type { Grade } from './quality';
import type { VerdictKind } from '../stats/trend';

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

export interface RefRecord {
  short: string;
  name: string;
  what: string;
  refSlope: (number | null)[];
  refP: (number | null)[];
  /** 1 where the box is eligible and the record has >= 40 valid years there. */
  available: number[];
}

export interface RefConsensus {
  confirmed: number;
  partly: number;
  unconfirmed: number;
  contradicted: number;
  records: string[];
  nBoxes: number;
  byCount: Record<string, Record<string, number>>;
  byCountArea: Record<string, number>;
}

export interface RefData {
  source: { name: string; short: string; what: string; boxKm: number };
  /** Every record of the variable, first = the one the site has always used. Older files have none (then only the top-level arrays). */
  records?: RefRecord[];
  /** Over the area where MERRA-2's box trend is significant (pipeline/evaluation/reference_multi.py). */
  consensus?: RefConsensus;
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

export type RefClass = 'none' | 'info' | 'confirmed' | 'partly' | 'unconfirmed' | 'contradicted';

/** One record at one box. `slope`/`p` are null when the record is not available there. */
export interface BoxRecord {
  short: string;
  what: string;
  slope: number | null;
  p: number | null;
  available: boolean;
}

export interface RefBox {
  index: number;
  /** Centre of the box. */
  lat: number;
  lng: number;
  /** The first record's trend (GISTEMP / GPCP) and its p. */
  refSlope: number;
  refP: number;
  /** All records of the variable at this box, first record first. */
  records: BoxRecord[];
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
  const records: BoxRecord[] = ref.records
    ? ref.records.map((r) => {
        const rs = r.refSlope[k];
        const rp = r.refP[k];
        const ok = !!r.available[k] && rs !== null && rs !== undefined && rp !== null && rp !== undefined;
        return { short: r.short, what: r.what, slope: ok ? (rs as number) : null, p: ok ? (rp as number) : null, available: ok };
      })
    : [{ short: ref.source.short, what: ref.source.what, slope: s, p, available: true }];
  return { index: k, lat: ref.lat0 + i * ref.dlat, lng: ref.lon0 + j * ref.dlon, refSlope: s, refP: p, records, merraSlope: ref.merraSlope[k] ?? null, sizeDiffers: ref.agree?.[k] === 2, badYears: ref.badYears[String(k)] ?? [] };
}

export interface Tally {
  /** Records available, records significant in the site's direction, records significant the opposite way. */
  n: number;
  k: number;
  c: number;
}

/** n, k, c for a site slope over the available records of a box. */
export function tally(records: BoxRecord[], slope: number): Tally {
  const sign = Math.sign(slope);
  let n = 0;
  let k = 0;
  let c = 0;
  for (const r of records) {
    if (!r.available || r.slope === null || r.p === null) continue;
    n++;
    if (r.p < P_SIG && sign !== 0) {
      const rs = Math.sign(r.slope);
      if (rs === sign) k++;
      else if (rs === -sign) c++;
    }
  }
  return { n, k, c };
}

/** The class from the counts (the rule above), for a site trend whose kind is significant or possible. */
export function classFromCounts(n: number, k: number, c: number): RefClass {
  if (n <= 0) return 'none';
  if (c > k) return 'contradicted';
  if (2 * k > n && k > c) return 'confirmed';
  if (k >= 1) return 'partly';
  return 'unconfirmed';
}

/** The class of the site's trend at a place, from its own verdict kind and slope (full period only). */
export function classify(kind: VerdictKind, slope: number, box: RefBox | null): RefClass {
  if (!box) return 'none';
  const { n, k, c } = tally(box.records, slope);
  if (n === 0) return 'none';
  if (kind === 'none') return 'info';
  return classFromCounts(n, k, c);
}

const ORDER: Record<string, number> = { robust: 0, caution: 1, doubtful: 2 };

/** The worse of the pattern grade and the cap: unconfirmed or partly -> at best caution, contradicted -> doubtful. */
export function combineGrade(pattern: Grade, cls: RefClass | null): Grade {
  if (pattern !== 'robust' && pattern !== 'caution' && pattern !== 'doubtful') return pattern;
  const cap: Grade = cls === 'contradicted' ? 'doubtful' : cls === 'unconfirmed' || cls === 'partly' ? 'caution' : pattern;
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

/** "A", "A and B", "A, B and C". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** "+0.44 to +0.56 mm/day per decade" (smaller change first), or the single value when they print the same. */
function rangeText(slopes: number[], unitsLong: string): string {
  const same = slopes.every((x) => Math.sign(x) === Math.sign(slopes[0]));
  const sorted = [...slopes].sort(same ? (a, b) => Math.abs(a) - Math.abs(b) : (a, b) => a - b);
  const lo = signedRate(sorted[0]);
  const hi = signedRate(sorted[sorted.length - 1]);
  return `${lo === hi ? lo : `${lo} to ${hi}`} ${unitsLong} per decade`;
}

const shows = (count: number) => (count === 1 ? 'shows' : 'show');

/**
 * The sentence for a class; `unitsLong` is the display units in words ("°C", "mm/day"). With one available record it is the
 * one-record sentence; with several it names the records ("Confirmed by 3 of 4 independent records (...)"). `slope` is the
 * site's slope per decade (its sign decides which records confirm); it defaults to the first record's.
 */
export function classSentence(cls: RefClass, ref: RefData, box: RefBox, unitsLong: string, slope: number = box.refSlope): string {
  const avail = box.records.filter((r) => r.available && r.slope !== null && r.p !== null);
  if (avail.length <= 1) return oneRecordSentence(cls, ref, box, unitsLong);
  const N = avail.length;
  const km = ref.source.boxKm;
  const tail = `for the roughly ${km} km box around this place`;
  const sign = Math.sign(slope);
  const conf = avail.filter((r) => (r.p as number) < P_SIG && sign !== 0 && Math.sign(r.slope as number) === sign);
  const opp = avail.filter((r) => (r.p as number) < P_SIG && sign !== 0 && Math.sign(r.slope as number) === -sign);
  const quiet = avail.filter((r) => !conf.includes(r) && !opp.includes(r));
  const names = (rs: BoxRecord[]) => joinNames(rs.map((r) => r.short));
  const rates = (rs: BoxRecord[]) => rangeText(rs.map((r) => r.slope as number), unitsLong);
  /** What the records that do not confirm say. */
  const others = () => {
    const parts: string[] = [];
    if (quiet.length) parts.push(`${names(quiet)} ${shows(quiet.length)} no significant change`);
    if (opp.length) parts.push(`${names(opp)} ${shows(opp.length)} the opposite, ${rates(opp)}`);
    return parts;
  };
  if (cls === 'confirmed') {
    const size =
      box.sizeDiffers && box.merraSlope !== null
        ? ` The size differs, though: averaged over the same box MERRA-2 shows ${signedRate(box.merraSlope)} ${unitsLong} per decade.`
        : '';
    const rest = conf.length < N ? ` ${others().join('; ')}.` : '';
    return `Confirmed by ${conf.length} of ${N} independent records (${names(conf)}): ${conf.length > 1 ? 'they show' : 'it shows'} ${rates(conf)} ${tail}.${rest}${size}`;
  }
  if (cls === 'partly')
    return `Confirmed by ${conf.length} of ${N} independent records only: ${names(conf)} ${shows(conf.length)} ${rates(conf)}; ${others().join('; ')} ${tail}.`;
  if (cls === 'unconfirmed') return `Not confirmed by any of ${N} independent records (${names(avail)}): none shows a significant change ${tail}.`;
  if (cls === 'contradicted')
    return `Contradicted: ${opp.length} of ${N} independent records (${names(opp)}) ${shows(opp.length)} the opposite, ${rates(opp)} ${tail}.${conf.length ? ` ${conf.length} confirm${conf.length === 1 ? 's' : ''} it.` : ''}`;
  // info: the site sees no clear trend here
  const sig = avail.filter((r) => (r.p as number) < P_SIG);
  if (sig.length)
    return `MERRA-2 shows no clear trend here, but ${sig.length} of ${N} independent records ${sig.length === 1 ? 'does' : 'do'} (${names(sig)}): ${rates(sig)} ${tail}.`;
  return `Independent records (${names(avail)}): none shows a significant change ${tail}.`;
}

function oneRecordSentence(cls: RefClass, ref: RefData, box: RefBox, unitsLong: string): string {
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

/** One record in a check result (the `__lastResult.reference.records` hook). */
export interface CheckRecord {
  short: string;
  slope: number | null;
  p: number | null;
  available: boolean;
}

export interface RefCheck {
  /** null: a custom period is selected (no class, no cap). */
  cls: RefClass | null;
  /** Records available / significant in the site's direction / significant the opposite way (0 when there is no check). */
  n: number;
  k: number;
  c: number;
  records: CheckRecord[];
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
  n: 0, k: 0, c: 0, records: [], refSlope: null, refP: null, boxLat: null, boxLng: null, badYears: [], badSentence: null, slopeWithout: null, pWithout: null, withoutSentence: null,
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
  const { n, k, c } = tally(box.records, inp.slope);
  const out: RefCheck = {
    ...EMPTY,
    cls,
    short,
    n, k, c,
    records: box.records.map((r) => ({ short: r.short, slope: r.slope, p: r.p, available: r.available })),
    sentence: classSentence(cls, ref, box, inp.unitsLong, inp.slope),
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

/**
 * Short Detective reason for a partly / unconfirmed / contradicted line, or the "· Confirmed by ..." tail, or null. With several
 * records (counts.n > 1): "Confirmed by only K of N records." / "Not confirmed by any of N records." / "Contradicted by C of N
 * records." / " · Confirmed by K of N records"; with one record the name of the record is used.
 */
export function shortCheckText(cls: RefClass | null, short: string | null, counts?: Tally | null): { reason: string | null; tail: string | null } {
  if (!short) return { reason: null, tail: null };
  if (counts && counts.n > 1) {
    const { n, k, c } = counts;
    if (cls === 'partly') return { reason: `Confirmed by only ${k} of ${n} records.`, tail: null };
    if (cls === 'unconfirmed') return { reason: `Not confirmed by any of ${n} records.`, tail: null };
    if (cls === 'contradicted') return { reason: `Contradicted by ${c} of ${n} records.`, tail: null };
    if (cls === 'confirmed') return { reason: null, tail: ` · Confirmed by ${k} of ${n} records` };
    return { reason: null, tail: null };
  }
  if (cls === 'unconfirmed') return { reason: `Not confirmed by ${short}.`, tail: null };
  if (cls === 'contradicted') return { reason: `Contradicted by ${short}.`, tail: null };
  if (cls === 'confirmed') return { reason: null, tail: ` · Confirmed by ${short}` };
  return { reason: null, tail: null };
}

/**
 * The Menu line: "Checked against N records (SHORTS): NN% confirmed · NN% partly · NN% not confirmed · NN% contradicted" (the
 * consensus over the area where MERRA-2 is significant; T2M adds "(land)"). Files without a consensus use the first record's
 * summary. null when there is no summary.
 */
export function summaryLine(variable: string, ref: RefData | null): string | null {
  if (!ref) return null;
  const pc = (x: number) => `${Math.round(x * 100)}%`;
  const land = variable === 'T2M' ? ' (land)' : '';
  const cs = ref.consensus;
  if (cs && ref.records && ref.records.length > 1) {
    return (
      `Checked against ${ref.records.length} records (${joinNames(ref.records.map((r) => r.short))})${land}: ${pc(cs.confirmed)} confirmed · ` +
      `${pc(cs.partly)} partly · ${pc(cs.unconfirmed)} not confirmed · ${pc(cs.contradicted)} contradicted`
    );
  }
  const s = ref.summary;
  if (!s || s.confirmed === null || s.unconfirmed === null || s.contradicted === null) return null;
  return `Checked against ${ref.source.short}${land}: ${pc(s.confirmed)} confirmed · ${pc(s.unconfirmed)} not confirmed · ${pc(s.contradicted)} contradicted`;
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

