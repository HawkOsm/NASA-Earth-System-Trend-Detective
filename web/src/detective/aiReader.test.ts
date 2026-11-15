import { describe, expect, it } from 'vitest';
import { aiEnabled, parseReading, readQuestion, readingSentence } from './aiReader';

describe('the AI reader: what the server returns is checked before it is used', () => {
  it('keeps a well-formed reading', () => {
    expect(parseReading({ place: 'Sahara', lat: 23, lng: 13, start: 1995, end: 2008, variable: null, model: 'gemini-3.6-flash' })).toEqual({
      place: 'Sahara', lat: 23, lng: 13, start: 1995, end: 2008, variable: null, model: 'gemini-3.6-flash',
    });
  });
  it('drops fields of the wrong type or range', () => {
    expect(parseReading({ place: 42, lat: 200, lng: 5, start: '1995', end: 1995.5, variable: 'CO2', model: 7 })).toEqual({
      place: null, lat: null, lng: null, start: null, end: null, variable: null, model: null,
    });
    expect(parseReading({ place: 'Gobi', lat: 42.5, lng: 500 })).toMatchObject({ place: 'Gobi', lat: null, lng: null });
    expect(parseReading('text')).toBeNull();
    expect(parseReading(null)).toBeNull();
  });
  it('says how the question was read', () => {
    const r = parseReading({ place: 'Gobi Desert', lat: 42.5, lng: 103.5, start: 1990, end: 1999, variable: 'PRECTOTCORR' })!;
    expect(readingSentence(r, [1990, 1999])).toBe('Gemini read this as: Gobi Desert, 1990–1999, about rainfall.');
    expect(readingSentence(parseReading({})!, null)).toBeNull();
  });
  it('can be switched off in the address', () => {
    expect(aiEnabled('')).toBe(true);
    expect(aiEnabled('?ai=0')).toBe(false);
    expect(aiEnabled('?tour=0&ai=1')).toBe(true);
  });
});

describe('the AI reader never breaks the Detective', () => {
  const ok = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  it('returns the reading on success', async () => {
    expect(await readQuestion('snow in the alps', ok({ place: 'Alps', lat: 46.5, lng: 10, start: null, end: null, variable: 'FRSNO' }))).toMatchObject({ place: 'Alps', variable: 'FRSNO' });
  });
  it('returns null when the server refuses, fails, or answers nonsense', async () => {
    expect(await readQuestion('x', ok({ error: 'Too many questions in a minute.' }, 429))).toBeNull();
    expect(await readQuestion('x', (async () => { throw new Error('offline'); }) as unknown as typeof fetch)).toBeNull();
    expect(await readQuestion('x', (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch)).toBeNull();
  });
  it('returns null on a timeout', async () => {
    const slow = ((_: unknown, init?: RequestInit) => new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))))) as unknown as typeof fetch;
    expect(await readQuestion('x', slow, 30)).toBeNull();
  });
});
