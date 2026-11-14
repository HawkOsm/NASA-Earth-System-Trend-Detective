import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  classSentence,
  CUSTOM_PERIOD_TEXT,
  NOT_COMPARED_TEXT,
  boxAt,
  classify,
  combineGrade,
  referenceCheck,
  shortCheckText,
  summaryLine,
  yearsText,
  type RefBox,
  type RefData,
} from './reference';

/** A tiny 3 x 4 grid of 10 degree boxes: lat centres -10, 0, 10 (edges -15..15); lon centres -15, -5, 5, 15 (edges -20..20). */
function tiny(over: Partial<RefData> = {}): RefData {
  const n = 12;
  return {
    source: { name: 'x', short: 'GPCP', what: 'rain gauges and satellites', boxKm: 280 },
    lat0: -10, dlat: 10, nlat: 3, lon0: -15, dlon: 10, nlon: 4,
    years: [], refSlope: Array(n).fill(0.1), refP: Array(n).fill(0.01), merraSlope: Array(n).fill(0.2), merraP: Array(n).fill(0.01), agree: Array(n).fill(1),
    land: Array(n).fill(1), eligible: Array(n).fill(1), badYears: {},
    summary: { confirmed: 0.26, contradicted: 0.06, unconfirmed: 0.68, eligibleShareOfGlobe: 0.8, nBoxes: 12 },
    ...over,
  };
}

describe('boxAt', () => {
  it('finds the box, lower edges inclusive', () => {
    const r = tiny();
    expect(boxAt(r, 0, 0)).toMatchObject({ index: 1 * 4 + 2, lat: 0, lng: 5 }); // lng 0 is the lower edge of the box centred 5
    expect(boxAt(r, 5, -5)).toMatchObject({ index: 2 * 4 + 1 }); // lat 5 is the lower edge of the box centred 10
    expect(boxAt(r, 4.999, -5)).toMatchObject({ index: 1 * 4 + 1 });
    expect(boxAt(r, -15, -20)).toMatchObject({ index: 0 });
  });
  it('wraps longitude and clamps the top row', () => {
    const r = tiny();
    expect(boxAt(r, 0, 20)?.index).toBe(1 * 4 + 0); // lng 20 wraps to the lower edge of the first box
    expect(boxAt(r, 0, 340)?.index).toBe(4); // 340 = -20, the lower edge of the first box
    expect(boxAt(r, 0, -21)?.index).toBe(1 * 4 + 3);
    expect(boxAt(r, 15, 0)?.index).toBe(2 * 4 + 2); // top edge: clamped into the top row
    expect(boxAt(r, 90, 0)?.index).toBe(2 * 4 + 2);
  });
  it('is null for a box that is not eligible', () => {
    const e = Array(12).fill(1);
    e[1 * 4 + 2] = 0;
    expect(boxAt(tiny({ eligible: e }), 0, 0)).toBeNull();
  });
  it('returns the bad years of the box', () => {
    expect(boxAt(tiny({ badYears: { '6': [2020, 2021] } }), 0, 0)?.badYears).toEqual([2020, 2021]);
  });
});

const box = (refSlope: number, refP: number): RefBox => ({ index: 0, lat: 0, lng: 0, refSlope, refP, merraSlope: null, sizeDiffers: false, badYears: [] });

describe('classify', () => {
  it('follows the definitions', () => {
    expect(classify('significant', 0.3, null)).toBe('none');
    expect(classify('none', 0.3, box(0.1, 0.01))).toBe('info');
    expect(classify('significant', 0.3, box(0.1, 0.01))).toBe('confirmed');
    expect(classify('significant', 0.3, box(-0.1, 0.01))).toBe('contradicted');
    expect(classify('possible', -0.3, box(-0.1, 0.049))).toBe('confirmed');
    expect(classify('significant', 0.3, box(0.1, 0.05))).toBe('unconfirmed');
    expect(classify('significant', 0.3, box(-0.1, 0.5))).toBe('unconfirmed');
  });
});

