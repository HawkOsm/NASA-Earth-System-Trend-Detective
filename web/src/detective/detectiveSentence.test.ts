import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CITY_STOP_WORDS,
  COUNTRY_ALIASES,
  matchPlace,
  placeHeader,
  triedText,
  type NamedPlace,
  type PlaceIndex,
} from './detectiveLogic';

const DATA = new URL('../../public/data/', import.meta.url);
const json = (f: string) => JSON.parse(readFileSync(new URL(f, DATA), 'utf8'));
const REAL: PlaceIndex = { cities: json('cities.json'), countries: json('countries.json'), seas: json('seas.json'), regions: json('regions.json').regions };

const m = (t: string, idx: PlaceIndex = REAL) => matchPlace(t, idx);
const place = (t: string): NamedPlace | null => {
  const r = m(t);
  return r.kind === 'place' ? r.place : null;
};
const lab = (p: NamedPlace) => `${p.kind}:${p.name}`;

describe('a place inside a sentence', () => {
  it('the sentence a real user typed', () => {
    const r = m('Okay whatt is the changing trends in the europe');
    expect(r.kind).toBe('place');
    if (r.kind === 'place') {
      expect(lab(r.place)).toBe('region:Europe');
      expect(r.read).toBeNull();
      expect(r.others).toEqual([]);
    }
  });
  it('questions with a country, a city, a sea, a continent or the world', () => {
    expect(lab(place('trends in Turkey please')!)).toBe('country:Turkey');
    expect(place('is it getting hotter in new york')?.name).toBe('New York');
    expect(lab(place('tell me about the mediterranean')!)).toBe('sea:Mediterranean Sea');
    expect(lab(place('how about south america')!)).toBe('region:South America'); // not "america" = USA
    expect(lab(place('the world')!)).toBe('region:World');
    expect(lab(place('is the world warming')!)).toBe('region:World');
    expect(lab(place('what is the weather like in the arctic')!)).toBe('sea:Arctic Ocean');
    expect(lab(place('okay trends near the baltic')!)).toBe('sea:Baltic Sea');
  });
  it('the longest name wins over a shorter one inside it', () => {
    expect(lab(place('trends in north america please')!)).toBe('region:North America');
    expect(place('what about the north sea')?.name).toBe('North Sea');
    expect(place('what about panama city')?.name).toBe('Panama City');
  });
  it('two places: answers the first and offers the other', () => {
    const r = m('compare Istanbul and Cebu');
    expect(r.kind).toBe('place');
    if (r.kind === 'place') {
      expect(r.place.name).toBe('Istanbul');
      expect((r.others ?? []).map((o) => o.name)).toEqual(['Cebu']);
    }
    const s = m('how are the trends around the big city of istanbul and the arctic ocean');
    if (s.kind === 'place') expect((s.others ?? []).map(lab)).toEqual(['sea:Arctic Ocean']);
  });
  it('"global warming in Africa" is Africa; "global" alone is the World', () => {
    expect(lab(place('how is global warming in africa')!)).toBe('region:Africa');
    expect(lab(place('global warming')!)).toBe('region:World');
  });
  it('words that are not places are not places', () => {
    for (const t of ['nice weather today', 'what is the trend', 'is it getting hotter', 'does reading help', 'go mobile please', 'tell us about it', 'hot summers']) {
      expect(m(t).kind, t).toBe('none');
    }
    // "us" inside a sentence is a pronoun; alone it is the USA
    expect(m('tell us about trends').kind).toBe('none');
    expect(place('us')?.name).toBe('United States of America');
  });
  it('city names that are ordinary words or first names do not win from inside a sentence, but are found alone', () => {
    for (const w of ['male', 'perm', 'mary', 'george', 'victoria', 'david']) {
      expect(CITY_STOP_WORDS.has(w)).toBe(true);
      expect(m(`how is the ${w} trend`).kind, w).toBe('none');
    }
    expect(place('Perm')?.name).toBe('Perm');
    // names under 4 letters, single word, never from inside a sentence
    const idx: PlaceIndex = { ...REAL, cities: [...REAL.cities, { id: 9999, name: 'Ica', country: 0, lat: 0, lng: 0, pop: 1, capital: false, cell: [0, 0] }] };
    expect(m('what about ica please', idx).kind).toBe('none');
    expect(place('Ica')?.name).toBe('Ica');
  });
});

