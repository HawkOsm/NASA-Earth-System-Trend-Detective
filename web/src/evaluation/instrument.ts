/**
 * Satellite check: MERRA-2 against an instrument the challenge names (GPM, MODIS, OMI), over the instrument's own
 * years. Mirror of pipeline/evaluation/instrument_check.py, which computes both trends per 2 degree box; the browser only looks
 * the box up and words the result. It is information next to the grade and never changes a grade.
 */
import { dataUrl } from '../data/data';
import { signedRate } from '../point/analysis';

export const INSTRUMENT_ALPHA = 0.05;

export interface InstrumentData {
  variable: string;
  instrument: { short: string; name: string; what: string };
  years: [number, number];
  nYears: number;
  lat0: number;
  dlat: number;
  nlat: number;
  lon0: number;
  dlon: number;
  nlon: number;
  /** Per box, row-major [lat][lon]: trend per decade and p over `years`; null where the box cannot be checked. */
  merraSlope: (number | null)[];
  merraP: (number | null)[];
  instSlope: (number | null)[];
  instP: (number | null)[];
  summary: {
    nBoxes: number;
    merraSignificant: number | null;
    agree: number | null;
    notConfirmed: number | null;
    contradicted: number | null;
    sameSign: number | null;
  };
}

export type InstrumentClass = 'agree' | 'not_confirmed' | 'contradicted' | 'instrument' | 'neither';

export interface InstrumentCheck {
  cls: InstrumentClass;
  short: string;
  years: [number, number];
  merraSlope: number;
  merraP: number;
  instSlope: number;
  instP: number;
  sentence: string;
}

/** The class of one box from the two trends (pipeline/evaluation/instrument_check.py classify). */
export function instrumentClass(merraSlope: number, merraP: number, instSlope: number, instP: number): InstrumentClass {
  const mSig = merraP < INSTRUMENT_ALPHA;
  const iSig = instP < INSTRUMENT_ALPHA;
  if (mSig && iSig) return Math.sign(merraSlope) === Math.sign(instSlope) ? 'agree' : 'contradicted';
  if (mSig) return 'not_confirmed';
  if (iSig) return 'instrument';
  return 'neither';
}

/** Index of the box containing the point: lower edges inclusive, longitude wraps, the top row clamps. */
export function instrumentBoxIndex(d: Pick<InstrumentData, 'lat0' | 'dlat' | 'nlat' | 'lon0' | 'dlon' | 'nlon'>, lat: number, lng: number): number {
  const i = Math.min(d.nlat - 1, Math.max(0, Math.floor((lat - (d.lat0 - d.dlat / 2)) / d.dlat)));
  const j0 = Math.floor((lng - (d.lon0 - d.dlon / 2)) / d.dlon);
  const j = ((j0 % d.nlon) + d.nlon) % d.nlon;
  return i * d.nlon + j;
}

const boxKm = (dlat: number) => Math.round((dlat * 111.32) / 10) * 10;

export function instrumentSentence(
  cls: InstrumentClass,
  d: Pick<InstrumentData, 'instrument' | 'years' | 'nYears' | 'dlat'>,
  merraSlope: number,
  instSlope: number,
  unitsLong: string,
): string {
  const { short, what } = d.instrument;
  const span = d.years[1] - d.years[0] + 1;
  const per = `${d.years[0]}–${d.years[1]}${d.nYears < span ? ` (${d.nYears} of those years have a full record)` : ''}`;
  const m = `${signedRate(merraSlope)} ${unitsLong} per decade`;
  const i = `${signedRate(instSlope)} ${unitsLong} per decade`;
  const tail = ` (the roughly ${boxKm(d.dlat)} km box around this place).`;
  const head = `${short} (${what}), ${per}: `;
  switch (cls) {
    case 'agree':
      return `${head}${short} shows ${i} and MERRA-2 ${m} over the same years, both significant. They agree${tail}`;
    case 'not_confirmed':
      return `${head}MERRA-2 shows ${m} over these years, significant, but ${short} shows ${i}, not significant. Not confirmed for these years${tail}`;
    case 'contradicted':
      return `${head}${short} shows the opposite of MERRA-2 over these years: ${i} against ${m}, both significant${tail}`;
    case 'instrument':
      return `${head}${short} shows ${i}, significant, while MERRA-2 shows ${m} over the same years, not significant${tail}`;
    default:
      return `${head}neither ${short} (${i}) nor MERRA-2 (${m}) shows a significant change over these years${tail}`;
  }
}

/** The satellite check at a point, or null when the box has no value from both. */
export function instrumentCheck(d: InstrumentData | null, lat: number, lng: number, unitsLong: string): InstrumentCheck | null {
  if (!d || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const k = instrumentBoxIndex(d, lat, lng);
  const ms = d.merraSlope[k];
  const mp = d.merraP[k];
  const is = d.instSlope[k];
  const ip = d.instP[k];
  if (ms === null || mp === null || is === null || ip === null || ms === undefined || mp === undefined || is === undefined || ip === undefined) return null;
  const cls = instrumentClass(ms, mp, is, ip);
  return { cls, short: d.instrument.short, years: d.years, merraSlope: ms, merraP: mp, instSlope: is, instP: ip, sentence: instrumentSentence(cls, d, ms, is, unitsLong) };
}

const pc = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`);

/** Menu line: how MERRA-2's significant trends of the satellite years fare against the instrument. */
export function instrumentSummaryLine(d: InstrumentData | null): string | null {
  if (!d || d.summary.agree === null) return null;
  const s = d.summary;
  return `${d.instrument.short}, ${d.years[0]}–${d.years[1]}: of MERRA-2's significant trends in those years, ${pc(s.agree)} confirmed · ${pc(s.notConfirmed)} not confirmed · ${pc(s.contradicted)} contradicted`;
}

// ---- loader ------------------------------------------------------------------------------------------------------------

/** Variables with a satellite record (pipeline/evaluation/instrument_check.py INSTRUMENTS that were built). */
export const INSTRUMENT_VARIABLES = ['PRECTOTCORR', 'FRSNO'] as const;
export const hasInstrument = (variable: string): boolean => (INSTRUMENT_VARIABLES as readonly string[]).includes(variable);

const cache = new Map<string, Promise<InstrumentData | null>>();

/** One fetch per variable, cached; null for a variable without a satellite record or whose file is absent. */
export function loadInstrument(variable: string): Promise<InstrumentData | null> {
  if (!hasInstrument(variable)) return Promise.resolve(null);
  let p = cache.get(variable);
  if (!p) {
    p = fetch(dataUrl(`instruments/${variable}.json`))
      .then((res) => {
        // A missing file: 404 on the site; a dev server answers with the page itself instead.
        if (res.status === 404 || !(res.headers.get('content-type') ?? '').includes('json')) return null;
        if (!res.ok) throw new Error(`Failed to load instruments/${variable}.json: HTTP ${res.status}`);
        return res.json() as Promise<InstrumentData>;
      })
      .catch((err) => {
        cache.delete(variable);
        throw err;
      });
    cache.set(variable, p);
  }
  return p;
}
