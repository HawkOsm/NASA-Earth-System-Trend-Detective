import type { PointSeries } from './power';

export interface RegionBox {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
}

/** One grid cell of a regional response: centre, and its series on the shared time axis. */
export interface RegionCell {
  lat: number;
  lng: number;
  /** One value per year (POWER's own annual value, month "13"); NaN where missing. */
  annual: number[];
  /** 12 values per year, NaN where missing. */
  monthly: number[];
}

export interface RegionData {
  years: number[];
  monthlyT: number[];
  units: string;
  cells: RegionCell[];
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * Box of side `sizeDeg` (degrees, both directions) centred on the point. If it would cross a pole or the
 * +-180 meridian it is shifted (not shrunk) to stay inside lat [-90, 90] and lng [-180, 180].
 */
export function regionBox(lat: number, lng: number, sizeDeg: number): RegionBox {
  const half = sizeDeg / 2;
  const fit = (c: number, lo: number, hi: number): [number, number] => {
    let a = c - half;
    let b = c + half;
    if (a < lo) {
      b += lo - a;
      a = lo;
    }
    if (b > hi) {
      a -= b - hi;
      b = hi;
    }
    return [round3(a), round3(b)];
  };
  const [latMin, latMax] = fit(lat, -90, 90);
  const [lngMin, lngMax] = fit(lng, -180, 180);
  return { latMin, latMax, lngMin, lngMax };
}

/** Outline of a box as [lng, lat] points, a point about every 0.5 degrees so it follows the globe's curvature. */
export function boxOutline(box: RegionBox, step = 0.5): [number, number][] {
  const pts: [number, number][] = [];
  const along = (a: number, b: number): number[] => {
    const n = Math.max(1, Math.ceil(Math.abs(b - a) / step));
    return Array.from({ length: n + 1 }, (_, k) => a + ((b - a) * k) / n);
  };
  for (const lng of along(box.lngMin, box.lngMax)) pts.push([lng, box.latMin]);
  for (const lat of along(box.latMin, box.latMax).slice(1)) pts.push([box.lngMax, lat]);
  for (const lng of along(box.lngMax, box.lngMin).slice(1)) pts.push([lng, box.latMax]);
  for (const lat of along(box.latMax, box.latMin).slice(1)) pts.push([box.lngMin, lat]);
  return pts;
}

export interface AreaMean {
  series: PointSeries;
  /** Cells that contributed (cells with any missing annual value are dropped entirely). */
  cells: RegionCell[];
}

/**
 * Area average of a regional response, weighted by cos(latitude) of each cell centre. Annual and monthly values
 * are averaged separately. A cell with any missing annual value is dropped; a missing month in a kept cell is
 * skipped for that month (the weights are renormalised over the cells that have it).
 */
export function areaMeanSeries(data: RegionData): AreaMean {
  const cells = data.cells.filter((c) => c.annual.every((v) => Number.isFinite(v)));
  const w = cells.map((c) => Math.cos((c.lat * Math.PI) / 180));
  const mean = (get: (c: RegionCell) => number): number => {
    let s = 0;
    let ws = 0;
    cells.forEach((c, k) => {
      const v = get(c);
      if (Number.isFinite(v)) {
        s += w[k] * v;
        ws += w[k];
      }
    });
    return ws > 0 ? s / ws : NaN;
  };
  const nMonths = data.years.length * 12;
  return {
    cells,
    series: {
      years: data.years,
      monthlyT: data.monthlyT,
      units: data.units,
      annual: data.years.map((_, y) => mean((c) => c.annual[y])),
      monthly: Array.from({ length: nMonths }, (_, m) => mean((c) => c.monthly[m])),
    },
  };
}
