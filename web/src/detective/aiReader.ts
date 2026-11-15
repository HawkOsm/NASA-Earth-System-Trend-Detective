/**
 * The AI reader of the Detective: Google's Gemini turns a typed question into a place, years and a variable.
 *
 * The page cannot hold an API key, so the question goes to a small server of this project on Google Cloud Run
 * (proxy/server.js in the repository), which holds the key, calls Gemini and returns only this structured reading.
 * Gemini never supplies a number about the climate: the Detective looks every number up in the precomputed
 * statistics, exactly as it does without the reader. When the reader is slow, refuses or is switched off
 * (`?ai=0`), the Detective falls back to its own word matching.
 */
export const AI_READER_URL = 'https://trend-detective-ai-589159634791.europe-west1.run.app/ask';
export const AI_TIMEOUT_MS = 9500;

export const AI_VARIABLES = ['T2M', 'T2M_MAX', 'PRECTOTCORR', 'GWETROOT', 'EVLAND', 'RH2M', 'FRSNO', 'FRSEAICE', 'WS2M', 'TO3'] as const;
/** How a variable is named in the sentence that says how the question was read. */
export const AI_VARIABLE_WORDS: Record<string, string> = {
  T2M: 'air temperature',
  T2M_MAX: 'the hottest temperature of the year',
  PRECTOTCORR: 'rainfall',
  GWETROOT: 'soil moisture',
  EVLAND: 'evaporation from land',
  RH2M: 'humidity',
  FRSNO: 'snow cover',
  FRSEAICE: 'sea ice',
  WS2M: 'wind speed',
  TO3: 'ozone',
};

export interface AiReading {
  place: string | null;
  lat: number | null;
  lng: number | null;
  start: number | null;
  end: number | null;
  variable: string | null;
  /** The model that read the question, as the server reports it. */
  model: string | null;
}

/** Check the server's answer field by field: anything of the wrong type or range becomes null; not an object -> null. */
export function parseReading(raw: unknown): AiReading | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
  const year = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 1900 && v <= 2100 ? v : null);
  const place = typeof o.place === 'string' && o.place.trim() ? o.place.trim().slice(0, 80) : null;
  let lat = num(o.lat, -90, 90);
  let lng = num(o.lng, -180, 180);
  if (lat === null || lng === null || place === null) {
    lat = null;
    lng = null;
  }
  return {
    place,
    lat,
    lng,
    start: year(o.start),
    end: year(o.end),
    variable: typeof o.variable === 'string' && (AI_VARIABLES as readonly string[]).includes(o.variable) ? o.variable : null,
    model: typeof o.model === 'string' ? o.model.slice(0, 60) : null,
  };
}

/** True unless the address switches the reader off (`?ai=0`). */
export function aiEnabled(search: string): boolean {
  return new URLSearchParams(search).get('ai') !== '0';
}

/** "Gemini read this as: the Sahara, 1995–2008, about rainfall." (null when it read nothing). */
export function readingSentence(r: AiReading, period: [number, number] | null): string | null {
  const parts: string[] = [];
  if (r.place) parts.push(r.place);
  if (period) parts.push(`${period[0]}–${period[1]}`);
  if (r.variable) parts.push(`about ${AI_VARIABLE_WORDS[r.variable] ?? r.variable}`);
  return parts.length ? `Gemini read this as: ${parts.join(', ')}.` : null;
}

/** Ask the reader. Never throws: null on a timeout, a refusal, a network error or a malformed answer. */
export async function readQuestion(text: string, fetchImpl: typeof fetch = fetch, timeoutMs = AI_TIMEOUT_MS): Promise<AiReading | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(AI_READER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.slice(0, 300) }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return parseReading(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