describe('one typo', () => {
  it('"europ" inside a sentence is read as Europe, and says so', () => {
    const r = m('what is happening in europ');
    expect(r.kind === 'place' && lab(r.place)).toBe('region:Europe');
    expect(r.kind === 'place' && r.read).toBe('europ');
  });
  it('a typo inside a sentence in a city name of 6+ letters', () => {
    const r = m('wether in berln');
    expect(r.kind === 'place' && r.place.name).toBe('Berlin');
    expect(r.kind === 'place' && r.read).toBe('berln');
  });
  it('only when nothing matches exactly, and not for two typos', () => {
    const r = m('what is happening in europe and wether in berln');
    expect(r.kind === 'place' && r.place.name).toBe('Europe');
    expect(r.kind === 'place' && r.read).toBeNull();
    expect(m('trends in Euorpe').kind).toBe('none');
  });
  it('a lone misspelled name is offered, not guessed (existing behaviour)', () => {
    const r = m('Istanbol');
    expect(r.kind).toBe('none');
  });
});

describe('seas without their generic word, aliases', () => {
  it('pacific and atlantic ask which', () => {
    for (const [t, names] of [
      ['pacific', ['North Pacific Ocean', 'South Pacific Ocean']],
      ['what about the atlantic', ['North Atlantic Ocean', 'South Atlantic Ocean']],
    ] as const) {
      const r = m(t);
      expect(r.kind).toBe('choose');
      if (r.kind === 'choose') expect(r.options.map((o) => o.name)).toEqual(names);
    }
  });
  it('single-word sea names', () => {
    expect(place('mediterranean')?.name).toBe('Mediterranean Sea');
    expect(place('caribbean')?.name).toBe('Caribbean Sea');
    expect(place('arctic')?.name).toBe('Arctic Ocean');
    expect(place('black sea')?.name).toBe('Black Sea');
    expect(place('red sea')?.name).toBe('Red Sea');
    expect(place('baltic')?.name).toBe('Baltic Sea');
  });
  it('every alias points at a country that exists under that exact name', () => {
    const names = new Set<string>(REAL.countries.map((c) => c.name));
    for (const [alias, target] of COUNTRY_ALIASES) expect(names.has(target), `${alias} -> ${target}`).toBe(true);
  });
  it('the alias table', () => {
    const want: Record<string, string> = {
      usa: 'United States of America',
      'united states': 'United States of America',
      america: 'United States of America',
      uk: 'United Kingdom',
      britain: 'United Kingdom',
      england: 'United Kingdom',
      turkiye: 'Turkey',
      'türkiye': 'Turkey',
      uae: 'United Arab Emirates',
      'south korea': 'South Korea',
      korea: 'South Korea',
      russia: 'Russia',
    };
    for (const [t, name] of Object.entries(want)) expect(place(t)?.name, t).toBe(name);
  });
});

describe('unknown text', () => {
  it('quotes only the part it tried', () => {
    expect(triedText('tell me about Atlantis')).toBe('atlantis');
    expect(triedText('Atlantis')).toBe('Atlantis');
    expect(triedText('x'.repeat(100)).length).toBe(58);
  });
});

describe('region header', () => {
  it('names the region, its cells and the years', () => {
    const europe = place('europe')!;
    expect(placeHeader(europe, 50)).toBe("What's changing across Europe (average over its land, 4,514 grid cells of about 50 km, 1981–2025):");
    expect(placeHeader(place('the world')!, 50)).toBe("What's changing across the world (average over all land, 68,228 grid cells of about 50 km, 1981–2025):");
    expect(europe.altitude).toBeGreaterThanOrEqual(1.6);
  });
});
