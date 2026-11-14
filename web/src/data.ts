import type { RenderConfig } from './rangeMap';

export interface GridMeta {
  nlat: number;
  nlon: number;
  lat0: number;
  dlat: number;
  lon0: number;
  dlon: number;
}

/** Shape of public/data/<VAR>_meta.json produced by the pipeline. */
export interface VariableMeta {
  variable: string;
  label: string;
  units: string;
  units_per_decade: string;
  definition: string;
  years: [number, number];
  vmax: number;
  colormap_stops: string[];
  render: RenderConfig;
  /** Overlay colour and opacity at s = t * vmax (significant), t from -1 to 1 in 21 steps, for the legend. */
  legend_stops: { t: number; rgb: string; alpha: number }[];
  grid: GridMeta;
  frac_significant: number;
  global_mean_slope_decade: number;
}

const BASE = import.meta.env.BASE_URL;

export function dataUrl(file: string): string {
  return `${BASE}data/${file}`;
}

export function trendTextureUrl(variable: string): string {
  return dataUrl(`${variable}_trend.png`);
}

export function landmarksTextureUrl(variable: string): string {
  return dataUrl(`${variable}_landmarks.png`);
}

export async function loadMeta(variable: string): Promise<VariableMeta> {
  const res = await fetch(dataUrl(`${variable}_meta.json`));
  if (!res.ok) {
    throw new Error(`Failed to load meta for ${variable}: HTTP ${res.status}`);
  }
  return (await res.json()) as VariableMeta;
}
