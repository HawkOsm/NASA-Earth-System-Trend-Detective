import { describe, expect, it } from 'vitest';
import { parseColor, segmentPositions } from './lineGeometry';

const flat = (lat: number, lng: number, alt: number) => ({ x: lng, y: lat, z: alt });

describe('parseColor', () => {
  it('reads rgba, rgb and hex', () => {
    expect(parseColor('rgba(20,20,30,0.75)')).toEqual({ r: 20 / 255, g: 20 / 255, b: 30 / 255, opacity: 0.75 });
    expect(parseColor('rgb(255, 0, 0)')).toEqual({ r: 1, g: 0, b: 0, opacity: 1 });
    expect(parseColor('#ffffff')).toEqual({ r: 1, g: 1, b: 1, opacity: 1 });
    expect(parseColor('#0f0')).toEqual({ r: 0, g: 1, b: 0, opacity: 1 });
  });
  it('rejects what it cannot read', () => {
    expect(() => parseColor('white')).toThrow();
  });
});

describe('segmentPositions', () => {
  it('emits one segment per short step, joined end to start', () => {
    const p = segmentPositions([[[0, 0], [1, 0], [1, 1]]], flat, 0.002);
    expect(Array.from(p)).toEqual([0, 0, 0.002, 1, 0, 0.002, 1, 0, 0.002, 1, 1, 0.002].map(Math.fround));
  });
  it('subdivides steps longer than maxStepDeg and keeps lines separate', () => {
    const p = segmentPositions([[[0, 0], [10, 0]], [[50, 50], [51, 50]]], flat, 0, 2);
    expect(p.length / 6).toBe(5 + 1);
    expect(p[6 * 4 + 3]).toBe(10); // last segment of the first line ends at lng 10
    expect(p[6 * 5]).toBe(50); // second line starts fresh, no bridge from the first
  });
  it('uses a point altitude when given', () => {
    const p = segmentPositions([[[0, 0, 0.004], [1, 0, 0.004]]], flat, 0.002);
    expect(p[2]).toBeCloseTo(0.004);
    expect(p[5]).toBeCloseTo(0.004);
  });
  it('ignores single-point lines', () => {
    expect(segmentPositions([[[3, 3]]], flat, 0).length).toBe(0);
  });
});
