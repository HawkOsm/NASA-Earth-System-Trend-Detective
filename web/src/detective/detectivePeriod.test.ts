import { describe, expect, it } from 'vitest';
import { parsePeriod } from './detectiveLogic';

const FULL: [number, number] = [1981, 2025];
const ask = (t: string) => parsePeriod(t, FULL);

describe('the years a question asks about', () => {
  it('reads a range and removes it from the text', () => {
    expect(ask('what is changing in Europe from 2016 to 2025')).toEqual({ period: [2016, 2025], rest: 'what is changing in Europe', adjusted: false });
    expect(ask('Turkey 2000-2020')).toEqual({ period: [2000, 2020], rest: 'Turkey', adjusted: false });
    expect(ask('rain in Brazil between 1990 and 2010?')).toEqual({ period: [1990, 2010], rest: 'rain in Brazil ?', adjusted: false });
    expect(ask('2010–2025 Istanbul').period).toEqual([2010, 2025]);
    expect(ask('Shanghai 2025 to 2005').period).toEqual([2005, 2025]); // either order
  });
  it('reads an open start or end', () => {
    expect(ask('Istanbul since 2005')).toEqual({ period: [2005, 2025], rest: 'Istanbul', adjusted: false });
    expect(ask('Sahara until 2000').period).toEqual([1981, 2000]);
    expect(ask('Japan after 1995').period).toEqual([1995, 2025]);
  });
  it('reads "the last N years" and decades', () => {
    expect(ask('what changed in Spain in the last 20 years')).toEqual({ period: [2006, 2025], rest: 'what changed in Spain', adjusted: false });
    expect(ask('Kenya over the past decade').period).toEqual([2016, 2025]);
    expect(ask('Canada last two decades').period).toEqual([2006, 2025]);
    expect(ask('India last thirty years').period).toEqual([1996, 2025]);
  });
  it('widens a request that is too short or outside the data, and says so', () => {
    expect(ask('Istanbul 2020-2025')).toEqual({ period: [2016, 2025], rest: 'Istanbul', adjusted: true });
    expect(ask('Paris from 1950 to 2000')).toEqual({ period: [1981, 2000], rest: 'Paris', adjusted: true });
    expect(ask('Rome 1981-1985').period).toEqual([1981, 1990]);
    expect(ask('Oslo in the last 5 years')).toMatchObject({ period: [2016, 2025], adjusted: true });
    expect(ask('Lima since 2022')).toMatchObject({ period: [2016, 2025], adjusted: true });
  });
  it('leaves text without years alone', () => {
    expect(ask('what is changing in Europe?')).toEqual({ period: null, rest: 'what is changing in Europe?', adjusted: false });
    expect(ask('41.0, 28.9').period).toBeNull(); // a latitude and longitude, not years
    expect(ask('the last years in Peru').period).toBeNull(); // no number given
    expect(ask('Lastovo').period).toBeNull();
  });
});
