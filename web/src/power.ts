import type { GridMeta } from './data';
import type { RegionBox, RegionData } from './region';

export interface Cell {
  lat: number;
  lng: number;
  i: number;
  j: number;
}

export interface PointSeries {
  years: number[];
  annual: number[];
  monthlyT: number[];
  monthly: number[];
  units: string;
}

/** Nearest grid cell centre. Lat index clamps; lon index wraps modulo nlon. */
export function snapToCell(lat: number, lng: number, grid: GridMeta): Cell {
  let i = Math.round((lat - grid.lat0) / grid.dlat);
  i = Math.min(Math.max(i, 0), grid.nlat - 1);
  let j = Math.round((lng - grid.lon0) / grid.dlon);
  j = ((j % grid.nlon) + grid.nlon) % grid.nlon;
  return { lat: grid.lat0 + i * grid.dlat, lng: grid.lon0 + j * grid.dlon, i, j };
}

interface PowerJson {
  header?: { fill_value?: number };
  parameters?: Record<string, { units?: string }>;
  properties?: { parameter?: Record<string, Record<string, number>> };
}

/** Parse a POWER monthly/point response. Month "13" is POWER's own annual value. */
export function parsePowerResponse(json: unknown, variable: string): PointSeries {
  const j = json as PowerJson | null;
  const values = j?.properties?.parameter?.[variable];
  if (!values || typeof values !== 'object') {
    throw new Error(`NASA POWER response has no data for ${variable}.`);
  }
  const fill = j?.header?.fill_value ?? -999;
  const units = j?.parameters?.[variable]?.units ?? '';
  const years = new Set<number>();
  for (const key of Object.keys(values)) {
    if (/^\d{6}$/.test(key)) years.add(Number(key.slice(0, 4)));
  }
  const yearList = [...years].sort((a, b) => a - b);
  if (yearList.length === 0) throw new Error('NASA POWER response contained no yearly data.');
  const clean = (v: unknown): number => (typeof v === 'number' && v !== fill && Number.isFinite(v) ? v : NaN);
  const annual: number[] = [];
  const monthly: number[] = [];
  const monthlyT: number[] = [];
  for (const y of yearList) {
    annual.push(clean(values[`${y}13`]));
    for (let m = 1; m <= 12; m++) {
      monthly.push(clean(values[`${y}${String(m).padStart(2, '0')}`]));
      monthlyT.push(y + (m - 0.5) / 12);
    }
  }
  return { years: yearList, annual, monthlyT, monthly, units };
}

const cache = new Map<string, PointSeries>();

export async function fetchPointSeries(
  variable: string,
  cellLat: number,
  cellLng: number,
  signal?: AbortSignal,
  yearRange: [number, number] = [1981, 2025],
): Promise<PointSeries> {
  // Cell centres are unique per cell, so lat/lng identify the cell (same as its grid indices).
  const key = `${variable}|${cellLat}|${cellLng}|${yearRange[0]}-${yearRange[1]}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const url =
    'https://power.larc.nasa.gov/api/temporal/monthly/point' +
    `?parameters=${encodeURIComponent(variable)}&community=AG` +
    `&longitude=${cellLng}&latitude=${cellLat}` +
    `&start=${yearRange[0]}&end=${yearRange[1]}&format=JSON`;
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new Error('Could not reach NASA POWER. Check your connection and try again.');
  }
  if (!res.ok) throw new Error(`NASA POWER returned an error (HTTP ${res.status}).`);
  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new Error('NASA POWER returned a response that could not be read.');
  }
  const series = parsePowerResponse(json, variable);
  cache.set(key, series);
  return series;
}

interface RegionalJson {
  header?: { fill_value?: number };
  parameters?: Record<string, { units?: string }>;
  features?: {
    geometry?: { coordinates?: number[] };
    properties?: { parameter?: Record<string, Record<string, number>> };
  }[];
}

/** Parse a POWER monthly/regional response (GeoJSON, one feature per grid cell). */
export function parseRegionalResponse(json: unknown, variable: string): RegionData {
  const j = json as RegionalJson | null;
  if (!j || !Array.isArray(j.features) || j.features.length === 0) {
    throw new Error(`NASA POWER response has no grid cells for ${variable}.`);
  }
  let first: PointSeries | null = null;
  const cells = j.features.map((f) => {
    const [lng, lat] = f.geometry?.coordinates ?? [];
    if (typeof lng !== 'number' || typeof lat !== 'number') {
      throw new Error('NASA POWER response contained a grid cell without coordinates.');
    }
    const s = parsePowerResponse({ header: j.header, parameters: j.parameters, properties: f.properties }, variable);
    if (!first) first = s;
    else if (s.years.length !== first.years.length || s.years[0] !== first.years[0]) {
      throw new Error('NASA POWER response had grid cells covering different years.');
    }
    return { lat, lng, annual: s.annual, monthly: s.monthly };
  });
  const ref = first as unknown as PointSeries;
  return { years: ref.years, monthlyT: ref.monthlyT, units: ref.units, cells };
}

const regionCache = new Map<string, RegionData>();

export async function fetchRegionSeries(
  variable: string,
  box: RegionBox,
  signal?: AbortSignal,
  yearRange: [number, number] = [1981, 2025],
): Promise<RegionData> {
  const key = `${variable}|${box.latMin},${box.latMax},${box.lngMin},${box.lngMax}|${yearRange[0]}-${yearRange[1]}`;
  const hit = regionCache.get(key);
  if (hit) return hit;
  const url =
    'https://power.larc.nasa.gov/api/temporal/monthly/regional' +
    `?parameters=${encodeURIComponent(variable)}&community=AG` +
    `&latitude-min=${box.latMin}&latitude-max=${box.latMax}` +
    `&longitude-min=${box.lngMin}&longitude-max=${box.lngMax}` +
    `&start=${yearRange[0]}&end=${yearRange[1]}&format=JSON`;
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new Error('Could not reach NASA POWER. Check your connection and try again.');
  }
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { messages?: unknown };
      if (Array.isArray(body.messages)) {
        detail = body.messages.map((m) => (typeof m === 'string' ? m : JSON.stringify(m))).join(' ');
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
    }
    throw new Error(`NASA POWER returned an error (HTTP ${res.status}).${detail ? ` ${detail}` : ''}`);
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new Error('NASA POWER returned a response that could not be read.');
  }
  const data = parseRegionalResponse(json, variable);
  regionCache.set(key, data);
  return data;
}

/** Each value minus the mean of its calendar month over all years. NaN-safe. */
export function monthlyAnomalies(monthly: number[]): number[] {
  const sum = new Array<number>(12).fill(0);
  const cnt = new Array<number>(12).fill(0);
  monthly.forEach((v, k) => {
    if (!Number.isNaN(v)) {
      sum[k % 12] += v;
      cnt[k % 12]++;
    }
  });
  return monthly.map((v, k) => (Number.isNaN(v) ? NaN : v - sum[k % 12] / cnt[k % 12]));
}
