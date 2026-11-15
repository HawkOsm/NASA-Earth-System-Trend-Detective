import { describe, expect, it } from 'vitest';
import { buildBorders } from './coastlines';
import { buildGraticule, buildGraticuleLabels, latText, lngText } from './graticule';
import { PLACES } from './places';

describe('graticule', () => {
  const lines = buildGraticule();

  it('has 12 meridians and 5 parallels, 2 deg spacing, two strong lines', () => {
    expect(lines).toHaveLength(17);
    const meridians = lines.filter((l) => l.coords.every((p) => p[0] === l.coords[0][0]));
    const parallels = lines.filter((l) => l.coords.every((p) => p[1] === l.coords[0][1]));
    expect(meridians).toHaveLength(12);
    expect(parallels).toHaveLength(5);
    expect(meridians.map((l) => l.coords[0][0])).toEqual([-180, -150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150]);
    expect(parallels.map((l) => l.coords[0][1])).toEqual([-60, -30, 0, 30, 60]);
    for (const m of meridians) {
      expect(m.coords).toHaveLength(91);
      expect(m.coords[0][1]).toBe(-90);
      expect(m.coords[90][1]).toBe(90);
    }
    for (const p of parallels) {
      expect(p.coords).toHaveLength(181);
      expect(p.coords[0][0]).toBe(-180);
      expect(p.coords[180][0]).toBe(180);
    }
    expect(lines.filter((l) => l.strong)).toHaveLength(2);
  });

  it('stays in range and no segment crosses the antimeridian', () => {
    for (const l of lines) {
      for (let k = 0; k < l.coords.length; k++) {
        const [lng, lat] = l.coords[k];
        expect(lng).toBeGreaterThanOrEqual(-180);
        expect(lng).toBeLessThanOrEqual(180);
        expect(lat).toBeGreaterThanOrEqual(-90);
        expect(lat).toBeLessThanOrEqual(90);
        if (k > 0) expect(Math.abs(lng - l.coords[k - 1][0])).toBeLessThanOrEqual(2);
      }
    }
  });

  it('labels: parallels at 0 and 180, meridians at the equator, no duplicate positions', () => {
    const labels = buildGraticuleLabels();
    expect(labels).toHaveLength(20);
    const keys = labels.map((l) => `${l.lat},${l.lng}`);
    expect(new Set(keys).size).toBe(labels.length);
    expect(labels.filter((l) => l.text === '0°')).toHaveLength(1);
    expect(labels.filter((l) => l.text === '180°')).toHaveLength(1);
    expect(labels.find((l) => l.lat === 60 && l.lng === 0)?.text).toBe('60°N');
    expect(labels.find((l) => l.lat === -30 && l.lng === 180)?.text).toBe('30°S');
    expect(labels.find((l) => l.lat === 0 && l.lng === -60)?.text).toBe('60°W');
    expect(labels.find((l) => l.lat === 0 && l.lng === 30)?.text).toBe('30°E');
    expect(latText(0)).toBe('0°');
    expect(lngText(-180)).toBe('180°');
  });
});

describe('places and borders', () => {
  it('has 13 places with valid coordinates', () => {
    expect(PLACES).toHaveLength(13);
    for (const p of PLACES) {
      expect(Math.abs(p.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(p.lng)).toBeLessThanOrEqual(180);
    }
  });

  it('country borders exist and never cross the antimeridian', () => {
    const b = buildBorders();
    expect(b.length).toBeGreaterThan(100);
    for (const line of b) {
      expect(line.length).toBeGreaterThanOrEqual(2);
      for (let k = 1; k < line.length; k++) expect(Math.abs(line[k][0] - line[k - 1][0])).toBeLessThanOrEqual(180);
    }
  });
});
