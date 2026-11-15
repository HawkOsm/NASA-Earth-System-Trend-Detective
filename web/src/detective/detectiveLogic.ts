/**
 * The "Detective" chat: pure logic (no React, no network). Place matching, the fixed demo places of the theme buttons,
 * and the building of an answer from a `RankResult` of whatsChanging.ts. There is no AI here: every number in an answer
 * is copied from `rankAt`; this file only decides which words surround it.
 */
import type { CityRec, CountryRec } from '../areas/country';
import { formatLatLng } from '../data/format';
import { combineGrade, referenceCheck, shortCheckText, REFERENCE_VARIABLES, type RefClass, type RefData } from '../evaluation/reference';
import { holmAdjust, lineQuality, type Grade, type LineQuality, type QualityFlags, type VarQuality } from '../evaluation/quality';
import type { RankResult, RankedEntry } from './whatsChanging';
import { plainLine } from './whatsChanging';
import type { SeaRec } from '../areas/sea';
import { REGION_CELL_KM, groupDigits, type RegionRec } from '../areas/regions';

// ---- places ---------------------------------------------------------------------------------------------------------

export interface PlaceIndex {
  cities: CityRec[];
  countries: CountryRec[];
  seas: SeaRec[];
  /** Continents and the World (regions.json). Optional: without it only cities, countries and seas are known. */
  regions?: RegionRec[];
}