describe('combineGrade', () => {
  it('takes the worse of the pattern grade and the cap', () => {
    expect(combineGrade('robust', 'unconfirmed')).toBe('caution');
    expect(combineGrade('robust', 'contradicted')).toBe('doubtful');
    expect(combineGrade('caution', 'contradicted')).toBe('doubtful');
    expect(combineGrade('doubtful', 'unconfirmed')).toBe('doubtful');
    expect(combineGrade('caution', 'unconfirmed')).toBe('caution');
    for (const c of ['confirmed', 'info', 'none', null] as const) expect(combineGrade('robust', c)).toBe('robust');
    expect(combineGrade('none', 'contradicted')).toBe('none');
    expect(combineGrade('unchecked', 'unconfirmed')).toBe('unchecked');
  });
});

describe('sentences', () => {
  const r = tiny();
  const base = { variable: 'PRECTOTCORR', ref: r, lat: 0, lng: 0, fullPeriod: true, kind: 'significant' as const, slope: 0.3, unitsLong: 'mm/day' };
  const src = 'GPCP (rain gauges and satellites)';
  it('confirmed', () => {
    expect(referenceCheck(base).sentence).toBe(
      `Confirmed by an independent record: ${src} shows +0.10 mm/day per decade for the roughly 280 km box around this place (p = 0.01).`,
    );
  });
  it('unconfirmed', () => {
    const c = referenceCheck({ ...base, ref: tiny({ refP: Array(12).fill(0.4) }) });
    expect(c.cls).toBe('unconfirmed');
    expect(c.sentence).toBe(
      `Not confirmed by an independent record: ${src} shows no significant change for the roughly 280 km box around this place (+0.10 mm/day per decade, p = 0.4).`,
    );
  });
  it('contradicted', () => {
    const c = referenceCheck({ ...base, ref: tiny({ refSlope: Array(12).fill(-0.1) }) });
    expect(c.sentence).toBe(
      `Contradicted by an independent record: ${src} shows the opposite, -0.10 mm/day per decade (p = 0.01), for the roughly 280 km box around this place.`,
    );
  });
  it('info', () => {
    expect(referenceCheck({ ...base, kind: 'none' }).sentence).toBe(
      `Independent record: ${src} shows +0.10 mm/day per decade for the roughly 280 km box around this place (p = 0.01).`,
    );
  });
  it('none: not eligible, with the reason', () => {
    const e = Array(12).fill(0);
    expect(referenceCheck({ ...base, ref: tiny({ eligible: e }) }).sentence).toBe(
      'No independent record can check this here (the record has too few years here).',
    );
    expect(referenceCheck({ ...base, ref: tiny({ eligible: e }), lat: -70 }).sentence).toContain('unreliable near the poles');
    expect(referenceCheck({ ...base, variable: 'T2M', ref: tiny({ eligible: e }) }).sentence).toContain('measures the water, not the air');
  });
  it('none: variable without a reference; custom period', () => {
    expect(referenceCheck({ ...base, variable: 'GWETROOT', ref: null })).toMatchObject({ cls: 'none', sentence: NOT_COMPARED_TEXT });
    const c = referenceCheck({ ...base, fullPeriod: false });
    expect(c).toMatchObject({ cls: null, sentence: CUSTOM_PERIOD_TEXT });
    expect(combineGrade('robust', c.cls)).toBe('robust');
  });
  it('bad years, and the trend without them', () => {
    const years = Array.from({ length: 45 }, (_, k) => 1981 + k);
    const values = years.map((y) => 0.03 * (y - 1981) + (y === 2020 ? 5 : 0));
    const c = referenceCheck({ ...base, ref: tiny({ badYears: { '6': [2020] } }), series: { years, values } });
    expect(c.badSentence).toBe(`${src} disagrees with MERRA-2 here for 2020.`);
    expect(c.slopeWithout).toBeCloseTo(0.3, 6);
    expect(c.withoutSentence).toBe('Without 2020: +0.30 mm/day per decade (p < 0.001).');
    // no series: the bad-year sentence only
    expect(referenceCheck({ ...base, ref: tiny({ badYears: { '6': [2020] } }) }).withoutSentence).toBeNull();
  });
  it('lists up to three years, then "and N more"', () => {
    expect(yearsText([2020])).toBe('2020');
    expect(yearsText([2020, 2021])).toBe('2020 and 2021');
    expect(yearsText([2007, 2017, 2023])).toBe('2007, 2017 and 2023');
    expect(yearsText([2002, 2003, 2004, 2005, 2006])).toBe('2002, 2003, 2004 and 2 more');
  });
  it('Detective short texts', () => {
    expect(shortCheckText('unconfirmed', 'GPCP')).toEqual({ reason: 'Not confirmed by GPCP.', tail: null });
    expect(shortCheckText('contradicted', 'NASA GISTEMP')).toEqual({ reason: 'Contradicted by NASA GISTEMP.', tail: null });
    expect(shortCheckText('confirmed', 'GPCP')).toEqual({ reason: null, tail: ' · Confirmed by GPCP' });
    expect(shortCheckText('none', 'GPCP')).toEqual({ reason: null, tail: null });
  });
  it('Menu line', () => {
    expect(summaryLine('PRECTOTCORR', tiny())).toBe('Independent check (GPCP): 26% of the significant area confirmed, 68% not confirmed, 6% contradicted.');
    expect(summaryLine('T2M', tiny())).toMatch(/ \(land only\)$/);
    expect(summaryLine('T2M', null)).toBeNull();
  });
});

