import { describe, expect, it } from 'vitest';
import { fitTwoToOne, latLngToFraction, pixelToLatLng } from './flatMapMath';
import { formatTick, gradientCss, significantText } from './legend';
import { buildCoastlines, splitLines, type LngLat } from './coastlines';


describe('flat map', () => {
  it('maps corners and centre', () => {
    expect(pixelToLatLng(0, 0, 200, 100)).toEqual({ lat: 90, lng: -180 });
    expect(pixelToLatLng(200, 100, 200, 100)).toEqual({ lat: -90, lng: 180 });
    expect(pixelToLatLng(100, 50, 200, 100)).toEqual({ lat: 0, lng: 0 });
  });
  it('clamps outside clicks and round-trips', () => {
    expect(pixelToLatLng(-5, 500, 200, 100)).toEqual({ lat: -90, lng: -180 });
    const { fx, fy } = latLngToFraction(41, 28.75);
    const p = pixelToLatLng(fx * 360, fy * 180, 360, 180);
    expect(p.lat).toBeCloseTo(41, 9);
    expect(p.lng).toBeCloseTo(28.75, 9);
  });
  it('fits a 2:1 box', () => {
    expect(fitTwoToOne(1000, 300)).toEqual({ width: 600, height: 300 });
    expect(fitTwoToOne(400, 900)).toEqual({ width: 400, height: 200 });
  });
});

describe('legend', () => {
  it('formats ticks with explicit signs', () => {
    expect(formatTick(0.74)).toBe('+0.74');
    expect(formatTick(-0.74)).toBe('-0.74');
    expect(formatTick(0)).toBe('0');
    expect(formatTick(-0)).toBe('0');
    expect(formatTick(2.5)).toBe('+2.5');
    expect(formatTick(-12)).toBe('-12');
  });
  it('builds gradient and significance text', () => {
    expect(gradientCss(['#000', '#fff'])).toBe('linear-gradient(to right, #000, #fff)');
    expect(significantText(0.6897809)).toBe('69% of the globe shows a significant trend.');
  });
});

describe('coastlines', () => {
  it('splits at antimeridian jumps and drops seam/pole segments', () => {
    const line: LngLat[] = [[170, 60], [179, 61], [-179, 62], [-170, 63]];
    expect(splitLines([line])).toEqual([[[170, 60], [179, 61]], [[-179, 62], [-170, 63]]]);
    expect(splitLines([[[180, 10], [180, 20]]])).toEqual([]);
    expect(splitLines([[[-10, -90], [50, -90]]])).toEqual([]);
  });
  it('bundled land data yields many wrap-free lines', () => {
    const lines = buildCoastlines();
    expect(lines.length).toBeGreaterThan(50);
    for (const l of lines) {
      for (let k = 1; k < l.length; k++) expect(Math.abs(l[k][0] - l[k - 1][0])).toBeLessThanOrEqual(180);
    }
  });
});