export type PlaceKind = 'city' | 'country' | 'sea' | 'region';

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
  /** A region (continent or the World): camera altitude and number of land cells. */
  altitude?: number;
  nCells?: number;
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
  | {
      kind: 'place';
      place: NamedPlace;
      /** The words to quote in "I read “…” as …" when the match was not the exact name (typo, prefix, alias), else null. */
      read?: string | null;
      /** Other, different places the text also named (after the first one, in text order): offered as buttons. */
      others?: NamedPlace[];
    }
  | { kind: 'choose'; phrase: string; options: NamedPlace[] }
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
export const countryPlace = (r: CountryRec): NamedPlace => ({
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
const regionPlace = (r: RegionRec): NamedPlace => ({
  kind: 'region',
  name: r.name,
  lat: r.centre[0],
  lng: r.centre[1],
  country: null,
  countryIdx: null,
  seaIdx: null,
  altitude: r.altitude,
  nCells: r.nCells,
});

const byPop = (a: CityRec, b: CityRec) => b.pop - a.pop || a.id - b.id;

/** Look one candidate up: exact city, exact country, exact sea, then names that start with it, then names containing it. */
function lookup(q: string, idx: PlaceIndex, cityN: string[], countryN: string[], seaN: string[], regionN: string[]): NamedPlace | null {
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
    const g = pickRec(idx.regions ?? [], regionN, test);
    if (g) return regionPlace(g);
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
  (idx.regions ?? []).forEach((r) => consider(r.name, 2e12));
  idx.countries.forEach((r) => consider(r.name, 1e12));
  idx.seas.forEach((r) => r.nCells > 0 && consider(r.name, 5e11));
  return [...found.entries()]
    .sort((a, b) => a[1].d - b[1].d || b[1].pop - a[1].pop)
    .slice(0, 3)
    .map(([name]) => name);
}

// ---- names inside a sentence ---------------------------------------------------------------------------------------

/**
 * Names that are also ordinary words (or first names) and therefore never win from INSIDE a sentence. They are still found
 * when they are the whole text ("Perm"). This is the list of the real cities.json names that were excluded; the other
 * guard is length: a single-word city name shorter than 4 letters is never taken from inside a sentence either.
 */
export const CITY_STOP_WORDS = new Set([
  'male', // Maldives
  'perm', // Russia
  'mary', // Turkmenistan
  'george', // South Africa
  'regina', // Canada
  'victoria', // Canada, Seychelles ...
  'stanley', // Falkland Is.
  'douglas', // Isle of Man
  'david', // Panama
  'florence', // Italy
  'hamilton', // Bermuda, Canada, New Zealand
  'leon', // Mexico, Nicaragua, Spain
  'cali', // Colombia
  'surat', // India
  'bern', // Switzerland
  // not in cities.json today, kept so a longer list of places cannot bring them back:
  'nice', 'bath', 'reading', 'split', 'mobile', 'bar', 'york', 'of', 'mesa', 'orange', 'hope', 'bend', 'kent',
]);

/** Sea names without their generic word ("mediterranean"): never for these (ordinary words, adjectives, or a country). */
export const SEA_ALIAS_STOP = new Set(['indian', 'southern', 'northern', 'yellow', 'norwegian', 'arabian', 'solomon', 'philippine', 'greenland']);

/** Words of a question that are never part of a place name for the typo step (the exact step needs no such list). */
const QUESTION_WORDS = new Set(
  (
    'what whats is are the in of at for how has have changing change changes changed trend trends climate weather show me ' +
    'tell about okay ok please and there here hot cold rain snow wind ice sea land big city country world compare between ' +
    'getting hotter colder warmer wetter drier happening going doing today lately recently years year since over time'
  ).split(' '),
);

/** Alternative names of countries: [what the user may type, country name as in countries.json, usable inside a sentence]. */
export const COUNTRY_ALIASES: [string, string, boolean][] = [
  ['usa', 'United States of America', true],
  ['us', 'United States of America', false], // "tell us about ..." must not mean the USA
  ['u s', 'United States of America', false],
  ['u s a', 'United States of America', true],
  ['united states', 'United States of America', true],
  ['america', 'United States of America', true],
  ['uk', 'United Kingdom', true],
  ['u k', 'United Kingdom', false],
  ['britain', 'United Kingdom', true],
  ['great britain', 'United Kingdom', true],
  ['england', 'United Kingdom', true],
  ['turkiye', 'Turkey', true],
  ['uae', 'United Arab Emirates', true],
  ['korea', 'South Korea', true],
  ['south korea', 'South Korea', true],
  ['czech republic', 'Czechia', true],
  ['ivory coast', "Côte d'Ivoire", true],
  ['burma', 'Myanmar', true],
  ['holland', 'Netherlands', true],
  ['swaziland', 'eSwatini', true],
  ['east timor', 'Timor-Leste', true],
  ['cape verde', 'Cabo Verde', true],
  ['bosnia', 'Bosnia and Herz.', true],
  // Full names of the countries the atlas abbreviates ("W. Sahara", "Dem. Rep. Congo").
  ['western sahara', 'W. Sahara', true],
  ['south sudan', 'S. Sudan', true],
  ['dominican republic', 'Dominican Rep.', true],
  ['democratic republic of the congo', 'Dem. Rep. Congo', true],
  ['dr congo', 'Dem. Rep. Congo', true],
  ['drc', 'Dem. Rep. Congo', true],
  ['congo kinshasa', 'Dem. Rep. Congo', true],
  ['central african republic', 'Central African Rep.', true],
  ['equatorial guinea', 'Eq. Guinea', true],
  ['solomon islands', 'Solomon Is.', true],
  ['marshall islands', 'Marshall Is.', true],
  ['falkland islands', 'Falkland Is.', true],
  ['falklands', 'Falkland Is.', true],
  ['french polynesia', 'Fr. Polynesia', true],
  ['faroe islands', 'Faeroe Is.', true],
  ['northern cyprus', 'N. Cyprus', true],
  ['bosnia and herzegovina', 'Bosnia and Herz.', true],
  ['cayman islands', 'Cayman Is.', true],
  ['cook islands', 'Cook Is.', true],
  ['antigua and barbuda', 'Antigua and Barb.', true],
  ['saint kitts and nevis', 'St. Kitts and Nevis', true],
  ['saint vincent and the grenadines', 'St. Vin. and Gren.', true],
  ['northern mariana islands', 'N. Mariana Is.', true],
  ['turks and caicos islands', 'Turks and Caicos Is.', true],
  ['british virgin islands', 'British Virgin Is.', true],
  ['us virgin islands', 'U.S. Virgin Is.', true],
  ['pitcairn islands', 'Pitcairn Is.', true],
  ['south georgia', 'S. Geo. and the Is.', true],
];
/** The World entry of regions.json and what the user may call it. 'global' is weak: only used when nothing else is named. */
const WORLD_ALIASES: [string, boolean][] = [
  ['world', false],
  ['the world', false],
  ['earth', false],
  ['globe', false],
  ['global', true],
];

type Group = 'region' | 'alias' | 'stripped' | 'country' | 'sea' | 'city';
const KIND_RANK: Record<Group, number> = { region: 0, alias: 1, country: 1, sea: 2, stripped: 2, city: 3 };

interface NameEntry {
  key: string;
  words: number;
  group: Group;
  pop: number;
  /** More than one place: the user must choose ("pacific"). */
  places: NamedPlace[];
  /** May be taken from inside a sentence. */
  sentence: boolean;
  /** Only used when nothing else in the sentence is a place. */
  weak: boolean;
  /** Matching it is not worth an "I read … as …" note. */
  quiet: boolean;
}

interface NameIndex {
  byKey: Map<string, NameEntry[]>;
  all: NameEntry[];
}

const nameCache = new WeakMap<PlaceIndex, NameIndex>();

function buildNames(idx: PlaceIndex): NameIndex {
  const cached = nameCache.get(idx);
  if (cached) return cached;
  const all: NameEntry[] = [];
  const add = (key: string, group: Group, places: NamedPlace[], o: Partial<NameEntry> = {}) => {
    if (!key) return;
    all.push({ key, words: key.split(' ').length, group, pop: 0, places, sentence: true, weak: false, quiet: false, ...o });
  };
  const regionKeys = new Set<string>();
  for (const g of idx.regions ?? []) {
    const key = normalise(g.name);
    regionKeys.add(key);
    add(key, 'region', [regionPlace(g)]);
    if (g.name === 'World') for (const [alias, weak] of WORLD_ALIASES) if (alias !== key) add(alias, 'alias', [regionPlace(g)], { weak, quiet: true });
  }
  const countryKeys = new Set<string>();
  const byCountryName = new Map<string, CountryRec>();
  for (const r of idx.countries) {
    if (r.nCells <= 0) continue;
    const key = normalise(r.name);
    countryKeys.add(key);
    byCountryName.set(r.name, r);
    add(key, 'country', [countryPlace(r)]);
  }
  for (const [alias, target, sentence] of COUNTRY_ALIASES) {
    const r = byCountryName.get(target);
    if (r && !countryKeys.has(alias)) add(alias, 'alias', [countryPlace(r)], { sentence });
  }
  const seaKeys = new Set<string>();
  const stripped = new Map<string, NamedPlace[]>();
  for (const r of idx.seas) {
    if (r.nCells <= 0) continue;
    const key = normalise(r.name);
    seaKeys.add(key);
    add(key, 'sea', [seaPlace(r)], { pop: 5e11 });
    // "mediterranean", "arctic", "pacific" (North/South Pacific Ocean: two places), without "sea" / "ocean".
    const m = /^(?:(?:north|south|east|west) )?([a-z]+) (?:sea|ocean)$/.exec(key);
    if (m && m[1].length >= 6 && !SEA_ALIAS_STOP.has(m[1])) stripped.set(m[1], [...(stripped.get(m[1]) ?? []), seaPlace(r)]);
  }
  for (const [key, places] of stripped) {
    if (countryKeys.has(key) || regionKeys.has(key) || seaKeys.has(key)) continue;
    add(key, 'stripped', places, { quiet: true });
  }
  for (const c of idx.cities) {
    const key = normalise(c.name);
    const single = !key.includes(' ');
    add(key, 'city', [cityPlace(c, idx)], { pop: c.pop, sentence: !(single && (key.length < 4 || CITY_STOP_WORDS.has(key))) });
  }
  const byKey = new Map<string, NameEntry[]>();
  for (const e of all) byKey.set(e.key, [...(byKey.get(e.key) ?? []), e]);
  const out = { byKey, all };
  nameCache.set(idx, out);
  return out;
}

/** The better of two entries: continent, country / alias, sea, then city by population. */
const entryOrder = (a: NameEntry, b: NameEntry) => KIND_RANK[a.group] - KIND_RANK[b.group] || b.pop - a.pop;

const MAX_RUN = 5;

interface Hit {
  start: number;
  n: number;
  entry: NameEntry;
  typed: string;
}

/** Every run of 1..5 consecutive words that is a known name (exact), each run with its best entry. */
function exactHits(words: string[], names: NameIndex): Hit[] {
  const hits: Hit[] = [];
  for (let n = 1; n <= MAX_RUN; n++) {
    for (let start = 0; start + n <= words.length; start++) {
      const key = words.slice(start, start + n).join(' ');
      const es = (names.byKey.get(key) ?? []).filter((e) => e.sentence);
      if (es.length) hits.push({ start, n, entry: es.sort(entryOrder)[0], typed: key });
    }
  }
  return hits;
}

/** Longest name first (words, then letters), then continent / country / sea / city by population; overlapping runs lose. */
function chooseHits(hits: Hit[]): Hit[] {
  const strong = hits.filter((h) => !h.entry.weak);
  const pool = strong.length ? strong : hits;
  const sorted = [...pool].sort(
    (a, b) => b.n - a.n || b.typed.length - a.typed.length || entryOrder(a.entry, b.entry) || a.start - b.start,
  );
  const taken = new Set<number>();
  const kept: Hit[] = [];
  for (const h of sorted) {
    let free = true;
    for (let k = h.start; k < h.start + h.n; k++) if (taken.has(k)) free = false;
    if (!free) continue;
    for (let k = h.start; k < h.start + h.n; k++) taken.add(k);
    kept.push(h);
  }
  return kept.sort((a, b) => a.start - b.start);
}

/** One typo (edit distance 1) in a name of 6+ letters, found as a word or word run that is not the whole text. */
function typoHit(words: string[], names: NameIndex): Hit | null {
  const found: Hit[] = [];
  for (let n = 1; n <= Math.min(MAX_RUN, words.length - 1); n++) {
    for (let start = 0; start + n <= words.length; start++) {
      const run = words.slice(start, start + n);
      if (run.every((w) => QUESTION_WORDS.has(w))) continue;
      const typed = run.join(' ');
      if (typed.length < 5) continue;
      let best: NameEntry | null = null;
      for (const e of names.all) {
        if (!e.sentence || e.weak || e.key.length < 6 || Math.abs(e.key.length - typed.length) > 1) continue;
        if (editDistance(typed, e.key, 1) !== 1) continue;
        if (!best || entryOrder(e, best) < 0) best = e;
      }
      if (best) found.push({ start, n, entry: best, typed });
    }
  }
  found.sort((a, b) => b.n - a.n || b.typed.length - a.typed.length || entryOrder(a.entry, b.entry) || a.start - b.start);
  return found[0] ?? null;
}

const samePlace = (a: NamedPlace, b: NamedPlace) => a.kind === b.kind && a.name === b.name;

/** Resolve what the user typed. Never guesses silently: an unknown text returns `none` with close names, if any. */
export function matchPlace(text: string, idx: PlaceIndex): MatchResult {
  const ll = parseLatLng(text);
  if (ll === 'out-of-range') return { kind: 'bad-coordinates' };
  if (ll) return { kind: 'point', lat: ll.lat, lng: ll.lng };
  const names = buildNames(idx);
  const cityN = idx.cities.map((c) => normalise(c.name));
  const countryN = idx.countries.map((r) => normalise(r.name));
  const seaN = idx.seas.map((r) => normalise(r.name));
  const regionN = (idx.regions ?? []).map((r) => normalise(r.name));
  const input = text.trim();
  const full = normalise(text);
  for (const q of candidates(text)) {
    if (q.length < 2) continue;
    // Quote the user's own words; when filler words were stripped ("what is changing in the sahara"), only what was looked up.
    const quoted = q === full ? input : q;
    // Continents, the World, aliases ("usa") and sea names without "sea" ("pacific") are exact names too.
    const special = (names.byKey.get(q) ?? []).filter((e) => e.group === 'region' || e.group === 'alias' || e.group === 'stripped').sort(entryOrder)[0];
    if (special) {
      if (special.places.length > 1) return { kind: 'choose', phrase: q, options: special.places };
      const place = special.places[0];
      return { kind: 'place', place, read: special.quiet || wasFuzzy(text, place) === false ? null : quoted, others: [] };
    }
    const place = lookup(q, idx, cityN, countryN, seaN, regionN);
    if (place) return { kind: 'place', place, read: wasFuzzy(text, place) ? quoted : null, others: [] };
  }
  // Not the whole text: a name inside a sentence ("what is the trend in the europe").
  const words = normalise(text).split(' ').filter(Boolean);
  const chosen = chooseHits(exactHits(words, names));
  if (chosen.length) {
    const first = chosen[0];
    if (first.entry.places.length > 1) return { kind: 'choose', phrase: first.typed, options: first.entry.places };
    const place = first.entry.places[0];
    const others: NamedPlace[] = [];
    for (const h of chosen.slice(1)) {
      const p = h.entry.places.length === 1 ? h.entry.places[0] : null;
      if (p && !samePlace(p, place) && !others.some((o) => samePlace(o, p))) others.push(p);
    }
    return { kind: 'place', place, read: null, others: others.slice(0, 3) };
  }
  const typo = words.length > 1 ? typoHit(words, names) : null;
  if (typo && typo.entry.places.length === 1) return { kind: 'place', place: typo.entry.places[0], read: typo.typed, others: [] };
  const cands = candidates(text);
  return { kind: 'none', suggestions: suggest(cands[cands.length - 1] ?? text, idx) };
}

/** The part of the text a failed lookup tried: the text without the "tell me about" / "in the" words around it. */
export function triedText(text: string): string {
  const raw = text.trim().replace(/\s+/g, ' ');
  const cands = candidates(text);
  const stripped = cands[cands.length - 1];
  // Quote the user's own spelling when it is just the filler-stripped text, else the stripped words.
  const shown = stripped && normalise(raw) !== stripped ? stripped : raw;
  return shown.length > 60 ? `${shown.slice(0, 57)}…` : shown;
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

/**
 * Well-known regions that are not in the list of cities, countries and seas but that a theme button stands for.
 * Without this, "the Sahara" is read as a typo of the city of Samara. Word -> theme id; "Western Sahara" is a
 * country and is left to the place lookup.
 */
const THEME_WORDS: [string, Theme['id'], string][] = [
  ['sahara', 'desert', 'the Sahara'],
  ['amazon', 'rainforest', 'the Amazon'],
  ['amazonia', 'rainforest', 'the Amazon'],
];
/** A kind of place with no name given ("a desert"): the theme button's own example, used only when nothing else is found. */
const THEME_KINDS: [string, Theme['id'], string][] = [
  ['desert', 'desert', 'the Sahara'],
  ['rainforest', 'rainforest', 'the Amazon'],
  ['jungle', 'rainforest', 'the Amazon'],
];

export interface ThemeHit {
  theme: Theme;
  /** Said before the answer when the text did not name the region exactly: a typo ("shara") or only its kind ("desert"). */
  note: string | null;
  /** Only the kind of place was named: use it only when the text names no listed place at all. */
  weak: boolean;
}

/**
 * The region a theme button stands for, named in the text: exactly ("the Sahara"), with one typo ("shara", "amazn"), or,
 * weakest, only by its kind ("a desert"). A listed place named exactly always wins over this (the caller checks), so
 * the city of Samara, one letter from "Sahara", is still found.
 */
export function themeFor(text: string): ThemeHit | null {
  const words = normalise(text).split(' ').filter(Boolean);
  const theme = (id: Theme['id']) => THEMES.find((t) => t.id === id) ?? null;
  const hit = (id: Theme['id'], note: string | null, weak: boolean): ThemeHit | null => {
    const t = theme(id);
    return t ? { theme: t, note, weak } : null;
  };
  if (words.includes('western') && words.some((w) => editDistance(w, 'sahara', 1) <= 1)) return null;
  for (const [word, id] of THEME_WORDS) if (words.includes(word)) return hit(id, null, false);
  for (const [word, id, display] of THEME_WORDS) {
    const typo = words.find((w) => w.length >= 5 && editDistance(w, word, 1) === 1);
    if (typo) return hit(id, `I read “${typo}” as ${display}.`, false);
  }
  // Only the kind ("a desert"), and nothing else that could be a name: "the Gobi desert" names one this site does not
  // know, and answering with the Sahara would be wrong.
  const filler = new Set(['a', 'an', 'any', 'some', 'biggest', 'largest', 'do', 'does', 'did', 'it', 'its', 'to', 'on', 'by', 'with', 'was', 'were', 'will']);
  for (const [word, id, display] of THEME_KINDS) {
    if (!words.includes(word) && !words.includes(word + 's')) continue;
    const other = words.filter((w) => w !== word && w !== word + 's' && !QUESTION_WORDS.has(w) && !filler.has(w));
    if (other.length === 0) return hit(id, `You named no particular ${word}, so I took ${display}.`, true);
  }
  return null;
}

// ---- the years asked about --------------------------------------------------------------------------------------------

const YEAR = '((?:19|20)\\d{2})';
const NUMBER_WORDS: Record<string, number> = { ten: 10, fifteen: 15, twenty: 20, 'twenty five': 25, thirty: 30, forty: 40, two: 2, three: 3, four: 4 };
const MIN_ASK_YEARS = 10;

export interface PeriodAsk {
  /** The years asked about, fitted into the data (at least ten years, inside `full`); null when the text names none. */
  period: [number, number] | null;
  /** The text without the words that named the years, for the place lookup. */
  rest: string;
  /** True when the years had to be changed to fit (too short, or outside the data). */
  adjusted: boolean;
}

/**
 * The years a question asks about: "from 2016 to 2025", "2000-2020", "between 1990 and 2010", "since 2005",
 * "until 2000", "the last 20 years", "the last two decades". The result always has at least ten years inside `full`:
 * a shorter or out-of-range request is widened / moved and `adjusted` is set. Two plain numbers that are not years
 * (a latitude and longitude) are left alone.
 */
export function parsePeriod(text: string, full: [number, number]): PeriodAsk {
  const [lo, hi] = full;
  const fit = (s: number, e: number): { period: [number, number]; adjusted: boolean } => {
    let a = Math.max(lo, Math.min(hi, Math.min(s, e)));
    let b = Math.max(lo, Math.min(hi, Math.max(s, e)));
    if (b - a + 1 < MIN_ASK_YEARS) {
      b = Math.min(hi, a + MIN_ASK_YEARS - 1);
      a = Math.max(lo, b - MIN_ASK_YEARS + 1);
    }
    return { period: [a, b], adjusted: a !== Math.min(s, e) || b !== Math.max(s, e) };
  };
  const cut = (m: RegExpExecArray) => (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
  let m = new RegExp(`\\b(?:from\\s+|between\\s+)?${YEAR}\\s*(?:-|–|—|to|and|until|till|through)\\s*${YEAR}\\b`, 'i').exec(text);
  if (m) return { ...fit(Number(m[1]), Number(m[2])), rest: cut(m) };
  m = new RegExp(`\\b(?:since|after|from)\\s+${YEAR}\\b`, 'i').exec(text);
  if (m) return { ...fit(Number(m[1]), hi), rest: cut(m) };
  m = new RegExp(`\\b(?:until|till|before|up to|through)\\s+${YEAR}\\b`, 'i').exec(text);
  if (m) return { ...fit(lo, Number(m[1])), rest: cut(m) };
  m = /\b(?:in |over |during |for )?(?:the )?(?:last|past|previous|recent)\s+(\d{1,2}|[a-z]+(?: five)?)?\s*(years|decades?)\b/i.exec(text);
  if (m) {
    const word = (m[1] ?? '').toLowerCase();
    const n = word === '' ? 1 : /^\d+$/.test(word) ? Number(word) : NUMBER_WORDS[word];
    if (n !== undefined && !(word === '' && /^years$/i.test(m[2]))) {
      const years = /^decade/i.test(m[2]) ? n * 10 : n;
      const f = fit(hi - years + 1, hi);
      return { ...f, adjusted: f.adjusted || years < MIN_ASK_YEARS, rest: cut(m) };
    }
  }
  return { period: null, rest: text, adjusted: false };
}

export const CLICK_BUTTON = 'Click a place on the globe';

export const OPENING = 'What do you want to investigate?';
export const OPENING_HELP = 'Pick a button, or type a city, a country, a continent or a sea (or a pair like 41.0, 28.9).';
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
  /** A second sentence (region answers: the share of the map that agrees), or null. */
  extra: string | null;
  /** Quality grade after the many-tests rule, or null when no quality data was given (never shown as a guess). */
  grade: Grade | null;
  flags: QualityFlags | null;
  /** Lines under the badge (short reason for the first flag, many-tests note); empty when robust or unknown. */
  reasons: string[];
  /** Independent-record class for temperature and rainfall point answers (the grade above already includes its cap), else null. */
  reference: RefClass | null;
  /** " · Confirmed by NASA GISTEMP" after the badge for a confirmed line, else null. */
  referenceTail: string | null;
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

/** What the independent record says about each temperature / rainfall line of a place (the box containing the coarse cell's centre). */
export type LineChecks = Map<string, { cls: RefClass | null; short: string | null; n?: number; k?: number; c?: number }>;

export function lineChecks(rank: RankResult, refs: Map<string, RefData>): LineChecks {
  const out: LineChecks = new Map();
  for (const e of rank.ranked) {
    const ref = refs.get(e.variable);
    if (!ref || !(REFERENCE_VARIABLES as readonly string[]).includes(e.variable)) continue;
    const c = referenceCheck({
      variable: e.variable, ref, lat: rank.cell.lat, lng: rank.cell.lng, fullPeriod: true, kind: e.kind, slope: e.slopePerDecade,
      unitsLong: e.units.replace(/ per decade$/, ''),
    });
    out.set(e.variable, { cls: c.cls, short: c.short, n: c.n, k: c.k, c: c.c });
  }
  return out;
}

/** Build the answer for a rank result. `header` is the full first line; `suggestVars` (optional) adds suggestion buttons. */
export function buildAnswer(
  rank: RankResult,
  header: string,
  suggestVars: string[] = [],
  extras?: Map<string, string>,
  qualities?: Map<string, VarQuality>,
  checks?: LineChecks,
): Answer {
  const shown: RankedEntry[] = rank.ranked.filter((e) => e.kind !== 'none');
  const rest = rank.ranked.filter((e) => e.kind === 'none');
  // MANY_TESTS: Holm over the raw p of every variable with data at this place.
  const adj = holmAdjust(rank.ranked.map((e) => e.p));
  const adjOf = new Map(rank.ranked.map((e, i) => [e.variable, adj[i]]));
  const lines: AnswerLine[] = shown.map((e) => {
    const vq = qualities?.get(e.variable);
    const lq: LineQuality | null =
      vq && vq.grade !== 'none' && vq.grade !== 'unchecked' ? lineQuality(vq, e.kind, adjOf.get(e.variable)!, rank.ranked.length) : null;
    const chk = checks?.get(e.variable);
    const sc = chk ? shortCheckText(chk.cls, chk.short, chk.n !== undefined ? { n: chk.n, k: chk.k ?? 0, c: chk.c ?? 0 } : null) : { reason: null, tail: null };
    return {
      variable: e.variable,
      label: e.label,
      text: plainLine(e),
      kind: e.kind as 'significant' | 'possible',
      slopePerDecade: e.slopePerDecade,
      p: e.p,
      extra: extras?.get(e.variable) ?? null,
      grade: lq ? combineGrade(lq.grade, chk ? chk.cls : null) : null,
      flags: lq ? lq.flags : null,
      reasons: [...(lq ? lq.reasons : []), ...(sc.reason ? [sc.reason] : [])],
      reference: chk ? chk.cls : null,
      referenceTail: sc.tail,
    };
  });
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
  if (place.kind === 'region') {
    const world = place.name === 'World';
    return `What's changing across ${world ? 'the world' : place.name} (average over ${world ? 'all land' : 'its land'}, ${groupDigits(place.nCells ?? 0)} grid cells of about ${REGION_CELL_KM} km, ${YEARS_TEXT}):`;
  }
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
export function lastSummary(place: string, rank: RankResult, answer: Answer, region = false) {
  const lines = answer.lines.map((l) => ({ variable: l.variable, slopePerDecade: l.slopePerDecade, p: l.p, kind: l.kind, grade: l.grade, flags: l.flags, reference: l.reference }));
  if (region) return { place, cell: null, lines, region: true };
  return { place, cell: { lat: rank.cell.lat, lng: rank.cell.lng }, lines };
}
