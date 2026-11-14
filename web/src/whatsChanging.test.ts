import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { nearestCell, parseSummary, plainLine, rankAt, type SummaryMeta, type SummaryVariable } from './whatsChanging';
import { verdict } from './stats/trend';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = join(here, '..', 'public', 'data');
const FIXTURE = join(here, '..', '..', 'pipeline', 'tests', 'fixtures', 'summary_cases.json');

// ---- a tiny synthetic summary: 3 lat x 4 lon cells (lat -1..1, lon -180, -90, 0, 90), written like export_summary.py ----

interface Cell { slope: number; p: number; q: number }
const NLAT = 3;
const NLON = 4;

function build(vars: { name: string; units?: string; spread: number; cells: (Cell | null)[] }[]) {
  const ncell = NLAT * NLON;
  const parts: Uint8Array[] = [];
  let offset = 0;
  const put = (raw: Uint8Array) => {
    const padded = new Uint8Array(raw.length + ((4 - (raw.length % 4)) % 4));
    padded.set(raw);
    parts.push(padded);
    const at = offset;
    offset += padded.length;
    return at;
  };
  const variables: SummaryVariable[] = vars.map((v) => {
    const bits = new Uint8Array(Math.ceil(ncell / 8));
    v.cells.forEach((c, k) => {
      if (c) bits[k >> 3] |= 1 << (k & 7);
    });
    const have = v.cells.filter((c): c is Cell => c !== null);
    const slope = new Float32Array(have.map((c) => c.slope));
    const p = new Float32Array(have.map((c) => c.p));
    const q = new Uint16Array(have.map((c) => Math.round(c.q * 65535)));
    return {
      variable: v.name, label: `${v.name} label`, units: v.units ?? 'C', unitsShort: v.units ?? 'C', group: 'g', surface: 'any',
      count: have.length, spread: v.spread,
      bitmapOffset: put(bits), slopeOffset: put(new Uint8Array(slope.buffer)), pOffset: put(new Uint8Array(p.buffer)),
      qOffset: put(new Uint8Array(q.buffer)),
    };
  });
  const buf = new Uint8Array(offset);
  let at = 0;
  for (const part of parts) {
    buf.set(part, at);
    at += part.length;
  }
  const meta: SummaryMeta & { bytes: number } = {
    nlat: NLAT, nlon: NLON, lat0: -1, dlat: 1, lon0: -180, dlon: 90, years: [1981, 2025], cellKm: 100, variables, bytes: offset,
  };
  return { meta, buf: buf.buffer as ArrayBuffer };
}

const none = (n: number) => Array.from({ length: n }, () => null);
const cellAt = (i: number, j: number) => i * NLON + j;

describe('parseSummary / nearestCell', () => {
  it('round-trips the layout and rejects a wrong size', () => {
    const cells = none(12) as (Cell | null)[];
    cells[cellAt(1, 2)] = { slope: 0.25, p: 0.01, q: 0.02 };
    cells[cellAt(0, 0)] = { slope: -1.5, p: 0.5, q: 0.7 };
    const { meta, buf } = build([{ name: 'A', spread: 1, cells }]);
    const s = parseSummary(meta, buf);
    expect(s.blocks[0].rowOf[cellAt(0, 0)]).toBe(0);
    expect(s.blocks[0].rowOf[cellAt(1, 2)]).toBe(1);
    expect(s.blocks[0].rowOf[cellAt(2, 3)]).toBe(-1);
    expect(s.blocks[0].slope[1]).toBe(0.25);
    expect(() => parseSummary(meta, buf.slice(0, buf.byteLength - 4))).toThrow(/expected/);
  });
  it('nearest cell, longitude wraps and latitude clamps', () => {
    const { meta } = build([{ name: 'A', spread: 1, cells: none(12) }]);
    expect(nearestCell(meta, 0.2, -88)).toEqual([1, 1]);
    expect(nearestCell(meta, 0, 179)).toEqual([1, 0]); // 179 is nearer -180 (+360) than 90
    expect(nearestCell(meta, 0, 134)).toEqual([1, 3]); // index 3.49 rounds down
    expect(nearestCell(meta, 0, 136)).toEqual([1, 0]); // index 3.51 rounds to 4, which wraps to 0
    expect(nearestCell(meta, 5, 0)).toEqual([2, 2]); // latitude clamps
  });
});

