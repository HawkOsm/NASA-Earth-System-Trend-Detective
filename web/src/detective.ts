/**
 * The "Detective" chat: pure logic (no React, no network). Place matching, the fixed demo places of the theme buttons,
 * and the building of an answer from a `RankResult` of whatsChanging.ts. There is no AI here: every number in an answer
 * is copied from `rankAt`; this file only decides which words surround it.
 */
import type { CityRec, CountryRec } from './country';
import { formatLatLng } from './format';
import type { RankResult, RankedEntry } from './whatsChanging';
import { plainLine } from './whatsChanging';
import type { SeaRec } from './sea';

// ---- places ---------------------------------------------------------------------------------------------------------

export interface PlaceIndex {
  cities: CityRec[];
  countries: CountryRec[];
  seas: SeaRec[];
}

export type PlaceKind = 'city' | 'country' | 'sea';

/** Something the user named: where to fly and which rank cell to read. */
export interface NamedPlace {
  kind: PlaceKind;
  /** The name as the data has it ("İstanbul", "Turkey", "Barents Sea"). */
  name: string;
  lat: number;
  lng: number;
  /** Country name for a city (null if unknown). */
  country: string | null;
  /** Index into countries.json (city, country) or seas.json (sea): what "Lift this country" needs. */
  countryIdx: number | null;
  seaIdx: number | null;
  pop?: number;
}

/** Lower case, accents and punctuation removed, single spaces: "São Paulo" -> "sao paulo", "İstanbul" -> "istanbul". */
export function normalise(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/ß/g, 'ss')
    .replace(/[øØ]/g, 'o')
    .replace(/[łŁ]/g, 'l')
    .replace(/[đĐ]/g, 'd')
    .replace(/æ/gi, 'ae')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const LEAD_PHRASES = [
  'what is changing',
  'what are the changes',
  'whats changing',
  'what changed',
  'what has changed',
  'what about',
  'how about',
  'show me',
  'tell me about',
  'tell me',
  'look at',
  'look up',
  'investigate',
  'fly to',
  'go to',
  'take me to',
  'search',
  'find',
];
const LEAD_WORDS = ['in', 'at', 'around', 'near', 'for', 'on', 'the'];

/** Candidate texts to look up for the user's words: the normalised text, then without filler words around it. */
export function candidates(text: string): string[] {
  const full = normalise(text);
  const out: string[] = [];
  const add = (s: string) => {
    if (s && !out.includes(s)) out.push(s);
  };
  add(full);
  let s = full;
  for (let guard = 0; guard < 6; guard++) {
    const before = s;
    for (const ph of LEAD_PHRASES) if (s === ph || s.startsWith(ph + ' ')) s = s.slice(ph.length).trim();
    for (const w of LEAD_WORDS) if (s.startsWith(w + ' ')) s = s.slice(w.length).trim();
    if (s === before) break;
  }
  add(s);
  if (s.startsWith('the ')) add(s.slice(4));
  if (full.startsWith('the ')) add(full.slice(4));
  return out;
}

