/*
 * Wind field sampling and advection for the animated wind-flow layer.
 * Idea credit: cambecc/earth (MIT, https://github.com/cambecc/earth), the source of earth.nullschool.net, for
 * advecting particles through a gridded U/V field with bilinear interpolation. The code here is written from
 * scratch; no code was copied. See also mapbox/webgl-wind (ISC), read for the idea only (not used).
 */

export interface WindMeta {
  nlat: number;
  nlon: number;
  lat0: number;
  dlat: number;
  lon0: number;
  dlon: number;
  scale: number;
  max_speed: number;
}

export const MAX_LAT = 88;

export class WindField {
  readonly meta: WindMeta;
  /** u (eastward) and v (northward) in m/s, row-major [lat ascending][lon]. */
  readonly u: Float32Array;
  readonly v: Float32Array;

  constructor(meta: WindMeta, buf: ArrayBuffer | Int16Array) {
    this.meta = meta;
    const n = meta.nlat * meta.nlon;
    const i16 = buf instanceof Int16Array ? buf : new Int16Array(buf);
    if (i16.length !== 2 * n) throw new Error(`wind grid size mismatch: ${i16.length} vs ${2 * n}`);
    this.u = new Float32Array(n);
    this.v = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.u[i] = i16[i] * meta.scale;
      this.v[i] = i16[n + i] * meta.scale;
    }
  }

  /** Bilinear [u, v] in m/s at (lat, lng) degrees; longitude wraps, latitude is clamped to the grid. */
  sample(lat: number, lng: number): [number, number] {
    const { nlat, nlon, lat0, dlat, lon0, dlon } = this.meta;
    let fy = (lat - lat0) / dlat;
    fy = Math.min(Math.max(fy, 0), nlat - 1);
    let y0 = Math.floor(fy);
    if (y0 > nlat - 2) y0 = nlat - 2;
    const ty = fy - y0;
    let fx = (lng - lon0) / dlon;
    fx = ((fx % nlon) + nlon) % nlon;
    const x0 = Math.floor(fx) % nlon;
    const x1 = (x0 + 1) % nlon;
    const tx = fx - Math.floor(fx);
    const a = y0 * nlon + x0;
    const b = y0 * nlon + x1;
    const c = (y0 + 1) * nlon + x0;
    const d = (y0 + 1) * nlon + x1;
    const w00 = (1 - tx) * (1 - ty);
    const w10 = tx * (1 - ty);
    const w01 = (1 - tx) * ty;
    const w11 = tx * ty;
    return [
      this.u[a] * w00 + this.u[b] * w10 + this.u[c] * w01 + this.u[d] * w11,
      this.v[a] * w00 + this.v[b] * w10 + this.v[c] * w01 + this.v[d] * w11,
    ];
  }

  /**
   * Move a particle along the wind. k = dtScale is degrees of latitude per (m/s) per step:
   * dlat = v*k, dlng = u*k / cos(lat). Latitude clamped to +-88, longitude wrapped to [-180, 180).
   */
  advect(lat: number, lng: number, dtScale: number): [number, number] {
    const [u, v] = this.sample(lat, lng);
    const cos = Math.max(Math.cos((lat * Math.PI) / 180), 0.035);
    let nlat = lat + v * dtScale;
    let nlng = lng + (u * dtScale) / cos;
    nlat = Math.max(-MAX_LAT, Math.min(MAX_LAT, nlat));
    nlng = ((((nlng + 180) % 360) + 360) % 360) - 180;
    return [nlat, nlng];
  }
}

export async function loadWindField(baseDataUrl: (f: string) => string, signal?: AbortSignal): Promise<WindField> {
  const [metaRes, binRes] = await Promise.all([
    fetch(baseDataUrl('wind_mean.json'), { signal }),
    fetch(baseDataUrl('wind_mean.bin'), { signal }),
  ]);
  if (!metaRes.ok || !binRes.ok) throw new Error('Could not load wind data');
  const meta = (await metaRes.json()) as WindMeta;
  const buf = await binRes.arrayBuffer();
  return new WindField(meta, buf);
}
