import { mesh } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import land from 'world-atlas/land-110m.json';

export type LngLat = [number, number];

const EDGE = 179.999;

/**
 * Split polylines so that no segment crosses the antimeridian (|dlng| > 180) and drop segments that
 * merely run along the +-180 seam or the south pole (artefacts of how land polygons are cut).
 * Pure; returns polylines of at least 2 points.
 */
export function splitLines(lines: LngLat[][]): LngLat[][] {
  const out: LngLat[][] = [];
  for (const line of lines) {
    let cur: LngLat[] = [];
    const flush = () => {
      if (cur.length >= 2) out.push(cur);
      cur = [];
    };
    for (let k = 0; k < line.length; k++) {
      const p = line[k];
      if (k > 0) {
        const q = line[k - 1];
        const wraps = Math.abs(p[0] - q[0]) > 180;
        const seam = Math.abs(p[0]) >= EDGE && Math.abs(q[0]) >= EDGE && Math.sign(p[0]) === Math.sign(q[0]);
        const pole = p[1] <= -89.999 && q[1] <= -89.999;
        if (wraps || seam || pole) {
          flush();
        }
      }
      cur.push(p);
    }
    flush();
  }
  return out;
}

export function buildCoastlines(): LngLat[][] {
  const topo = land as unknown as Topology;
  const geom = topo.objects.land as GeometryCollection;
  const m = mesh(topo, geom);
  return splitLines(m.coordinates as LngLat[][]);
}
