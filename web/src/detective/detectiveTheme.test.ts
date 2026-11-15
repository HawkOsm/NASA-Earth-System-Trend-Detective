import { describe, expect, it } from 'vitest';
import { COUNTRY_ALIASES, themeFor } from './detectiveLogic';
import countries from '../../public/data/countries.json';

describe('regions a theme button stands for', () => {
  it('the Sahara is the desert theme, not a typo of a city', () => {
    expect(themeFor('snow in the Sahara')).toMatchObject({ theme: { id: 'desert' }, note: null, weak: false });
    expect(themeFor('Sahara')?.theme.id).toBe('desert');
  });
  it('the Amazon is the rainforest theme', () => {
    expect(themeFor('is the Amazon getting drier?')?.theme.id).toBe('rainforest');
    expect(themeFor('Amazonia')?.theme.id).toBe('rainforest');
  });
  it('one typo is forgiven and said', () => {
    expect(themeFor('what is the change in the shara desert')).toMatchObject({ theme: { id: 'desert' }, note: 'I read “shara” as the Sahara.', weak: false });
    expect(themeFor('sahra')?.theme.id).toBe('desert');
    expect(themeFor('rain in the amazn')).toMatchObject({ theme: { id: 'rainforest' }, note: 'I read “amazn” as the Amazon.' });
  });
  it('only the kind of place: the weakest reading, with a note', () => {
    expect(themeFor('what is changing in the desert')).toMatchObject({ theme: { id: 'desert' }, weak: true, note: 'You named no particular desert, so I took the Sahara.' });
    expect(themeFor('deserts')?.weak).toBe(true);
    expect(themeFor('a jungle')).toMatchObject({ theme: { id: 'rainforest' }, weak: true });
  });
  it('a desert this site does not know is not answered with the Sahara', () => {
    expect(themeFor('the Gobi desert')).toBeNull();
    expect(themeFor('what is changing in the Atacama desert since 2000')).toBeNull();
  });
  it('Western Sahara is a country and is left to the place lookup', () => {
    expect(themeFor('Western Sahara')).toBeNull();
    expect(themeFor('western shara')).toBeNull();
  });
  it('Samara is one letter from Sahara: the caller prefers the exactly named city, this only offers the reading', () => {
    expect(themeFor('Samara')).toMatchObject({ theme: { id: 'desert' }, note: 'I read “samara” as the Sahara.' });
  });
  it('other text is not a theme', () => {
    expect(themeFor('what is changing in Europe?')).toBeNull();
    expect(themeFor('Istanbul')).toBeNull();
  });
});

describe('country aliases', () => {
  it('every alias points at a country that exists in the data', () => {
    const list = (Array.isArray(countries) ? countries : (countries as { countries: { name: string }[] }).countries) as { name: string }[];
    const names = new Set(list.map((c) => c.name));
    const missing = COUNTRY_ALIASES.filter(([, target]) => !names.has(target)).map(([alias, target]) => `${alias} -> ${target}`);
    expect(missing).toEqual([]);
  });
});
