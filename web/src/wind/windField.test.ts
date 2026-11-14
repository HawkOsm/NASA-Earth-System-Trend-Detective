import { describe, expect, it } from 'vitest';
import { WindField, type WindMeta } from './windField';

const meta: WindMeta = { nlat: 19, nlon: 36, lat0: -90, dlat: 10, lon0: -180, dlon: 10, scale: 0.01, max_speed: 10 };

function make(fn: (lat: number, lng: number) => [number, number]): WindField {
  const n = meta.nlat * meta.nlon;
  const a = new Int16Array(2 * n);
  for (let i = 0; i < meta.nlat; i++)
    for (let j = 0; j < meta.nlon; j++) {
      const [u, v] = fn(meta.lat0 + i * meta.dlat, meta.lon0 + j * meta.dlon);
      a[i * meta.nlon + j] = Math.round(u * 100);
      a[n + i * meta.nlon + j] = Math.round(v * 100);
    }
  return new WindField(meta, a);
}

describe('WindField', () => {
  const f = make((lat, lng) => [lat / 10 + lng / 100, lng / 50]);

  it('returns stored values at grid nodes', () => {
    const [u, v] = f.sample(20, 30);
    expect(u).toBeCloseTo(2.3, 5);
    expect(v).toBeCloseTo(0.6, 5);
    const [u2, v2] = f.sample(-90, -180);
    expect(u2).toBeCloseTo(-10.8, 5);
    expect(v2).toBeCloseTo(-3.6, 5);
  });

  it('interpolates bilinearly at a cell midpoint', () => {
    const g = make((lat, lng) => [lat === 0 && lng === 0 ? 4 : 0, lat === 10 && lng === 10 ? 8 : 0]);
    const [u, v] = g.sample(5, 5);
    expect(u).toBeCloseTo(1, 5);
    expect(v).toBeCloseTo(2, 5);
  });

  it('wraps across +-180 longitude', () => {
    const g = make((_lat, lng) => [lng === 170 ? 6 : lng === -180 ? 2 : 0, 0]);
    // node 170 and node -180 (= 180) are neighbours; midpoint at 175 is 4... between 170 (6) and 180/-180 (2)
    expect(g.sample(0, 175)[0]).toBeCloseTo(4, 5);
    expect(g.sample(0, -185)[0]).toBeCloseTo(4, 5);
    expect(g.sample(0, 175 + 360)[0]).toBeCloseTo(4, 5);
    // last column (170) wraps to first column (-180)
    expect(g.sample(0, 179.999)[0]).toBeCloseTo(2, 2);
  });

  it('moves a particle east in uniform eastward wind, same latitude', () => {
    const g = make(() => [5, 0]);
    const [lat, lng] = g.advect(30, 10, 0.1);
    expect(lat).toBeCloseTo(30, 9);
    expect(lng).toBeGreaterThan(10);
    expect(lng).toBeCloseTo(10 + (5 * 0.1) / Math.cos((30 * Math.PI) / 180), 5);
  });

  it('wraps longitude when crossing the antimeridian', () => {
    const g = make(() => [5, 0]);
    const [, lng] = g.advect(0, 179.9, 0.1);
    expect(lng).toBeCloseTo(-179.6, 5);
  });

  it('moves a particle north in northward wind', () => {
    const g = make(() => [0, 5]);
    const [lat, lng] = g.advect(10, 50, 0.1);
    expect(lat).toBeCloseTo(10.5, 5);
    expect(lng).toBeCloseTo(50, 9);
  });

  it('clamps latitude to +-88', () => {
    const n = make(() => [0, 10]);
    expect(n.advect(87.9, 0, 1)[0]).toBe(88);
    const s = make(() => [0, -10]);
    expect(s.advect(-87.9, 0, 1)[0]).toBe(-88);
  });

  it('rejects a buffer of the wrong size', () => {
    expect(() => new WindField(meta, new Int16Array(10))).toThrow();
  });
});
