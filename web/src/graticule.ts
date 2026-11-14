import type { LngLat } from './coastlines';

export interface GraticuleLine {
  coords: LngLat[];
  /** The equator and the prime meridian are drawn slightly stronger. */
  strong: boolean;
}

export interface MapLabel {
  lat: number;
  lng: number;
  text: string;
}

export const GRATICULE_STEP = 30;
export const POINT_STEP = 2;

const range = (from: number, to: number, step: number): number[] => {
  const out: number[] = [];
  for (let v = from; v <= to + 1e-9; v += step) out.push(v);
  return out;
};

/**
 * Meridians (lng -180..150 every 30 deg, running pole to pole) and parallels (-60..60 every 30 deg,
 * running lng -180..180), as polylines with a point every 2 deg. Every line is monotonic in longitude,
 * so no segment crosses the antimeridian.
 */
export function buildGraticule(): GraticuleLine[] {
  const lines: GraticuleLine[] = [];
  for (const lng of range(-180, 150, GRATICULE_STEP)) {
    lines.push({ coords: range(-90, 90, POINT_STEP).map((lat): LngLat => [lng, lat]), strong: lng === 0 });
  }
  for (const lat of range(-60, 60, GRATICULE_STEP)) {
    lines.push({ coords: range(-180, 180, POINT_STEP).map((lng): LngLat => [lng, lat]), strong: lat === 0 });
  }
  return lines;
}

export function latText(lat: number): string {
  return lat === 0 ? '0°' : `${Math.abs(lat)}°${lat > 0 ? 'N' : 'S'}`;
}

export function lngText(lng: number): string {
  return lng === 0 || Math.abs(lng) === 180 ? `${Math.abs(lng)}°` : `${Math.abs(lng)}°${lng > 0 ? 'E' : 'W'}`;
}

/**
 * Degree labels: parallels at the prime meridian and the 180 deg meridian, meridians at the equator.
 * The equator/prime-meridian crossing is labelled "0°" once, the equator/180 crossing "180°" once.
 */
export function buildGraticuleLabels(): MapLabel[] {
  const labels: MapLabel[] = [];
  for (const lat of range(-60, 60, GRATICULE_STEP)) {
    labels.push({ lat, lng: 0, text: latText(lat) });
    if (lat !== 0) labels.push({ lat, lng: 180, text: latText(lat) });
  }
  for (const lng of range(-150, 150, GRATICULE_STEP)) {
    if (lng !== 0) labels.push({ lat: 0, lng, text: lngText(lng) });
  }
  labels.push({ lat: 0, lng: 180, text: lngText(180) });
  return labels;
}
