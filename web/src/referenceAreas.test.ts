import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { areaCheck, areaLineChecks, loadAreaReference, resetAreaReferenceCache, COVERAGE_REASON, type AreaEntry, type AreaRefData } from './referenceAreas';
import { combineGrade } from './reference';
import type { RankResult } from './whatsChanging';

const entry = (over: Partial<AreaEntry> = {}): AreaEntry => ({ refSlope: 0.4, refP: 0.001, merraSlope: 0.38, sizeDiffers: false, coverage: 0.93, badYears: [], ...over });
const data = (over: Partial<AreaRefData> = {}): AreaRefData => ({
  source: { name: 'x', short: 'NASA GISTEMP', what: 'thermometer and ship records', boxKm: 220 },
  countries: { '5': entry() },
  seas: {},
  regions: { Europe: entry({ refSlope: 0.5, badYears: [2003, 2010] }) },
  unchecked: { countries: { '7': 'coverage' }, seas: { '2': 'sea', '3': 'coverage' }, regions: {} },
  ...over,
});
const base = { variable: 'T2M', fullPeriod: true, verdictKind: 'significant' as const, slope: 0.35, unitsLong: '°C' };

describe('areaCheck', () => {
  it('confirmed: class, sentence in area wording, coverage, no box coordinates', () => {
    const c = areaCheck({ ...base, data: data(), kind: 'countries', key: '5' });
    expect(c.cls).toBe('confirmed');
    expect(c.short).toBe('NASA GISTEMP');
    expect(c.sentence).toMatch(/^Confirmed by an independent record: NASA GISTEMP \(thermometer and ship records\) shows \+0\.4.* °C per decade averaged over the same area \(/);
    expect(c.sentence).not.toMatch(/km box|around this place/);
    expect(c.coverage).toBe(0.93);
    expect(c.boxLat).toBeNull();
    expect(c.boxLng).toBeNull();
    expect(c.refSlope).toBe(0.4);
  });
  it('unconfirmed and contradicted by the sign / significance of the area record', () => {
    expect(areaCheck({ ...base, data: data({ countries: { '5': entry({ refP: 0.4 }) } }), kind: 'countries', key: '5' }).cls).toBe('unconfirmed');
    const c = areaCheck({ ...base, data: data({ countries: { '5': entry({ refSlope: -0.3 }) } }), kind: 'countries', key: '5' });
    expect(c.cls).toBe('contradicted');
    expect(c.sentence).toMatch(/^Contradicted by an independent record:.*, averaged over the same area\.$/);
    expect(c.sentence).not.toMatch(/km box/);
    expect(combineGrade('robust', c.cls)).toBe('doubtful');
  });
  it('a site trend with no verdict gets the plain info line', () => {
    const c = areaCheck({ ...base, verdictKind: 'none', data: data(), kind: 'countries', key: '5' });
    expect(c.cls).toBe('info');
    expect(c.sentence).toMatch(/^(Independent record: |MERRA-2 shows no clear trend here, but an independent record does: ).*averaged over the same area/);
  });
  it('size difference sentence says area, not box', () => {
    const c = areaCheck({ ...base, data: data({ countries: { '5': entry({ sizeDiffers: true, merraSlope: 0.9 }) } }), kind: 'countries', key: '5' });
    expect(c.sentence).toMatch(/averaged over the same area MERRA-2 shows \+0\.9/);
    expect(c.sentence).not.toMatch(/box/);
  });
  it('unchecked: sea (temperature) and coverage', () => {
    const sea = areaCheck({ ...base, data: data(), kind: 'seas', key: '2' });
    expect(sea.cls).toBe('none');
    expect(sea.sentence).toBe('No independent record can check this here (over the sea the temperature record measures the water, not the air).');
    expect(sea.coverage).toBeNull();
    const cov = areaCheck({ ...base, data: data(), kind: 'countries', key: '7' });
    expect(cov.sentence).toBe(`No independent record can check this here (${COVERAGE_REASON}).`);
    expect(COVERAGE_REASON).toBe('the record covers less than half of this area');
    expect(combineGrade('robust', cov.cls)).toBe('robust');
    // an area missing from both maps is treated as "coverage"
    expect(areaCheck({ ...base, data: data(), kind: 'countries', key: '999' }).sentence).toContain(COVERAGE_REASON);
  });
  it('custom period: no class, the existing text', () => {
    const c = areaCheck({ ...base, fullPeriod: false, data: data(), kind: 'countries', key: '5' });
    expect(c.cls).toBeNull();
    expect(c.sentence).toBe('The independent check covers the full period 1981–2025 only.');
  });
  it('variable without a record: not compared', () => {
    const c = areaCheck({ ...base, variable: 'RH2M', data: null, kind: 'countries', key: '5' });
    expect(c.cls).toBe('none');
    expect(c.sentence).toBe('No independent record has been compared for this variable yet.');
  });
  it('bad years: the same sentence, and the "Without" line is recomputed on the area series', () => {
    const years = Array.from({ length: 45 }, (_, k) => 1981 + k);
    const values = years.map((y, k) => 10 + 0.03 * k + (y === 2003 ? 3 : 0) + (y === 2010 ? -3 : 0) + (k % 2 ? 0.1 : -0.1));
    const c = areaCheck({ ...base, data: data(), kind: 'regions', key: 'Europe', series: { years, values } });
    expect(c.badYears).toEqual([2003, 2010]);
    expect(c.badSentence).toBe('NASA GISTEMP (thermometer and ship records) disagrees with MERRA-2 here for 2003 and 2010.');
    expect(c.withoutSentence).toMatch(/^Without 2003 and 2010: \+0\.\d+ °C per decade \(/);
    expect(c.slopeWithout).toBeCloseTo(0.3, 1);
  });
});

describe('areaCheck with several records', () => {
  const recs = [{ short: 'GPCP', name: 'g', what: 'rain gauges and satellites' }, { short: 'CMAP', name: 'c', what: 'rain gauges and satellites' }, { short: 'GPCC', name: 'g', what: 'rain gauges' }, { short: 'PREC/L', name: 'p', what: 'rain gauges' }];
  const mk = (rows: [number, number][]) => data({
    source: { name: 'x', short: 'GPCP', what: 'rain gauges and satellites', boxKm: 280 },
    records: recs,
    countries: { '5': entry({ refSlope: rows[0][0], refP: rows[0][1], records: rows.map((r, i) => ({ short: recs[i].short, refSlope: r[0], refP: r[1], coverage: 1 })) }) },
  });
  it('confirmed by 3 of 4 in area wording; n, k, c and records for the hook', () => {
    const c = areaCheck({ ...base, variable: 'PRECTOTCORR', unitsLong: 'mm/day', slope: 0.5, data: mk([[0.09, 0.5], [0.56, 0.001], [0.44, 0.006], [0.48, 0.001]]), kind: 'countries', key: '5' });
    expect(c).toMatchObject({ cls: 'confirmed', n: 4, k: 3, c: 0 });
    expect(c.sentence).toBe('Confirmed by 3 of 4 independent records (CMAP, GPCC and PREC/L): they show +0.44 to +0.56 mm/day per decade averaged over the same area. GPCP shows no significant change.');
    expect(c.records.map((r) => r.short)).toEqual(['GPCP', 'CMAP', 'GPCC', 'PREC/L']);
  });
  it('a record that does not cover the area is not counted', () => {
    const d = mk([[0.3, 0.001], [0.2, 0.01], [0.2, 0.01], [0.2, 0.01]]);
    d.countries['5'].records = d.countries['5'].records!.slice(0, 2);
    const c = areaCheck({ ...base, variable: 'PRECTOTCORR', unitsLong: 'mm/day', slope: 0.3, data: d, kind: 'countries', key: '5' });
    expect(c).toMatchObject({ n: 2, k: 2 });
    expect(c.records.map((r) => r.available)).toEqual([true, true, false, false]);
  });
  it('unconfirmed by all', () => {
    const c = areaCheck({ ...base, variable: 'PRECTOTCORR', unitsLong: 'mm/day', slope: 0.3, data: mk([[0.01, 0.6], [0.0, 0.9], [0.02, 0.5], [0.01, 0.7]]), kind: 'countries', key: '5' });
    expect(c.sentence).toBe('Not confirmed by any of 4 independent records (GPCP, CMAP, GPCC and PREC/L): none shows a significant change averaged over the same area.');
  });
});

describe('areaLineChecks (Detective, continents)', () => {
  const rank = {
    cell: { lat: 0, lng: 0 }, cellKm: 50, noData: [],
    ranked: [
      { variable: 'T2M', label: 'Air temperature', slopePerDecade: 0.4, units: '°C per decade', kind: 'significant' },
      { variable: 'RH2M', label: 'Humidity', slopePerDecade: 1, units: '% per decade', kind: 'significant' },
    ],
  } as unknown as RankResult;
  it('gives cls and short for reference variables only', () => {
    const m = areaLineChecks(rank, new Map([['T2M', data()]]), 'regions', 'Europe');
    expect(m.get('T2M')).toEqual({ cls: 'confirmed', short: 'NASA GISTEMP', n: 1, k: 1, c: 0 });   // updated: also carries n, k, c
    expect(m.has('RH2M')).toBe(false);
  });
});

describe('loader', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetAreaReferenceCache();
  });
  it('fetches areas_<VAR>.json once, caches it, and does not fetch for other variables', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => data() }) as Response);
    vi.stubGlobal('fetch', f);
    const a = await loadAreaReference('T2M');
    const b = await loadAreaReference('T2M');
    expect(a).toBe(b);
    expect(f).toHaveBeenCalledTimes(1);
    expect(String((f.mock.calls as unknown[][])[0][0])).toMatch(/data\/reference\/areas_T2M\.json/);
    expect(await loadAreaReference('RH2M')).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('a failed load is not cached', async () => {
    const f = vi.fn().mockResolvedValueOnce({ ok: false, status: 500 }).mockResolvedValue({ ok: true, json: async () => data() });
    vi.stubGlobal('fetch', f);
    await expect(loadAreaReference('PRECTOTCORR')).rejects.toThrow(/HTTP 500/);
    expect((await loadAreaReference('PRECTOTCORR'))?.source.short).toBe('NASA GISTEMP');
  });
});

describe('the real files parse', () => {
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../public/data/reference');
  for (const v of ['T2M', 'PRECTOTCORR']) {
    it(`areas_${v}.json`, () => {
      const d = JSON.parse(readFileSync(resolve(dir, `areas_${v}.json`), 'utf8')) as AreaRefData;
      expect(d.source.short).toBeTruthy();
      expect(Object.keys(d.regions)).toContain('World');
      for (const e of [...Object.values(d.countries), ...Object.values(d.seas), ...Object.values(d.regions)]) {
        expect(e.coverage).toBeGreaterThanOrEqual(0.5);
        expect(e.coverage).toBeLessThanOrEqual(1);
        expect(Number.isFinite(e.refSlope) && Number.isFinite(e.refP) && Number.isFinite(e.merraSlope)).toBe(true);
      }
    });
  }
});
