import { describe, expect, it } from 'vitest';
import type { CityRec, CountryRec } from '../areas/country';
import type { SeaRec } from '../areas/sea';
import {
  THEMES,
  buildAnswer,
  candidates,
  editDistance,
  matchPlace,
  normalise,
  parseLatLng,
  placeHeader,
  spotHeader,
  suggest,
  themeHeader,
  wasFuzzy,
  type PlaceIndex,
} from './detectiveLogic';
import { VARIABLES } from '../data/demos';
import type { RankResult, RankedEntry } from './whatsChanging';

const country = (idx: number, name: string, centre: [number, number]): CountryRec => ({
  idx,
  name,
  iso: null,
  nCells: 10,
  tiny: false,
  bbox: [0, 0, 0, 0],
  centre,
  tinyCell: null,
});
const city = (id: number, name: string, c: number, lat: number, lng: number, pop: number): CityRec => ({
  id,
  name,
  country: c,
  lat,
  lng,
  pop,
  capital: false,
  cell: [lat, lng],
});
const sea = (idx: number, name: string, centre: [number, number], nCells = 50): SeaRec => ({
  idx,
  name,
  kind: 'sea',
  nCells,
  dlat: 1,
  dlng: 1.25,
  bbox: [0, 0, 0, 0],
  centre,
  wraps: false,
});

const INDEX: PlaceIndex = {
  countries: [country(0, 'Turkey', [39, 35]), country(1, 'Brazil', [-10, -52]), country(2, 'Chile', [-30, -71]), country(3, 'Congo', [-1, 15])],
  cities: [
    city(0, 'İstanbul', 0, 41.01, 28.97, 15000000),
    city(1, 'São Paulo', 1, -23.55, -46.63, 12000000),
    city(2, 'Santiago', 2, -33.45, -70.67, 6000000),
    city(3, 'Santiago', 1, -29.19, -54.87, 50000),
    city(4, 'Istanbulit', 0, 40, 30, 1000),
    city(5, 'Rome', 0, 41.9, 12.5, 2800000),
    city(6, 'Trombetas', 1, -1.4, -56.4, 3000),
    city(7, 'Sanliurfa', 0, 37.16, 38.79, 600000),
  ],
  seas: [sea(0, 'Barents Sea', [76, 40]), sea(1, 'Empty Sea', [0, 0], 0), sea(2, 'North Atlantic Ocean', [34, -38.75])],
};

describe('normalise', () => {
  it('removes accents, case and punctuation', () => {
    expect(normalise('İstanbul')).toBe('istanbul');
    expect(normalise('São Paulo')).toBe('sao paulo');
    expect(normalise("  What's  up?! ")).toBe('whats up');
    expect(normalise('Zürich')).toBe('zurich');
  });
});