describe('the shipped reference files', () => {
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../public/data/reference');
  for (const v of ['T2M', 'PRECTOTCORR']) {
    it(`${v}: eligible rule and lookup agree with the file`, () => {
      const r: RefData = JSON.parse(readFileSync(resolve(dir, `${v}.json`), 'utf8'));
      expect(r.eligible.length).toBe(r.nlat * r.nlon);
      expect(r.source.boxKm).toBe(v === 'T2M' ? 220 : 280);
      for (let k = 0; k < r.eligible.length; k++) {
        if (!r.eligible[k]) continue;
        const lat = r.lat0 + r.dlat * Math.floor(k / r.nlon);
        if (v === 'T2M') expect(r.land[k]).toBe(1);
        else expect(Math.abs(lat)).toBeLessThan(60);
        expect(r.refP[k]).not.toBeNull();
      }
      // Istanbul sits in an eligible box for temperature
      if (v === 'T2M') expect(boxAt(r, 41.01, 28.97)).not.toBeNull();
      // mid-Pacific: not eligible
      if (v === 'T2M') expect(boxAt(r, 0, -150)).toBeNull();
      if (v === 'PRECTOTCORR') expect(boxAt(r, -75, 60)).toBeNull();
    });
  }
});

describe('confirmed, but the size differs', () => {
  it('adds MERRA-2\'s box value when the two 95% ranges do not overlap, and nothing otherwise', () => {
    const ref = tiny({});
    const differs: RefBox = { index: 0, lat: 0, lng: 0, refSlope: 0.23, refP: 0.001, merraSlope: 0.52, sizeDiffers: true, badYears: [] };
    const text = classSentence('confirmed', ref, differs, '°C');
    expect(text).toMatch(/^Confirmed by an independent record: /);
    expect(text).toMatch(/The size differs, though: averaged over the same box MERRA-2 shows \+0\.52 °C per decade\.$/);
    expect(classSentence('confirmed', ref, { ...differs, sizeDiffers: false }, '°C')).not.toMatch(/size differs/);
    expect(classSentence('unconfirmed', ref, differs, '°C')).not.toMatch(/size differs/);
  });
  it('boxAt carries the flag from the `agree` array (2 = ranges do not overlap)', () => {
    const ref = tiny({});
    ref.agree = ref.agree.map(() => 2);
    const b = boxAt(ref, ref.lat0, ref.lon0);
    expect(b?.sizeDiffers).toBe(true);
    expect(b?.merraSlope).toBe(0.2);
  });
});
