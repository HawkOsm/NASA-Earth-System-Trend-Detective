import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  INSTRUMENT_VARIABLES,
  instrumentBoxIndex,
  instrumentCheck,
  instrumentClass,
  instrumentSentence,
  instrumentSummaryLine,
  type InstrumentData,
} from './instrument';

const grid = { lat0: -89, dlat: 2, nlat: 90, lon0: -179, dlon: 2, nlon: 180 };

function tiny(over: Partial<InstrumentData> = {}): InstrumentData {
  const n = grid.nlat * grid.nlon;
  return {
    variable: 'PRECTOTCORR',
    instrument: { short: 'GPM', name: 'GPM IMERG', what: 'rainfall measured from space' },
    years: [2001, 2025],
    nYears: 25,
    ...grid,
    merraSlope: new Array(n).fill(null),
    merraP: new Array(n).fill(null),
    instSlope: new Array(n).fill(null),
    instP: new Array(n).fill(null),
    summary: { nBoxes: 0, merraSignificant: null, agree: 0.22, notConfirmed: 0.73, contradicted: 0.05, sameSign: 0.66 },
    ...over,
  };
}

describe('satellite check: classes', () => {
  it('follows the table of the pipeline', () => {
    expect(instrumentClass(0.6, 0.001, 0.6, 0.006)).toBe('agree');
    expect(instrumentClass(-0.9, 0.007, -1.2, 0.0001)).toBe('agree');
    expect(instrumentClass(0.7, 0.016, 0.4, 0.2)).toBe('not_confirmed');
    expect(instrumentClass(0.7, 0.016, -0.4, 0.2)).toBe('not_confirmed');
    expect(instrumentClass(0.7, 0.016, -0.4, 0.02)).toBe('contradicted');
    expect(instrumentClass(0.1, 0.3, 0.4, 0.02)).toBe('instrument');
    expect(instrumentClass(0.1, 0.3, -0.1, 0.4)).toBe('neither');
    expect(instrumentClass(0.1, 0.05, 0.1, 0.05)).toBe('neither'); // p must be below 0.05
  });
});

describe('satellite check: boxes', () => {
  it('lower edges are inclusive, longitude wraps, the top row clamps', () => {
    expect(instrumentBoxIndex(grid, -90, -180)).toBe(0);
    expect(instrumentBoxIndex(grid, -88, -180)).toBe(grid.nlon); // -88 is the lower edge of the second row
    expect(instrumentBoxIndex(grid, 31.22, 121.43)).toBe(60 * grid.nlon + 150); // box centred 31 N, 121 E
    expect(instrumentBoxIndex(grid, 90, 0)).toBe(89 * grid.nlon + 90);
    expect(instrumentBoxIndex(grid, 0, 180)).toBe(instrumentBoxIndex(grid, 0, -180));
  });
  it('no check where a box has no value from both', () => {
    expect(instrumentCheck(tiny(), 31.22, 121.43, 'mm/day')).toBeNull();
    expect(instrumentCheck(null, 31.22, 121.43, 'mm/day')).toBeNull();
  });
  it('reads the box of the place', () => {
    const d = tiny();
    const k = instrumentBoxIndex(grid, 31.22, 121.43);
    d.merraSlope[k] = 0.6095;
    d.merraP[k] = 0.001169;
    d.instSlope[k] = 0.6043;
    d.instP[k] = 0.006285;
    const c = instrumentCheck(d, 31.22, 121.43, 'mm/day');
    expect(c?.cls).toBe('agree');
    expect(c?.sentence).toBe(
      'GPM (rainfall measured from space), 2001–2025: GPM shows +0.60 mm/day per decade and MERRA-2 +0.61 mm/day per decade over the same years, both significant. They agree (the roughly 220 km box around this place).',
    );
  });
});

describe('satellite check: sentences', () => {
  const d = tiny();
  it('says which side is not significant', () => {
    expect(instrumentSentence('not_confirmed', d, 0.73, 0.42, 'mm/day')).toContain('MERRA-2 shows +0.73 mm/day per decade over these years, significant, but GPM shows +0.42 mm/day per decade, not significant. Not confirmed for these years');
    expect(instrumentSentence('instrument', d, 0.1, 0.4, 'mm/day')).toContain('GPM shows +0.40 mm/day per decade, significant, while MERRA-2 shows +0.10 mm/day per decade over the same years, not significant');
    expect(instrumentSentence('contradicted', d, 0.7, -0.4, 'mm/day')).toContain('GPM shows the opposite of MERRA-2 over these years: -0.40 mm/day per decade against +0.70 mm/day per decade, both significant');
    expect(instrumentSentence('neither', d, 0.03, -0.03, 'mm/day')).toContain('neither GPM (-0.03 mm/day per decade) nor MERRA-2 (+0.03 mm/day per decade) shows a significant change over these years');
  });
  it('a record in other units is printed in its own units and compared by direction only', () => {
    const g = tiny({ instrument: { short: 'GLDAS', name: 'GLDAS', what: "NASA's land model, driven by observations", label: 'Model check', units: 'kg/m²' } });
    const k = instrumentBoxIndex(grid, -8.76, -63.9);
    g.merraSlope[k] = -5.627;
    g.merraP[k] = 0.001;
    g.instSlope[k] = -49.47;
    g.instP[k] = 0.00001;
    const c = instrumentCheck(g, -8.76, -63.9, 'percentage points');
    expect(c?.label).toBe('Model check');
    expect(c?.sentence).toContain('GLDAS shows -49.47 kg/m² per decade and MERRA-2 -5.63 percentage points per decade over the same years, both significant. They point the same way');
    expect(instrumentCheck(tiny(), 0, 0, 'mm/day')).toBeNull();
  });
  it('the menu line gives the shares over MERRA-2\'s significant trends', () => {
    expect(instrumentSummaryLine(d)).toBe("GPM, 2001–2025: of MERRA-2's significant trends in those years, 22% confirmed · 73% not confirmed · 5% contradicted");
    expect(instrumentSummaryLine(null)).toBeNull();
  });
});

describe('the shipped satellite files', () => {
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/data/instruments');
  for (const v of INSTRUMENT_VARIABLES) {
    const file = resolve(dir, `${v}.json`);
    it.skipIf(!existsSync(file))(`${v}: arrays match the grid and the summary matches the boxes`, () => {
      const d = JSON.parse(readFileSync(file, 'utf8')) as InstrumentData;
      const n = d.nlat * d.nlon;
      expect([d.merraSlope.length, d.merraP.length, d.instSlope.length, d.instP.length]).toEqual([n, n, n, n]);
      let num = { agree: 0, not_confirmed: 0, contradicted: 0 } as Record<string, number>;
      let den = 0;
      let boxes = 0;
      for (let k = 0; k < n; k++) {
        const ms = d.merraSlope[k], mp = d.merraP[k], is = d.instSlope[k], ip = d.instP[k];
        if (ms === null || mp === null || is === null || ip === null) continue;
        boxes++;
        if (mp >= 0.05) continue;
        const w = Math.cos(((d.lat0 + Math.floor(k / d.nlon) * d.dlat) * Math.PI) / 180);
        den += w;
        num[instrumentClass(ms, mp, is, ip)] += w;
      }
      expect(boxes).toBe(d.summary.nBoxes);
      expect(num.agree / den).toBeCloseTo(d.summary.agree as number, 3);
      expect(num.not_confirmed / den).toBeCloseTo(d.summary.notConfirmed as number, 3);
      expect(num.contradicted / den).toBeCloseTo(d.summary.contradicted as number, 3);
    });
  }
});