/** A pair "41.0, 28.9" / "41N 29E" / "-8.76 -63.9". Returns null when the text is not a pair of numbers. */
export function parseLatLng(text: string): { lat: number; lng: number } | 'out-of-range' | null {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*°?\s*([ns])?\s*[,;/ ]\s*(-?\d+(?:\.\d+)?)\s*°?\s*([ew])?\s*$/i.exec(text);
  if (!m) return null;
  let lat = Number(m[1]);
  let lng = Number(m[3]);
  if (m[2] && m[2].toLowerCase() === 's') lat = -Math.abs(lat);
  if (m[4] && m[4].toLowerCase() === 'w') lng = -Math.abs(lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return 'out-of-range';
  return { lat, lng };
}

/** Levenshtein distance, giving up (returns max + 1) as soon as it must exceed `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

export type MatchResult =
  | { kind: 'place'; place: NamedPlace }
  | { kind: 'point'; lat: number; lng: number }
  | { kind: 'bad-coordinates' }
  | { kind: 'none'; suggestions: string[] };

function cityPlace(c: CityRec, idx: PlaceIndex): NamedPlace {
  const country = idx.countries.find((r) => r.idx === c.country);
  return {
    kind: 'city',
    name: c.name,
    lat: c.lat,
    lng: c.lng,
    country: country ? country.name : null,
    countryIdx: country ? country.idx : null,
    seaIdx: null,
    pop: c.pop,
  };
}
const countryPlace = (r: CountryRec): NamedPlace => ({
  kind: 'country',
  name: r.name,
  lat: r.centre[0],
  lng: r.centre[1],
  country: r.name,
  countryIdx: r.idx,
  seaIdx: null,
});
const seaPlace = (r: SeaRec): NamedPlace => ({
  kind: 'sea',
  name: r.name,
  lat: r.centre[0],
  lng: r.centre[1],
  country: null,
  countryIdx: null,
  seaIdx: r.idx,
});

const byPop = (a: CityRec, b: CityRec) => b.pop - a.pop || a.id - b.id;

/** Look one candidate up: exact city, exact country, exact sea, then names that start with it, then names containing it. */
function lookup(q: string, idx: PlaceIndex, cityN: string[], countryN: string[], seaN: string[]): NamedPlace | null {
  const pickCity = (test: (n: string) => boolean): NamedPlace | null => {
    let best: CityRec | null = null;
    idx.cities.forEach((c, k) => {
      if (test(cityN[k]) && (!best || byPop(c, best) < 0)) best = c;
    });
    return best ? cityPlace(best, idx) : null;
  };
  const pickRec = <T extends { nCells: number }>(recs: T[], names: string[], test: (n: string) => boolean): T | null => {
    for (let k = 0; k < recs.length; k++) if (recs[k].nCells > 0 && test(names[k])) return recs[k];
    return null;
  };
  const tiers: ((n: string) => boolean)[] = [(n) => n === q];
  if (q.length >= 3) tiers.push((n) => n.startsWith(q), (n) => n.includes(q));
  for (const test of tiers) {
    const c = pickCity(test);
    if (c) return c;
    const r = pickRec(idx.countries, countryN, test);
    if (r) return countryPlace(r);
    const s = pickRec(idx.seas, seaN, test);
    if (s) return seaPlace(s);
  }
  return null;
}

/** Names within edit distance 2 of the text, closest first (at most 3, each name once). */
export function suggest(text: string, idx: PlaceIndex): string[] {
  const q = normalise(text);
  if (q.length < 4) return [];
  const found = new Map<string, { d: number; pop: number }>();
  const consider = (name: string, pop: number) => {
    const d = editDistance(q, normalise(name), 2);
    if (d > 2) return;
    const cur = found.get(name);
    if (!cur || d < cur.d) found.set(name, { d, pop });
  };
  idx.cities.forEach((c) => consider(c.name, c.pop));
  idx.countries.forEach((r) => consider(r.name, 1e12));
  idx.seas.forEach((r) => r.nCells > 0 && consider(r.name, 5e11));
  return [...found.entries()]
    .sort((a, b) => a[1].d - b[1].d || b[1].pop - a[1].pop)
    .slice(0, 3)
    .map(([name]) => name);
}

/** Resolve what the user typed. Never guesses silently: an unknown text returns `none` with close names, if any. */
export function matchPlace(text: string, idx: PlaceIndex): MatchResult {
  const ll = parseLatLng(text);
  if (ll === 'out-of-range') return { kind: 'bad-coordinates' };
  if (ll) return { kind: 'point', lat: ll.lat, lng: ll.lng };
  const cityN = idx.cities.map((c) => normalise(c.name));
  const countryN = idx.countries.map((r) => normalise(r.name));
  const seaN = idx.seas.map((r) => normalise(r.name));
  for (const q of candidates(text)) {
    if (q.length < 2) continue;
    const place = lookup(q, idx, cityN, countryN, seaN);
    if (place) return { kind: 'place', place };
  }
  const cands = candidates(text);
  return { kind: 'none', suggestions: suggest(cands[cands.length - 1] ?? text, idx) };
}

/** True if the user's words are not exactly the matched name (so the answer says how it was read). */
export function wasFuzzy(text: string, place: NamedPlace): boolean {
  const n = normalise(place.name);
  return !candidates(text).some((c) => c === n || c === 'the ' + n);
}

// ---- themes ---------------------------------------------------------------------------------------------------------

export interface Theme {
  id: 'city' | 'desert' | 'rainforest' | 'arctic';
  button: string;
  /** Where the demo goes (fixed). */
  lat: number;
  lng: number;
  /** Human place name for the header ("Istanbul, Turkey"). */
  place: string;
  /** Variables to suggest, in order (names as on the site). */
  suggest: string[];
}

export const THEMES: Theme[] = [
  { id: 'city', button: 'A big city', lat: 41.01, lng: 28.97, place: 'Istanbul, Turkey', suggest: ['T2M', 'T2M_MAX'] },
  { id: 'desert', button: 'A desert', lat: 22.79, lng: 5.53, place: 'the Sahara near Tamanrasset, Algeria', suggest: ['T2M_MAX', 'GWETROOT'] },
  {
    id: 'rainforest',
    button: 'A rainforest',
    lat: -8.76,
    lng: -63.9,
    place: 'the Amazon near Porto Velho, Brazil',
    suggest: ['PRECTOTCORR', 'GWETROOT', 'EVLAND'],
  },
  { id: 'arctic', button: 'The Arctic', lat: 76.0, lng: 40.0, place: 'the Barents Sea', suggest: ['FRSEAICE', 'T2M'] },
];

export const CLICK_BUTTON = 'Click a place on the globe';

export const OPENING = 'What do you want to investigate?';
export const OPENING_HELP = 'Pick a button, or type a city, a country or a sea (or a pair like 41.0, 28.9).';
export const HONESTY_NOTE = 'No AI here: I look up pre-computed NASA POWER / MERRA-2 trends. Numbers are for ~100 km grid boxes.';

// ---- answers --------------------------------------------------------------------------------------------------------

export interface AnswerLine {
  variable: string;
  label: string;
  /** The sentence, from `plainLine` (the numbers come from rankAt). */
  text: string;
  kind: 'significant' | 'possible';
  slopePerDecade: number;
  p: number;
}

export interface Answer {
  header: string;
  /** Significant first, then possible, in rank order. */
  lines: AnswerLine[];
  /** Said instead of an empty list when no variable has a significant or possible trend. */
  nothing: string | null;
  /** "No clear trend: Wind speed, ..." (labels only) or null. */
  noClear: string | null;
  /** "No data here: Snow cover, ..." or null. */
  noData: string | null;
  /** Variables worth a look (theme answers), with their labels, only those that have data here. */
  suggestions: { variable: string; label: string }[];
}

export const YEARS_TEXT = '1981–2025';

function listLabels(labels: string[]): string {
  return labels.join(', ');
}

/** Build the answer for a rank result. `header` is the full first line; `suggestVars` (optional) adds suggestion buttons. */
export function buildAnswer(rank: RankResult, header: string, suggestVars: string[] = []): Answer {
  const shown: RankedEntry[] = rank.ranked.filter((e) => e.kind !== 'none');
  const rest = rank.ranked.filter((e) => e.kind === 'none');
  const lines: AnswerLine[] = shown.map((e) => ({
    variable: e.variable,
    label: e.label,
    text: plainLine(e),
    kind: e.kind as 'significant' | 'possible',
    slopePerDecade: e.slopePerDecade,
    p: e.p,
  }));
  let nothing: string | null = null;
  if (rank.ranked.length === 0) nothing = 'None of the variables has data for this spot, so I have nothing to rank.';
  else if (lines.length === 0)
    nothing = `Nothing here is clearly changing: none of the ${rank.ranked.length} variables with data has a significant or possible trend.`;
  const have = new Set(rank.ranked.map((e) => e.variable));
  const labelOf = new Map(rank.ranked.map((e) => [e.variable, e.label]));
  return {
    header,
    lines,
    nothing,
    noClear: rest.length ? `No clear trend: ${listLabels(rest.map((e) => e.label))}.` : null,
    noData: rank.noData.length ? `No data here: ${listLabels(rank.noData.map((e) => e.label))}.` : null,
    suggestions: suggestVars.filter((v) => have.has(v)).map((v) => ({ variable: v, label: labelOf.get(v)! })),
  };
}

/** Header for a named place: "What's changing around Istanbul, Turkey (the roughly 100 km area around it, 1981–2025):". */
export function placeHeader(place: NamedPlace, cellKm: number): string {
  const where = place.kind === 'city' && place.country ? `${place.name}, ${place.country}` : place.name;
  if (place.kind === 'city') return `What's changing around ${where} (the roughly ${cellKm} km area around it, ${YEARS_TEXT}):`;
  return `What's changing in ${where}, at a point near its middle (the roughly ${cellKm} km area around it, ${YEARS_TEXT}):`;
}

/** Header for a clicked / typed spot: "What's changing here (41.00°N, 28.75°E — in Turkey):". */
export function spotHeader(lat: number, lng: number, inside: string | null): string {
  return `What's changing here (${formatLatLng({ lat, lng })}${inside ? ` — ${inside}` : ''}):`;
}

/** Header for a theme demo: the place named, then the usual wording. */
export function themeHeader(t: Theme, cellKm: number): string {
  return `What's changing around ${t.place} (the roughly ${cellKm} km area around it, ${YEARS_TEXT}):`;
}

/** Flat summary for window.__detective: what the last answer showed. */
export function lastSummary(place: string, rank: RankResult, answer: Answer) {
  return {
    place,
    cell: { lat: rank.cell.lat, lng: rank.cell.lng },
    lines: answer.lines.map((l) => ({ variable: l.variable, slopePerDecade: l.slopePerDecade, p: l.p, kind: l.kind })),
  };
}
