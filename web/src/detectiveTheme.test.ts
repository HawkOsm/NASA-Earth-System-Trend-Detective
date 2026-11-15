import { describe, expect, it } from 'vitest';
import { themeFor } from './detectiveLogic';

describe('regions a theme button stands for', () => {
  it('the Sahara is the desert theme, not a typo of a city', () => {
    expect(themeFor('snow in the Sahara')?.id).toBe('desert');
    expect(themeFor('Sahara')?.id).toBe('desert');
  });
  it('the Amazon is the rainforest theme', () => {
    expect(themeFor('is the Amazon getting drier?')?.id).toBe('rainforest');
    expect(themeFor('Amazonia')?.id).toBe('rainforest');
  });
  it('Western Sahara is a country and is left to the place lookup', () => {
    expect(themeFor('Western Sahara')).toBeNull();
  });
  it('other text is not a theme', () => {
    expect(themeFor('Samara')).toBeNull();
    expect(themeFor('what is changing in Europe?')).toBeNull();
  });
});

import { COUNTRY_ALIASES } from './detectiveLogic';
import countries from '../public/data/countries.json';

describe('country aliases', () => {
  it('every alias points at a country that exists in the data', () => {
    const list = (Array.isArray(countries) ? countries : (countries as { countries: { name: string }[] }).countries) as { name: string }[];
    const names = new Set(list.map((c) => c.name));
    const missing = COUNTRY_ALIASES.filter(([, target]) => !names.has(target)).map(([alias, target]) => `${alias} -> ${target}`);
    expect(missing).toEqual([]);
  });
});
