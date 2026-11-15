import { describe, expect, it } from 'vitest';
import { allChangesLine, scaleChangedLine } from './emptyMap';

describe('menu lines of a period map', () => {
  it('says that every change is drawn when almost nothing passes the map-wide test', () => {
    expect(allChangesLine({ start: 2016, end: 2025, fracSignificant: 0.004, recomputed: true }, 'of the globe')).toBe(
      'Every change is drawn: strong = significant at that place on its own, faded = not significant. 0% of the globe passes the map-wide test',
    );
  });

  it('says when the colour scale differs from the whole record', () => {
    const line = scaleChangedLine({ start: 2016, end: 2025, fracSignificant: 0, recomputed: true, vmax: 20 }, 4.5, [1981, 2025]);
    expect(line).toBe(
      'The colour scale has changed for this period: ±20 per decade, which is about ±18 in total over 2016–2025. For 1981–2025 it is ±4.5 per decade, about ±20 in total. A rate measured over fewer years swings more, so the per-decade scale is wider for a short period.',
    );
    // air temperature: 2.4 per decade over 9 years is less in total than 0.74 per decade over 44 years
    const t = scaleChangedLine({ start: 2016, end: 2025, fracSignificant: 0, recomputed: true, vmax: 2.4 }, 0.74, [1981, 2025]);
    expect(t).toContain('±2.4 per decade, which is about ±2.2 in total over 2016–2025');
    expect(t).toContain('±0.74 per decade, about ±3.3 in total');
  });

  it('says nothing for the whole record or an unchanged scale', () => {
    expect(scaleChangedLine({ start: 1981, end: 2025, fracSignificant: 0.2, recomputed: false, vmax: 4.5 }, 4.5, [1981, 2025])).toBeNull();
    expect(scaleChangedLine({ start: 1990, end: 2025, fracSignificant: 0.2, recomputed: true, vmax: 4.5 }, 4.5, [1981, 2025])).toBeNull();
    expect(scaleChangedLine({ start: 1990, end: 2025, fracSignificant: 0.2, recomputed: true }, 4.5, [1981, 2025])).toBeNull();
  });
});