describe('rankAt', () => {
  const k = cellAt(1, 2); // lat 0, lng 0
  const mk = (slope: number, p: number, q = p): Cell => ({ slope, p, q });
  const cells = (c: Cell | null) => {
    const a = none(12) as (Cell | null)[];
    a[k] = c;
    return a;
  };
  const { meta, buf } = build([
    { name: 'V1', spread: 2, cells: cells(mk(1, 0.2)) },            // none tier, strength 0.5
    { name: 'V2', spread: 0.5, cells: cells(mk(-0.4, 0.03)) },      // significant, strength 0.8
    { name: 'V3', spread: 1, cells: cells(null) },                  // no data here
    { name: 'V4', spread: 4, cells: cells(mk(0.8, 0.001)) },        // significant, strength 0.2
    { name: 'V5', spread: 1, cells: cells(mk(0.3, 0.07)) },         // possible
    { name: 'V6', spread: 0.5, cells: cells(mk(0.4, 0.04)) },       // significant, strength 0.8: tie with V2 -> variable order
    { name: 'V7', spread: 1, cells: cells(mk(0, 0.9)) },            // flat
    { name: 'V8', spread: 1, cells: cells(mk(2, 0.049999)) },       // p just under 0.05: significant, strength 2
    { name: 'V9', spread: 1, cells: cells(mk(5, 0.05)) },           // p = 0.05 is NOT significant -> possible, strength 5
  ]);
  const s = parseSummary(meta, buf);
  const r = rankAt(s, 0, 0);

  it('orders significant, then possible, then none; strength inside a tier; ties by variable order', () => {
    expect(r.ranked.map((e) => e.variable)).toEqual(['V8', 'V2', 'V6', 'V4', 'V9', 'V5', 'V1', 'V7']);
    expect(r.ranked.map((e) => e.kind)).toEqual(['significant', 'significant', 'significant', 'significant', 'possible', 'possible', 'none', 'none']);
  });
  it('strength = |slope| / spread and direction', () => {
    const by = Object.fromEntries(r.ranked.map((e) => [e.variable, e]));
    expect(by.V2.strength).toBeCloseTo(0.8, 6);
    expect(by.V4.strength).toBeCloseTo(0.2, 6);
    expect(by.V2.direction).toBe('falling');
    expect(by.V6.direction).toBe('rising');
    expect(by.V7.direction).toBe('flat');
    expect(by.V7.strength).toBe(0);
  });
  it('variables without data go to noData, never into the ranking', () => {
    expect(r.noData.map((e) => e.variable)).toEqual(['V3']);
    expect(r.ranked.some((e) => e.variable === 'V3')).toBe(false);
  });
  it('verdict text is the click panel verdict() and the p values are carried', () => {
    const e = r.ranked.find((x) => x.variable === 'V2')!;
    expect(e.verdict).toBe(verdict(e.slopePerDecade, e.p, '°C'));
    expect(e.verdict).toContain('statistically significant');
    expect(r.ranked.find((x) => x.variable === 'V5')!.verdict).toContain('Possible trend');
    expect(r.ranked.find((x) => x.variable === 'V1')!.verdict).toContain('No clear trend');
    expect(e.p).toBeCloseTo(0.03, 6);
    expect(e.units).toBe('°C per decade');
  });
  it('pAdjusted is the Uint16 value / 65535', () => {
    const { meta: m2, buf: b2 } = build([{ name: 'Q', spread: 1, cells: cells(mk(1, 0.01, 0.0123)) }]);
    const e = rankAt(parseSummary(m2, b2), 0, 0).ranked[0];
    expect(Math.abs(e.pAdjusted - 0.0123)).toBeLessThanOrEqual(1 / 65535);
  });
  it('reports the coarse cell and its size, and wraps the longitude', () => {
    expect(r.cell).toEqual({ lat: 0, lng: 0 });
    expect(r.cellKm).toBe(100);
    expect(rankAt(s, 0, 360).ranked.length).toBe(8); // 360 = 0
    expect(rankAt(s, 0, -360).cell.lng).toBe(0);
    expect(rankAt(s, 0, 90).ranked.length).toBe(0); // another cell: nothing there, everything is noData
    expect(rankAt(s, 0, 90).noData.length).toBe(9);
  });
});

describe('plainLine', () => {
  it('writes sign, units and the verdict class with p', () => {
    const base = { variable: 'T2M_MAX', label: 'Hottest temperature of the year', units: '°C per decade', unitsShort: '°C', pAdjusted: 0.1, verdict: '', direction: 'rising' as const, strength: 0.5 };
    expect(plainLine({ ...base, slopePerDecade: 0.38, p: 0.07, kind: 'possible' })).toBe(
      'Hottest temperature of the year: +0.38 °C per decade — possible trend (p = 0.07)',
    );
    expect(plainLine({ ...base, slopePerDecade: -0.6, p: 0.0004, kind: 'significant' })).toBe(
      'Hottest temperature of the year: -0.60 °C per decade — statistically significant (p < 0.001)',
    );
    expect(plainLine({ ...base, slopePerDecade: 0.1, p: 0.4, kind: 'none' })).toContain('no clear trend (p = 0.4)');
  });
});

// ---- the shipped file against the values the pipeline wrote ------------------------------------------------------

describe('shipped summary.bin', () => {
  const buf = readFileSync(join(DATA, 'summary.bin'));
  const meta = JSON.parse(readFileSync(join(DATA, 'summary.json'), 'utf8')) as SummaryMeta & { bytes: number };
  const s = parseSummary(meta, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const fx = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
    places: Record<string, { lat: number; lng: number; variables: Record<string, { slope: number; p: number; q: number } | null> }>;
  };

  it('has the 10 variables of the site and the cell size', () => {
    expect(s.variables.map((v) => v.variable)).toEqual(['T2M', 'PRECTOTCORR', 'WS2M', 'T2M_MAX', 'GWETROOT', 'EVLAND', 'RH2M', 'FRSNO', 'FRSEAICE', 'TO3']);
    expect(s.cellKm).toBe(100);
  });
  for (const place of ['Istanbul', 'Cebu', 'Porto Velho']) {
    it(`${place}: every variable equals the pipeline fixture (slope and p within 1e-6, q within 1/65535)`, () => {
      const f = fx.places[place];
      const r = rankAt(s, f.lat, f.lng);
      for (const [v, want] of Object.entries(f.variables)) {
        const got = r.ranked.find((e) => e.variable === v);
        if (want === null) {
          expect(got, `${place} ${v} should have no data`).toBeUndefined();
          expect(r.noData.some((e) => e.variable === v)).toBe(true);
        } else {
          expect(got, `${place} ${v}`).toBeDefined();
          expect(Math.abs(got!.slopePerDecade - want.slope)).toBeLessThan(1e-6);
          expect(Math.abs(got!.p - want.p)).toBeLessThan(1e-6);
          expect(Math.abs(got!.pAdjusted - want.q)).toBeLessThanOrEqual(1 / 65535);
        }
      }
      expect(r.ranked.length + r.noData.length).toBe(10);
    });
  }
});
