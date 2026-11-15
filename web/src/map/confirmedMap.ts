/**
 * The "Confirmed only" map view: for air temperature and rainfall the map can show only the trends that the independent
 * records confirm (the class "confirmed" of reference.ts: more than half of the available records, and more than contradict it;
 * "partly" confirmed trends are not drawn). The texture `<VAR>_confirmed.png` and `reference/confirmed_<VAR>.json` come from
 * pipeline/evaluation/export_confirmed.py. Pure rules here; the menu row and the globe texture choice use them.
 */
import { confirmedTextureUrl, dataUrl } from '../data/data';
import { FULL_PERIOD_TEXT, hasReference, joinNames } from '../evaluation/reference';

export interface ConfirmedShares {
  /** cos-latitude weighted shares of the whole globe (0..1); significant = confirmed + notConfirmed + uncheckable. */
  significant: number;
  confirmed: number;
  /** Confirmed by some records but not enough (absent in older files). */
  partly?: number;
  notConfirmed: number;
  uncheckable: number;
}

export interface ConfirmedData {
  texture: string;
  source: { short: string; name: string };
  /** Short names of the records the check uses (absent in older files). */
  records?: string[];
  shares: ConfirmedShares;
}

export type ShowMode = 'all' | 'confirmed';

/** The Show row is usable only for a variable with an independent record, on the full period (and not a recomputed map). */
export function confirmedEnabled(variable: string, fullPeriod: boolean, recomputed = false): boolean {
  return hasReference(variable) && fullPeriod && !recomputed;
}

/** The mode actually shown: "Confirmed only" needs the row to be enabled. */
export function effectiveMode(choice: boolean, enabled: boolean): ShowMode {
  return choice && enabled ? 'confirmed' : 'all';
}

/** The grey line shown instead of the two options when the row is disabled. */
export const CONFIRMED_DISABLED_TEXT = `Confirmed-only view exists for air temperature and rainfall, for ${FULL_PERIOD_TEXT}.`;

/** The texture to draw: the confirmed one in "confirmed" mode, otherwise the given (trend) texture. */
export function chooseTexture(mode: ShowMode, variable: string, trendTexture: string): string {
  return mode === 'confirmed' && hasReference(variable) ? confirmedTextureUrl(variable) : trendTexture;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** The Scale row's share line in "confirmed" mode. */
export function confirmedSentence(short: string, s: ConfirmedShares, records?: string[]): string {
  if (records && records.length > 1 && s.partly !== undefined)
    return `Showing only trends confirmed by most of the ${records.length} independent records (${joinNames(records)}): ${pct(s.confirmed)} of the globe. Hidden: ${pct(s.partly)} partly confirmed, ${pct(s.notConfirmed)} not confirmed, ${pct(s.uncheckable)} where the records cannot check.`;
  return `Showing only trends confirmed by ${short}: ${pct(s.confirmed)} of the globe. Hidden: ${pct(s.notConfirmed)} not confirmed, ${pct(s.uncheckable)} where the record cannot check.`;
}

const cache = new Map<string, Promise<ConfirmedData>>();

export function loadConfirmed(variable: string): Promise<ConfirmedData> {
  let p = cache.get(variable);
  if (!p) {
    p = fetch(dataUrl(`reference/confirmed_${variable}.json`))
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load confirmed_${variable}.json: HTTP ${res.status}`);
        return res.json() as Promise<ConfirmedData>;
      })
      .catch((err) => {
        cache.delete(variable);
        throw err;
      });
    cache.set(variable, p);
  }
  return p;
}
