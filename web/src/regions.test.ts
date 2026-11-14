import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildAnswer, lastSummary, placeHeader, type NamedPlace } from './detectiveLogic';
import { groupDigits, regionRank, shareSentence, type RegionRec } from './regions';
import { plainLine, type SummaryMeta } from './whatsChanging';

const DATA = new URL('../public/data/', import.meta.url);
const FIXTURE = new URL('../../pipeline/tests/fixtures/region_cases.json', import.meta.url);
const meta = JSON.parse(readFileSync(new URL('summary.json', DATA), 'utf8')) as SummaryMeta;
const shipped = JSON.parse(readFileSync(new URL('regions.json', DATA), 'utf8')) as { regions: RegionRec[] };
const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { years: [number, number]; regions: RegionRec[] };
const rec = (name: string) => fixture.regions.find((r) => r.name === name)!;

describe('regionRank against the pipeline fixture (Europe, Africa)', () => {
  it('the fixture is what is shipped (the shipped file also carries the evaluation layer\'s `quality` per variable)', () => {
    const withoutQuality = (g: RegionRec): RegionRec => ({
      ...g,
      variables: Object.fromEntries(Object.entries(g.variables).map(([v, e]) => [v, e ? { ...e, quality: undefined } : e])),
    });
    for (const r of fixture.regions) expect(withoutQuality(shipped.regions.find((x) => x.name === r.name)!)).toEqual(r);
  });
  it('Europe: values copied, ranked significant > possible > none, strength = |slope| / spread', () => {
    const { rank } = regionRank(rec('Europe'), meta);
    const spread = new Map(meta.variables.map((v) => [v.variable, v.spread]));
    for (const e of rank.ranked) {
      const f = rec('Europe').variables[e.variable]!;
      expect(e.slopePerDecade).toBe(f.slopePerDecade);
      expect(e.p).toBe(f.p);
      expect(e.strength).toBeCloseTo(Math.abs(f.slopePerDecade) / spread.get(e.variable)!, 12);
      expect(e.kind).toBe(f.p < 0.05 ? 'significant' : f.p < 0.1 ? 'possible' : 'none');
    }
    const tiers = rank.ranked.map((e) => (e.kind === 'significant' ? 0 : e.kind === 'possible' ? 1 : 2));
    expect(tiers).toEqual([...tiers].sort((a, b) => a - b));
    // within a tier: strongest first
    for (let k = 1; k < rank.ranked.length; k++) {
      if (tiers[k] === tiers[k - 1]) expect(rank.ranked[k - 1].strength).toBeGreaterThanOrEqual(rank.ranked[k].strength);
    }
    const sig = rank.ranked.filter((e) => e.kind === 'significant');
    const best = [...sig].sort((a, b) => Math.abs(b.slopePerDecade) / spread.get(b.variable)! - Math.abs(a.slopePerDecade) / spread.get(a.variable)!)[0];
    expect(rank.ranked[0].variable).toBe(best.variable);
    expect(rank.noData.map((d) => d.variable)).toEqual(['FRSEAICE']);
    expect(rank.ranked).toHaveLength(9);
  });
  it('Europe temperature line and its second sentence use the fixture numbers', () => {
    const { rank, extras } = regionRank(rec('Europe'), meta);
    const f = rec('Europe').variables.T2M!;
    const e = rank.ranked.find((x) => x.variable === 'T2M')!;
    expect(plainLine(e)).toContain('+0.44');
    expect(extras.get('T2M')).toBe(`The map shows a significant rise on ${Math.round(f.fracRising * 100)}% of its land.`);
    expect(extras.get('T2M')).toMatch(/rise on 9\d% of its land/);
  });
  it('Africa: snow cover rests on under 5% of its cells (139 of 8,187), so it is "no data" for the continent', () => {
    const { rank, extras } = regionRank(rec('Africa'), meta);
    expect(rank.noData.map((n) => n.variable)).toContain('FRSNO');
    expect(rank.ranked.map((r) => r.variable)).not.toContain('FRSNO');
    expect(extras.has('FRSNO')).toBe(false);
    expect(rec('Africa').variables.FRSEAICE).toBeNull();
  });
  it('a variable with data on part of the region (5% to 95% of its cells) says how many cells it is based on', () => {
    const africa = rec('Africa');
    const snow = africa.variables.FRSNO as NonNullable<typeof africa.variables.FRSNO>;
    const half = { ...africa, variables: { ...africa.variables, FRSNO: { ...snow, nWithData: 4000 } } };
    const { rank, extras } = regionRank(half, meta);
    expect(rank.ranked.map((r) => r.variable)).toContain('FRSNO');
    expect(extras.get('FRSNO')).toMatch(/^Based on the 4,000 of 8,187 cells that have data\./);
  });
  it('the answer: header, lines in rank order with their second sentence, no-clear and no-data lines', () => {
    const europe = rec('Europe');
    const { rank, extras } = regionRank(europe, meta);
    const place: NamedPlace = { kind: 'region', name: 'Europe', lat: 52, lng: 15, country: null, countryIdx: null, seaIdx: null, nCells: europe.nCells };
    const header = placeHeader(place, rank.cellKm);
    expect(header).toBe(`What's changing across Europe (average over its land, ${groupDigits(europe.nCells)} grid cells of about 50 km, 1981–2025):`);
    const a = buildAnswer(rank, header, [], extras);
    expect(a.lines.every((l) => l.kind !== undefined && l.text.includes(l.label))).toBe(true);
    expect(a.lines[0].extra).toMatch(/^The map shows a significant/);
    expect(a.noData).toBe('No data here: Sea ice.');
    expect(a.noClear).toBe('No clear trend: Soil moisture.');
    const last = lastSummary('Europe', rank, a, true);
    expect(last).toMatchObject({ place: 'Europe', cell: null, region: true });
    expect(last.lines.length).toBe(a.lines.length);
  });
});

describe('shareSentence', () => {
  const base: RegionRec = { name: 'X', centre: [0, 0], altitude: 2, nCells: 1000, topCountries: [], variables: {} };
  const v = (r: number, f: number, n = 1000) => ({ slopePerDecade: 1, ciLow: 0, ciHigh: 2, p: 0.01, nCells: 1000, nWithData: n, fracRising: r, fracFalling: f });
  it('rise only, fall only, both, neither', () => {
    expect(shareSentence(base, v(0.83, 0))).toBe('The map shows a significant rise on 83% of its land.');
    expect(shareSentence(base, v(0.004, 0.37))).toBe('The map shows a significant fall on 37% of its land.');
    expect(shareSentence(base, v(0.12, 0.08))).toBe('The map shows a significant rise on 12% of its land and a significant fall on 8%.');
    expect(shareSentence(base, v(0.009, 0.004))).toBe('');
  });
  it('the world and partial coverage', () => {
    expect(shareSentence({ ...base, name: 'World' }, v(0.5, 0))).toBe('The map shows a significant rise on 50% of the land.');
    expect(shareSentence(base, v(0.5, 0, 300))).toBe('Based on the 300 of 1,000 cells that have data. The map shows a significant rise on 50% of those cells.');
  });
});
