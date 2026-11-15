import { describe, expect, it } from 'vitest';
import { buildAnswer } from './detectiveLogic';
import { decodeCell, parseQuality, qualityAt } from '../evaluation/qualityData';
import type { VarQuality } from '../evaluation/quality';
import { regionRank, type RegionRec } from '../areas/regions';
import { parseSummary, type SummaryMeta } from './whatsChanging';
import type { RankResult, RankedEntry } from './whatsChanging';

const entry = (variable: string, label: string, slope: number, p: number): RankedEntry => ({
  variable, label, slopePerDecade: slope, units: '°C per decade', unitsShort: '°C', p, pAdjusted: p, verdict: '',
  kind: p < 0.05 ? 'significant' : p < 0.1 ? 'possible' : 'none', direction: slope > 0 ? 'rising' : 'falling', strength: Math.abs(slope),
});
const none = { step: false, oneYear: false, reversal: false, endSensitive: false };
const vq = (grade: VarQuality['grade'], flags: Partial<VarQuality['flags']> = {}, stepYear: number | null = null, outlierYear: number | null = null): VarQuality => ({
  grade, flags: { ...none, ...flags }, stepYear, outlierYear,
});

describe('buildAnswer with quality', () => {
  const rank: RankResult = {
    cell: { lat: 41, lng: 28.75 }, cellKm: 100, noData: [],
    ranked: [entry('A', 'Alpha', 0.5, 0.0001), entry('B', 'Beta', -1, 0.003), entry('C', 'Gamma', 0.3, 0.075), entry('D', 'Delta', 0.1, 0.5)],
  };
  const q = new Map<string, VarQuality>([
    ['A', vq('robust')],
    ['B', vq('caution', { step: true }, 1999)],
    ['C', vq('doubtful', { oneYear: true }, null, 2010)],
  ]);
  it('gives each shown line its grade, flags and (first flag only) reason; the order does not change', () => {
    const a = buildAnswer(rank, 'H', [], undefined, q);
    expect(a.lines.map((l) => [l.variable, l.grade])).toEqual([['A', 'robust'], ['B', 'caution'], ['C', 'doubtful']]);
    expect(a.lines[0].reasons).toEqual([]);
    expect(a.lines[1].reasons).toEqual(['Looks like a jump around 1999 rather than a gradual change.']);
    expect(a.lines[1].flags).toEqual({ ...none, step: true });
    expect(a.lines[2].reasons).toEqual(['Depends on one unusual year (2010).']);
  });
  it('without quality data there is no grade at all (never a guess)', () => {
    const a = buildAnswer(rank, 'H');
    expect(a.lines.every((l) => l.grade === null && l.flags === null && l.reasons.length === 0)).toBe(true);
  });
  it('many tests: significant on its own but not after Holm -> note, and robust becomes caution', () => {
    const ten: RankResult = {
      cell: { lat: 0, lng: 0 }, cellKm: 100, noData: [],
      ranked: [entry('A', 'Alpha', 0.5, 0.01), entry('B', 'Beta', 0.4, 0.03), ...[0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((p, i) => entry(`V${i}`, `V${i}`, 0.1, p))],
    };
    const a = buildAnswer(ten, 'H', [], undefined, new Map([['A', vq('robust')], ['B', vq('doubtful', { step: true, reversal: true }, 2001)]]));
    // Holm over 10: 0.01 -> 0.10, 0.03 -> 0.27: both >= 0.05
    expect(a.lines[0]).toMatchObject({ grade: 'caution', reasons: ['Significant on its own, but not after allowing for the 10 variables tested at this place: the more are tested, the likelier one looks significant by chance.'] });
    expect(a.lines[1].grade).toBe('doubtful');
    expect(a.lines[1].reasons).toEqual(['Looks like a jump around 2001 rather than a gradual change.', 'Significant on its own, but not after allowing for the 10 variables tested at this place: the more are tested, the likelier one looks significant by chance.']);
  });
});

describe('quality.bin lookup', () => {
  it('decodes a cell: flags bits 0-3, grade bits 4-5, years 0 = none', () => {
    expect(decodeCell(0b00_11_0101, 1999, 0)).toEqual({ grade: 'doubtful', flags: { step: true, oneYear: false, reversal: true, endSensitive: false }, stepYear: 1999, outlierYear: null });
    expect(decodeCell(0b0001_0000, 0, 0).grade).toBe('robust');
    expect(decodeCell(0b0010_0000, 0, 0).grade).toBe('caution');
  });
  it('qualityAt uses the same rows as the summary', () => {
    // 1 x 2 grid, one variable: only cell 1 has data.
    const sm: SummaryMeta & { bytes: number } = {
      nlat: 1, nlon: 2, lat0: 0, dlat: 1, lon0: 0, dlon: 1, years: [1981, 2025], cellKm: 100, bytes: 16,
      variables: [{ variable: 'A', label: 'Alpha', units: 'C', unitsShort: 'C', group: 'g', surface: 'any', count: 1, spread: 1, bitmapOffset: 0, slopeOffset: 4, pOffset: 8, qOffset: 12 }],
    };
    const sb = new ArrayBuffer(16);
    new Uint8Array(sb)[0] = 0b10;
    new DataView(sb).setFloat32(4, 0.5, true);
    new DataView(sb).setFloat32(8, 0.01, true);
    new DataView(sb).setUint16(12, 100, true);
    const summary = parseSummary(sm, sb);
    const qb = new ArrayBuffer(12);
    new Uint8Array(qb)[0] = 0b0010_0001;
    new Uint16Array(qb, 4, 1)[0] = 2004;
    const qd = parseQuality({ nlat: 1, nlon: 2, bytes: 12, variables: [{ variable: 'A', count: 1, flagsOffset: 0, stepYearOffset: 4, outlierYearOffset: 8 }] }, qb);
    const m = qualityAt(qd, summary, 0, 1);
    expect(m.get('A')).toEqual({ grade: 'caution', flags: { step: true, oneYear: false, reversal: false, endSensitive: false }, stepYear: 2004, outlierYear: null });
    expect(qualityAt(qd, summary, 0, 0).size).toBe(0);
  });
});

describe('regionRank carries the region quality', () => {
  it('qualities map from regions.json quality', () => {
    const meta: SummaryMeta = {
      nlat: 1, nlon: 1, lat0: 0, dlat: 1, lon0: 0, dlon: 1, years: [1981, 2025], cellKm: 100,
      variables: [{ variable: 'T2M', label: 'Air temperature', units: 'C', unitsShort: 'C', group: 'g', surface: 'any', count: 1, spread: 1, bitmapOffset: 0, slopeOffset: 0, pOffset: 0, qOffset: 0 }],
    };
    const rec: RegionRec = {
      name: 'X', centre: [0, 0], altitude: 2, nCells: 100, topCountries: [],
      variables: { T2M: { slopePerDecade: 0.4, ciLow: 0.2, ciHigh: 0.6, p: 0.001, nCells: 100, nWithData: 100, fracRising: 0.5, fracFalling: 0,
        quality: { ...none, step: true, grade: 'caution', stepYear: 2001, outlierYear: null } } },
    };
    const { rank, qualities } = regionRank(rec, meta);
    expect(qualities.get('T2M')).toEqual({ grade: 'caution', flags: { ...none, step: true }, stepYear: 2001, outlierYear: null });
    expect(buildAnswer(rank, 'H', [], undefined, qualities).lines[0].grade).toBe('caution');
  });
});

describe('buildAnswer with the independent check', () => {
  const rank: RankResult = {
    cell: { lat: 41, lng: 28.75 }, cellKm: 100, noData: [],
    ranked: [entry('T2M', 'Air temperature', 0.5, 0.0001), entry('PRECTOTCORR', 'Rainfall', 0.2, 0.003), entry('Z', 'Zed', 0.1, 0.01), entry('Y', 'Why', 0.1, 0.02)],
  };
  const q = new Map<string, VarQuality>(['T2M', 'PRECTOTCORR', 'Z', 'Y'].map((v) => [v, vq('robust')]));
  const checks = new Map<string, { cls: 'confirmed' | 'unconfirmed' | 'contradicted'; short: string }>([
    ['T2M', { cls: 'confirmed', short: 'NASA GISTEMP' }],
    ['PRECTOTCORR', { cls: 'unconfirmed', short: 'GPCP' }],
  ]);
  it('caps the grade, adds the short reason or the confirmed tail, leaves other variables alone', () => {
    const a = buildAnswer(rank, 'H', [], undefined, q, checks);
    const by = Object.fromEntries(a.lines.map((l) => [l.variable, l]));
    expect(by.T2M).toMatchObject({ grade: 'robust', reference: 'confirmed', referenceTail: ' · Confirmed by NASA GISTEMP', reasons: [] });
    expect(by.PRECTOTCORR).toMatchObject({ grade: 'caution', reference: 'unconfirmed', referenceTail: null, reasons: ['Not confirmed by GPCP.'] });
    expect(by.Z).toMatchObject({ grade: 'robust', reference: null, referenceTail: null, reasons: [] });
    const c = buildAnswer(rank, 'H', [], undefined, q, new Map([['PRECTOTCORR', { cls: 'contradicted' as const, short: 'GPCP' }]]));
    expect(c.lines.find((l) => l.variable === 'PRECTOTCORR')).toMatchObject({ grade: 'doubtful', reasons: ['Contradicted by GPCP.'] });
  });
  it('with several records: "k of n" texts, partly caps at caution, contradicted at doubtful', () => {
    const run = (cls: 'confirmed' | 'partly' | 'unconfirmed' | 'contradicted', n: number, k: number, c: number) =>
      buildAnswer(rank, 'H', [], undefined, q, new Map([['PRECTOTCORR', { cls, short: 'GPCP', n, k, c }]])).lines.find((l) => l.variable === 'PRECTOTCORR')!;
    expect(run('confirmed', 4, 3, 0)).toMatchObject({ grade: 'robust', referenceTail: ' · Confirmed by 3 of 4 records', reasons: [] });
    expect(run('partly', 4, 1, 0)).toMatchObject({ grade: 'caution', reference: 'partly', reasons: ['Confirmed by only 1 of 4 records.'] });
    expect(run('unconfirmed', 4, 0, 0)).toMatchObject({ grade: 'caution', reasons: ['Not confirmed by any of 4 records.'] });
    expect(run('contradicted', 4, 0, 2)).toMatchObject({ grade: 'doubtful', reasons: ['Contradicted by 2 of 4 records.'] });
  });
  it('without checks nothing changes', () => {
    const a = buildAnswer(rank, 'H', [], undefined, q);
    expect(a.lines.every((l) => l.reference === null && l.referenceTail === null && l.grade === 'robust')).toBe(true);
  });
});
