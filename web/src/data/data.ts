import type { RenderConfig } from '../map/rangeMap';

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
  /** Short per-decade units for tight places; informational. */
  units_short?: string;
  /** Picker group (Temperature / Water / Ice & snow / Air). */
  group?: string;
  /** 100 for a fraction shown as percent; 1 otherwise. The API values are multiplied by it and rounded. */
  display_scale?: number;
  /** Int16 files store round((value - int16_offset) * 100). */
  int16_offset?: number;
  /** Snow / sea ice: a cell that is 0 in every year has no data. */
  zero_means_absent?: boolean;
  /** Where the variable has values: land-only and sea-only variables have no sea / country pieces (no files). */
  surface?: 'land' | 'sea' | 'any';
  definition: string;
  /** One sentence on how well this variable is measured (config.py "caveat"). */
  caveat?: string;
  years: [number, number];
  vmax: number;
  colormap_stops: string[];
  render: RenderConfig;
  /** Overlay colour and opacity at s = t * vmax (significant), t from -1 to 1 in 21 steps, for the legend. */
  legend_stops: { t: number; rgb: string; alpha: number }[];
  grid: GridMeta;
  frac_significant: number;
  global_mean_slope_decade: number;
  /** Area-weighted shares (0..1) of the map-significant area by grade, full period (pipeline/export_quality.py). */
  quality?: { robust: number; caution: number; doubtful: number; stepYearMode: number | null };
}

const BASE = import.meta.env.BASE_URL;

const VERSIONS: Record<string, string> = typeof __DATA_VERSIONS__ === 'undefined' ? {} : __DATA_VERSIONS__;

/** URL of a data file. The ?v=<content hash> changes only when the file does, so it can be cached forever. */
export function dataUrl(file: string): string {
  const v = VERSIONS[file];
  return `${BASE}data/${file}${v ? `?v=${v}` : ''}`;
}

export function trendTextureUrl(variable: string): string {
  return dataUrl(`${variable}_trend.png`);
}

export function confirmedTextureUrl(variable: string): string {
  return dataUrl(`${variable}_confirmed.png`);
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