describe('matchPlace', () => {
  const place = (t: string) => {
    const m = matchPlace(t, INDEX);
    return m.kind === 'place' ? m.place : null;
  };
  it('exact city, accent-insensitive in both directions', () => {
    expect(place('Istanbul')?.name).toBe('İstanbul');
    expect(place('istanbul')?.kind).toBe('city');
    expect(place('sao paulo')?.name).toBe('São Paulo');
    expect(place('SÃO PAULO')?.name).toBe('São Paulo');
  });
  it('exact country and exact sea', () => {
    expect(place('Turkey')?.kind).toBe('country');
    expect(place('turkey')?.countryIdx).toBe(0);
    const s = place('barents sea');
    expect(s?.kind).toBe('sea');
    expect(s?.seaIdx).toBe(0);
    expect([s?.lat, s?.lng]).toEqual([76, 40]);
  });
  it('an exact name beats a longer name that merely starts with it', () => {
    expect(place('Istanbul')?.name).toBe('İstanbul'); // not Istanbulit
  });
  it('exact city wins over exact country of the same name only by tier order (city first)', () => {
    const idx: PlaceIndex = { ...INDEX, cities: [...INDEX.cities, city(9, 'Chile', 2, -30, -71, 10)] };
    const m = matchPlace('chile', idx);
    expect(m.kind === 'place' && m.place.kind).toBe('city');
  });
  it('several equal city names: the most populous', () => {
    const p = place('santiago');
    expect(p?.pop).toBe(6000000);
    expect(p?.country).toBe('Chile');
  });
  it('prefix, then contains (min 3 letters)', () => {
    expect(place('barents')?.name).toBe('Barents Sea');
    expect(place('Sao Pa')?.name).toBe('São Paulo');
    expect(place('tlantic')?.name).toBe('North Atlantic Ocean');
    expect(place('ro')).toBeNull(); // 2 letters: exact only
    expect(place('om')).toBeNull();
    expect(place('Rome')?.name).toBe('Rome');
  });
  it('strips filler words', () => {
    expect(place("What's changing in Istanbul?")?.name).toBe('İstanbul');
    expect(place('what is changing in the Barents Sea')?.name).toBe('Barents Sea');
    expect(place('show me Brazil')?.name).toBe('Brazil');
    expect(place('what about São Paulo?')?.name).toBe('São Paulo');
    expect(candidates('in the Barents Sea')).toContain('barents sea');
  });
  it('a sea with no cells is never matched', () => {
    expect(place('Empty Sea')).toBeNull();
  });
  it('latitude / longitude pairs', () => {
    expect(matchPlace('41.0, 28.9', INDEX)).toEqual({ kind: 'point', lat: 41, lng: 28.9 });
    expect(matchPlace('-8.76 -63.9', INDEX)).toEqual({ kind: 'point', lat: -8.76, lng: -63.9 });
    expect(matchPlace('41N 29E', INDEX)).toEqual({ kind: 'point', lat: 41, lng: 29 });
    expect(matchPlace('10 S, 20 W', INDEX)).toEqual({ kind: 'point', lat: -10, lng: -20 });
    expect(matchPlace('95, 10', INDEX)).toEqual({ kind: 'bad-coordinates' });
    expect(parseLatLng('Istanbul')).toBeNull();
  });
  it('unknown text is reported as unknown, never guessed', () => {
    const m = matchPlace('Zzxqv', INDEX);
    expect(m).toEqual({ kind: 'none', suggestions: [] });
    expect(matchPlace('', INDEX).kind).toBe('none');
  });
  it('did you mean: names within edit distance 2, closest first, at most 3', () => {
    const m = matchPlace('Istanbol', INDEX);
    // 1 edit from "istanbul": a typo is not matched silently, it is offered
    expect(m.kind).toBe('none');
    if (m.kind === 'none') expect(m.suggestions).toEqual(['İstanbul']);
    expect(suggest('Brasil', INDEX)).toEqual(['Brazil']);
    expect(suggest('abc', INDEX)).toEqual([]);
    expect(editDistance('kitten', 'sitting', 5)).toBe(3);
    expect(editDistance('abcdef', 'abc', 2)).toBe(3);
  });
  it('wasFuzzy is false for exact names and filler, true for a prefix', () => {
    const exact = place('Istanbul')!;
    expect(wasFuzzy('Istanbul', exact)).toBe(false);
    expect(wasFuzzy('what about istanbul?', exact)).toBe(false);
    expect(wasFuzzy('Istanb', exact)).toBe(true);
  });
});

const entry = (variable: string, label: string, slope: number, p: number, strength: number): RankedEntry => ({
  variable,
  label,
  slopePerDecade: slope,
  units: '°C per decade',
  unitsShort: '°C',
  p,
  pAdjusted: p,
  verdict: '',
  kind: p < 0.05 ? 'significant' : p < 0.1 ? 'possible' : 'none',
  direction: slope > 0 ? 'rising' : 'falling',
  strength,
});

const RANK: RankResult = {
  cell: { lat: 41, lng: 28.75 },
  cellKm: 100,
  ranked: [
    entry('T2M', 'Air temperature', 0.54, 0.0001, 0.7),
    entry('TO3', 'Ozone layer', -1.75, 0.003, 0.56),
    entry('T2M_MAX', 'Hottest temperature of the year', 0.34, 0.075, 0.48),
    entry('WS2M', 'Wind speed', -0.02, 0.14, 0.16),
    entry('EVLAND', 'Evaporation from land', 0.001, 0.88, 0.005),
  ],
  noData: [{ variable: 'FRSEAICE', label: 'Sea ice', surface: 'sea' }],
};

