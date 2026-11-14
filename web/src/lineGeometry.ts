/** Pure helpers for drawing many map polylines as one merged line-segment buffer. */

/** [lng, lat] or [lng, lat, altitude]. */
export type LinePoint = number[];

export interface ParsedColor {
  r: number;
  g: number;
  b: number;
  /** 0..1 */
  opacity: number;
}

/** Parses '#rrggbb', '#rgb', 'rgb(r,g,b)' and 'rgba(r,g,b,a)' into 0..1 channels. */
export function parseColor(s: string): ParsedColor {
  const t = s.trim();
  const m = t.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (m) {
    return { r: +m[1] / 255, g: +m[2] / 255, b: +m[3] / 255, opacity: m[4] === undefined ? 1 : +m[4] };
  }
  let hex = t.replace(/^#/, '');
  if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c);
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    const n = parseInt(hex, 16);
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, opacity: 1 };
  }
  throw new Error(`Unsupported colour: ${s}`);
}

/**
 * Turns polylines into one flat array of segment endpoints (x1,y1,z1,x2,y2,z2, ...), subdividing any step longer
 * than `maxStepDeg` degrees so long edges follow the sphere instead of cutting through it (the same 2-degree
 * resolution the globe's own path layer uses).
 */
export function segmentPositions(
  lines: LinePoint[][],
  toXYZ: (lat: number, lng: number, alt: number) => { x: number; y: number; z: number },
  defaultAlt: number,
  maxStepDeg = 2,
): Float32Array {
  const out: number[] = [];
  for (const line of lines) {
    let prev: { x: number; y: number; z: number } | null = null;
    for (let i = 0; i < line.length; i++) {
      const [lng, lat, alt = defaultAlt] = line[i];
      if (i > 0) {
        const [plng, plat, palt = defaultAlt] = line[i - 1];
        const steps = Math.max(1, Math.ceil(Math.max(Math.abs(lng - plng), Math.abs(lat - plat)) / maxStepDeg));
        for (let s = 1; s <= steps; s++) {
          const f = s / steps;
          const p = toXYZ(plat + (lat - plat) * f, plng + (lng - plng) * f, palt + (alt - palt) * f);
          out.push(prev!.x, prev!.y, prev!.z, p.x, p.y, p.z);
          prev = p;
        }
      } else {
        prev = toXYZ(lat, lng, alt);
      }
    }
  }
  return new Float32Array(out);
}
