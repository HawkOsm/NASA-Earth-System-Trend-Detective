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
  classFromCounts,
  tally,
  joinNames,
  combineGrade,
  referenceCheck,
  shortCheckText,
  summaryLine,
  yearsText,
  type BoxRecord,
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

const gpcp = (slope: number, p: number): BoxRecord => ({ short: 'GPCP', what: 'rain gauges and satellites', slope, p, available: true });
const box = (refSlope: number, refP: number): RefBox => ({ index: 0, lat: 0, lng: 0, refSlope, refP, records: [gpcp(refSlope, refP)], merraSlope: null, sizeDiffers: false, badYears: [] });

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
      `MERRA-2 shows no clear trend here, but an independent record does: ${src} shows +0.10 mm/day per decade for the roughly 280 km box around this place (p = 0.01).`,
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
    expect(summaryLine('PRECTOTCORR', tiny())).toBe('Checked against GPCP: 26% confirmed · 68% not confirmed · 6% contradicted');
    expect(summaryLine('T2M', tiny())).toMatch(/^Checked against GPCP \(land\): /);
    expect(summaryLine('T2M', null)).toBeNull();
  });
});

describe('the shipped reference files', () => {
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/data/reference');
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
    const differs: RefBox = { index: 0, lat: 0, lng: 0, refSlope: 0.23, refP: 0.001, records: [gpcp(0.23, 0.001)], merraSlope: 0.52, sizeDiffers: true, badYears: [] };
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

describe('the record shows a change that MERRA-2 does not', () => {
  it('says so when the site has no clear trend and the record is significant', () => {
    const ref = tiny({});
    const b: RefBox = { index: 0, lat: 0, lng: 0, refSlope: 0.24, refP: 0.0001, records: [gpcp(0.24, 0.0001)], merraSlope: -0.004, sizeDiffers: true, badYears: [] };
    expect(classSentence('info', ref, b, '°C')).toMatch(/^MERRA-2 shows no clear trend here, but an independent record does: /);
    expect(classSentence('info', ref, { ...b, refP: 0.4 }, '°C')).toMatch(/^Independent record: /);
  });
});


// ---- several records: "confirmed by k of n" -------------------------------------------------------------------------------

describe('class rule (n records, k confirm, c contradict)', () => {
  it('follows the definitions, ties and n = 0..4 included', () => {
    const table: [number, number, number, string][] = [
      [0, 0, 0, 'none'],
      [1, 1, 0, 'confirmed'], [1, 0, 0, 'unconfirmed'], [1, 0, 1, 'contradicted'],
      [2, 2, 0, 'confirmed'], [2, 1, 0, 'partly'], [2, 0, 0, 'unconfirmed'], [2, 1, 1, 'partly'], [2, 0, 1, 'contradicted'], [2, 0, 2, 'contradicted'],
      [3, 3, 0, 'confirmed'], [3, 2, 0, 'confirmed'], [3, 2, 1, 'confirmed'], [3, 1, 0, 'partly'], [3, 1, 1, 'partly'], [3, 1, 2, 'contradicted'], [3, 0, 0, 'unconfirmed'],
      [4, 4, 0, 'confirmed'], [4, 3, 1, 'confirmed'], [4, 3, 0, 'confirmed'], [4, 2, 0, 'partly'], [4, 2, 1, 'partly'], [4, 2, 2, 'partly'], [4, 1, 0, 'partly'], [4, 1, 1, 'partly'],
      [4, 1, 3, 'contradicted'], [4, 0, 0, 'unconfirmed'], [4, 0, 1, 'contradicted'],
    ];
    for (const [n, k, c, want] of table) expect(classFromCounts(n, k, c), `${n},${k},${c}`).toBe(want);
  });
  it('counts records by the site\'s sign, availability and p < 0.05', () => {
    const recs: BoxRecord[] = [
      { short: 'A', what: '', slope: 0.3, p: 0.01, available: true },
      { short: 'B', what: '', slope: -0.2, p: 0.04, available: true },
      { short: 'C', what: '', slope: 0.3, p: 0.05, available: true },
      { short: 'D', what: '', slope: null, p: null, available: false },
    ];
    expect(tally(recs, 1)).toEqual({ n: 3, k: 1, c: 1 });
    expect(tally(recs, -1)).toEqual({ n: 3, k: 1, c: 1 });
    expect(tally(recs, 0)).toEqual({ n: 3, k: 0, c: 0 });
  });
  it('grade caps: partly and unconfirmed -> caution, contradicted -> doubtful, the rest none', () => {
    expect(combineGrade('robust', 'partly')).toBe('caution');
    expect(combineGrade('doubtful', 'partly')).toBe('doubtful');
    expect(combineGrade('robust', 'confirmed')).toBe('robust');
  });
  it('names: A, A and B, A, B and C', () => {
    expect([joinNames([]), joinNames(['A']), joinNames(['A', 'B']), joinNames(['A', 'B', 'C'])]).toEqual(['', 'A', 'A and B', 'A, B and C']);
  });
});

/** A 3 x 4 grid like tiny() with four rainfall records; `rows` = [slope, p] of GPCP, CMAP, GPCC, PREC/L (null = not available). */
function multi(rows: ([number, number] | null)[], over: Partial<RefData> = {}): RefData {
  const names = [['GPCP', 'rain gauges and satellites'], ['CMAP', 'rain gauges and satellites'], ['GPCC', 'rain gauges'], ['PREC/L', 'rain gauges']];
  const records = rows.map((r, i) => ({
    short: names[i][0], name: names[i][0], what: names[i][1],
    refSlope: Array(12).fill(r ? r[0] : null), refP: Array(12).fill(r ? r[1] : null), available: Array(12).fill(r ? 1 : 0),
  }));
  const first = rows[0] ?? [0, 1];
  return tiny({ refSlope: Array(12).fill(first[0]), refP: Array(12).fill(first[1]), records, ...over });
}
const check = (ref: RefData, kind: 'significant' | 'possible' | 'none' = 'significant', slope = 0.3) =>
  referenceCheck({ variable: 'PRECTOTCORR', ref, lat: 0, lng: 0, fullPeriod: true, kind, slope, unitsLong: 'mm/day' });
const TAIL = 'for the roughly 280 km box around this place';

describe('sentences with several records', () => {
  it('confirmed by all', () => {
    const c = check(multi([[0.26, 0.001], [0.21, 0.01], [0.23, 0.002], [0.15, 0.02]]));
    expect(c).toMatchObject({ cls: 'confirmed', n: 4, k: 4, c: 0 });
    expect(c.sentence).toBe(`Confirmed by 4 of 4 independent records (GPCP, CMAP, GPCC and PREC/L): they show +0.15 to +0.26 mm/day per decade ${TAIL}.`);
  });
  it('confirmed by 3 of 4 (the Cebu case): the record that does not confirm is named', () => {
    const c = check(multi([[0.09, 0.51], [0.56, 0.0004], [0.44, 0.006], [0.48, 0.0009]]));
    expect(c).toMatchObject({ cls: 'confirmed', n: 4, k: 3, c: 0 });
    expect(c.sentence).toBe(`Confirmed by 3 of 4 independent records (CMAP, GPCC and PREC/L): they show +0.44 to +0.56 mm/day per decade ${TAIL}. GPCP shows no significant change.`);
  });
  it('confirmed by 3 of 4 (more than half), one not confirming', () => {
    expect(check(multi([[0.06, 0.7], [0.49, 0.001], [0.44, 0.006], [0.57, 0.0003]])).sentence).toBe(
      `Confirmed by 3 of 4 independent records (CMAP, GPCC and PREC/L): they show +0.44 to +0.57 mm/day per decade ${TAIL}. GPCP shows no significant change.`,
    );
  });
  it('half is not enough: 2 of 4 and 1 of 2 are "partly"', () => {
    const a = check(multi([[0.06, 0.7], [0.49, 0.001], [0.22, 0.09], [0.57, 0.0003]]));
    expect(a).toMatchObject({ cls: 'partly', n: 4, k: 2 });
    expect(a.sentence).toBe(
      `Confirmed by 2 of 4 independent records only: CMAP and PREC/L show +0.49 to +0.57 mm/day per decade; GPCP and GPCC show no significant change ${TAIL}.`,
    );
    const b = check(multi([[0.06, 0.7], [0.49, 0.001], null, null]));
    expect(b).toMatchObject({ cls: 'partly', n: 2, k: 1 });
    expect(b.sentence).toBe(`Confirmed by 1 of 2 independent records only: CMAP shows +0.49 mm/day per decade; GPCP shows no significant change ${TAIL}.`);
  });
  it('partly confirmed', () => {
    const c = check(multi([[0.05, 0.7], [0.49, 0.001], [0.02, 0.3], [0.04, 0.4]]));
    expect(c).toMatchObject({ cls: 'partly', n: 4, k: 1 });
    expect(c.sentence).toBe(`Confirmed by 1 of 4 independent records only: CMAP shows +0.49 mm/day per decade; GPCP, GPCC and PREC/L show no significant change ${TAIL}.`);
    const d = check(multi([[0.3, 0.001], [-0.2, 0.01], [0.04, 0.4], [0.03, 0.4]]));   // k = 1, c = 1 of 4: partly, with an opposite record
    expect(d.cls).toBe('partly');
    expect(d.sentence).toBe(`Confirmed by 1 of 4 independent records only: GPCP shows +0.30 mm/day per decade; GPCC and PREC/L show no significant change; CMAP shows the opposite, -0.20 mm/day per decade ${TAIL}.`);
  });
  it('not confirmed by any', () => {
    const c = check(multi([[0.0, 1], [-0.02, 0.5], [0.01, 0.6], [0.0, 0.9]]));
    expect(c).toMatchObject({ cls: 'unconfirmed', n: 4, k: 0, c: 0 });
    expect(c.sentence).toBe(`Not confirmed by any of 4 independent records (GPCP, CMAP, GPCC and PREC/L): none shows a significant change ${TAIL}.`);
  });
  it('contradicted, with and without records that confirm', () => {
    const c = check(multi([[-0.1, 0.01], [-0.2, 0.02], [0.03, 0.4], [0.04, 0.4]]));
    expect(c).toMatchObject({ cls: 'contradicted', n: 4, k: 0, c: 2 });
    expect(c.sentence).toBe(`Contradicted: 2 of 4 independent records (GPCP and CMAP) show the opposite, -0.10 to -0.20 mm/day per decade ${TAIL}.`);
    expect(check(multi([[-0.1, 0.01], [-0.2, 0.02], [0.3, 0.01], [0.04, 0.4]])).cls).toBe('contradicted');   // c = 2 > k = 1
  });
  it('contradicted: "K confirm it"', () => {
    const c = check(multi([[-0.1, 0.01], [-0.2, 0.02], [-0.15, 0.03], [0.3, 0.01]]));
    expect(c.cls).toBe('contradicted');
    expect(c.sentence).toBe(`Contradicted: 3 of 4 independent records (GPCP, CMAP and GPCC) show the opposite, -0.10 to -0.20 mm/day per decade ${TAIL}. 1 confirms it.`);
  });
  it('info: records that see a change although MERRA-2 does not, or none', () => {
    const a = check(multi([[0.09, 0.51], [0.56, 0.0004], [0.44, 0.006], [0.1, 0.4]]), 'none');
    expect(a).toMatchObject({ cls: 'info', n: 4 });
    expect(a.sentence).toBe(`MERRA-2 shows no clear trend here, but 2 of 4 independent records do (CMAP and GPCC): +0.44 to +0.56 mm/day per decade ${TAIL}.`);
    expect(check(multi([[0.0, 1], [0.01, 0.9], [0.02, 0.5], [0.0, 0.8]]), 'none').sentence).toBe(
      `Independent records (GPCP, CMAP, GPCC and PREC/L): none shows a significant change ${TAIL}.`,
    );
  });
  it('the size note against the first record stays', () => {
    const ref = multi([[0.2, 0.001], [0.21, 0.01], [0.23, 0.002], [0.15, 0.02]]);
    ref.agree = ref.agree.map(() => 2);
    expect(check(ref).sentence).toMatch(/The size differs, though: averaged over the same box MERRA-2 shows \+0\.20 mm\/day per decade\.$/);
  });
  it('one available record keeps the one-record sentences (a box with GPCP only)', () => {
    const c = check(multi([[0.1, 0.01], null, null, null]));
    expect(c).toMatchObject({ cls: 'confirmed', n: 1, k: 1 });
    expect(c.sentence).toBe('Confirmed by an independent record: GPCP (rain gauges and satellites) shows +0.10 mm/day per decade for the roughly 280 km box around this place (p = 0.01).');
  });
  it('the result lists every record, the unavailable ones too', () => {
    const c = check(multi([[0.1, 0.01], [0.2, 0.01], null, null]));
    expect(c.records).toEqual([
      { short: 'GPCP', slope: 0.1, p: 0.01, available: true }, { short: 'CMAP', slope: 0.2, p: 0.01, available: true },
      { short: 'GPCC', slope: null, p: null, available: false }, { short: 'PREC/L', slope: null, p: null, available: false },
    ]);
    expect(c.n).toBe(2);
  });
  it('Detective short forms', () => {
    const n4 = { n: 4, k: 3, c: 0 };
    expect(shortCheckText('confirmed', 'GPCP', n4)).toEqual({ reason: null, tail: ' · Confirmed by 3 of 4 records' });
    expect(shortCheckText('partly', 'GPCP', { n: 4, k: 1, c: 0 })).toEqual({ reason: 'Confirmed by only 1 of 4 records.', tail: null });
    expect(shortCheckText('unconfirmed', 'GPCP', { n: 4, k: 0, c: 0 })).toEqual({ reason: 'Not confirmed by any of 4 records.', tail: null });
    expect(shortCheckText('contradicted', 'GPCP', { n: 4, k: 0, c: 2 })).toEqual({ reason: 'Contradicted by 2 of 4 records.', tail: null });
    expect(shortCheckText('info', 'GPCP', n4)).toEqual({ reason: null, tail: null });
    expect(shortCheckText('unconfirmed', 'GPCP', { n: 1, k: 0, c: 0 })).toEqual({ reason: 'Not confirmed by GPCP.', tail: null });
  });
  it('Menu line', () => {
    const cons = { confirmed: 0.53, partly: 0.1, unconfirmed: 0.28, contradicted: 0.09, records: ['GPCP', 'CMAP', 'GPCC', 'PREC/L'], nBoxes: 10, byCount: {}, byCountArea: {} };
    expect(summaryLine('PRECTOTCORR', multi([[0.1, 0.01], [0.1, 0.01], [0.1, 0.01], [0.1, 0.01]], { consensus: cons }))).toBe(
      'Checked against 4 records (GPCP, CMAP, GPCC and PREC/L): 53% confirmed · 10% partly · 28% not confirmed · 9% contradicted',
    );
    const t = multi([[0.1, 0.01], [0.1, 0.01]], { consensus: { ...cons, records: ['NASA GISTEMP', 'GHCN-CAMS'] } });
    t.records = t.records!.map((r, i) => ({ ...r, short: ['NASA GISTEMP', 'GHCN-CAMS'][i] }));
    expect(summaryLine('T2M', t)).toBe('Checked against 2 records (NASA GISTEMP and GHCN-CAMS) (land): 53% confirmed · 10% partly · 28% not confirmed · 9% contradicted');
  });
});

describe('the shipped files carry the records', () => {
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/data/reference');
  const load = (v: string): RefData => JSON.parse(readFileSync(resolve(dir, `${v}.json`), 'utf8'));
  it('rainfall: Cebu box is confirmed by 3 of 4; the first record is today\'s', () => {
    const r = load('PRECTOTCORR');
    expect(r.records!.map((x) => x.short)).toEqual(['GPCP', 'CMAP', 'GPCC', 'PREC/L']);
    expect(r.records![0].refSlope).toEqual(r.refSlope.map((x, i) => (r.eligible[i] ? x : null)));
    const c = referenceCheck({ variable: 'PRECTOTCORR', ref: r, lat: 10.32, lng: 123.89, fullPeriod: true, kind: 'significant', slope: 0.89, unitsLong: 'mm/day' });
    expect(c).toMatchObject({ cls: 'confirmed', n: 4, k: 3, c: 0 });
    expect(c.sentence).toMatch(/^Confirmed by 3 of 4 independent records \(CMAP, GPCC and PREC\/L\): they show \+0\.44 to \+0\.56 mm\/day per decade /);
  });
  it('rainfall: an ocean box has GPCP and CMAP only; temperature: two records over land', () => {
    const c = referenceCheck({ variable: 'PRECTOTCORR', ref: load('PRECTOTCORR'), lat: 0, lng: -150, fullPeriod: true, kind: 'significant', slope: 0.1, unitsLong: 'mm/day' });
    expect(c.n).toBe(2);
    expect(c.records.map((x) => x.available)).toEqual([true, true, false, false]);
    const t = referenceCheck({ variable: 'T2M', ref: load('T2M'), lat: 41.01, lng: 28.97, fullPeriod: true, kind: 'significant', slope: 0.5, unitsLong: '°C' });
    expect(t).toMatchObject({ cls: 'confirmed', n: 2, k: 2 });
  });
  it('consensus shares add up to 1 and match the Menu line', () => {
    for (const v of ['T2M', 'PRECTOTCORR']) {
      const r = load(v);
      const c = r.consensus!;
      expect(c.confirmed + c.partly + c.unconfirmed + c.contradicted).toBeCloseTo(1, 2);
      expect(summaryLine(v, r)).toMatch(new RegExp(`^Checked against ${r.records!.length} records \\(`));
    }
  });
});