describe('buildAnswer', () => {
  const a = buildAnswer(RANK, 'HEADER', ['T2M_MAX', 'FRSEAICE', 'T2M']);
  it('lists significant then possible, in rank order, with numbers from the rank result', () => {
    expect(a.lines.map((l) => [l.variable, l.kind])).toEqual([
      ['T2M', 'significant'],
      ['TO3', 'significant'],
      ['T2M_MAX', 'possible'],
    ]);
    expect(a.lines[0].slopePerDecade).toBe(0.54);
    expect(a.lines[0].text).toContain('+0.54');
    expect(a.lines[0].text).toContain('statistically significant');
    expect(a.lines[2].text).toContain('possible trend');
    expect(a.nothing).toBeNull();
  });
  it('names the rest and the no-data variables without numbers', () => {
    expect(a.noClear).toBe('No clear trend: Wind speed, Evaporation from land.');
    expect(a.noData).toBe('No data here: Sea ice.');
    expect(a.noClear).not.toMatch(/\d/);
  });
  it('suggests only variables that have data here, in the order given', () => {
    expect(a.suggestions.map((s) => s.variable)).toEqual(['T2M_MAX', 'T2M']);
  });
  it('nothing significant: says so instead of an empty list', () => {
    const r: RankResult = { ...RANK, ranked: RANK.ranked.filter((e) => e.kind === 'none') };
    const b = buildAnswer(r, 'H');
    expect(b.lines).toEqual([]);
    expect(b.nothing).toMatch(/Nothing here is clearly changing/);
    expect(b.noClear).toContain('Wind speed');
  });
  it('no data at all: says so', () => {
    const b = buildAnswer({ ...RANK, ranked: [], noData: [{ variable: 'T2M', label: 'Air temperature', surface: 'any' }] }, 'H');
    expect(b.lines).toEqual([]);
    expect(b.nothing).toMatch(/has data for this spot/i);
    expect(b.noClear).toBeNull();
    expect(b.noData).toBe('No data here: Air temperature.');
  });
});

describe('headers', () => {
  it('city, country, spot and theme', () => {
    const m = matchPlace('istanbul', INDEX);
    if (m.kind !== 'place') throw new Error('no match');
    expect(placeHeader(m.place, 100)).toBe("What's changing around İstanbul, Turkey (the roughly 100 km area around it, 1981–2025):");
    const c = matchPlace('Brazil', INDEX);
    if (c.kind !== 'place') throw new Error('no match');
    expect(placeHeader(c.place, 100)).toContain('at a point near its middle');
    expect(spotHeader(41, 28.75, 'in Turkey')).toBe("What's changing here (41.00°N, 28.75°E — in Turkey):");
    expect(spotHeader(-8, -63, null)).toBe("What's changing here (8.00°S, 63.00°W):");
    expect(themeHeader(THEMES[0], 100)).toContain('Istanbul, Turkey');
  });
});

describe('themes', () => {
  it('four themes with fixed demo places and valid, existing variables', () => {
    expect(THEMES.map((t) => t.button)).toEqual(['A big city', 'A desert', 'A rainforest', 'The Arctic']);
    expect(THEMES.map((t) => [t.lat, t.lng])).toEqual([
      [41.01, 28.97],
      [22.79, 5.53],
      [-8.76, -63.9],
      [76, 40],
    ]);
    for (const t of THEMES) {
      expect(t.suggest.length).toBeGreaterThan(0);
      for (const v of t.suggest) expect(VARIABLES as readonly string[]).toContain(v);
    }
    expect(THEMES[3].suggest).toEqual(['FRSEAICE', 'T2M']);
    expect(THEMES[2].suggest).toEqual(['PRECTOTCORR', 'GWETROOT', 'EVLAND']);
  });
});
