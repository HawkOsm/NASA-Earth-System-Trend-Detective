import { useEffect, useRef, useState } from 'react';
import { dataUrl, trendTextureUrl, type VariableMeta } from './data';
import { FULL_PERIOD, isFullPeriod, type Period } from './period';
import {
  TEX_H,
  TEX_W,
  computeChunk,
  extractChunk,
  finishResult,
  type RenderConfig,
  parseAnnualBin,
  valueAtResult,
  type AnnualMeta,
  type CellStats,
  type RangeResult,
} from './rangeMap';
import type { WorkerMessage, WorkerRequest } from './rangeWorker';

export type RangeStatus = 'precomputed' | 'loading' | 'computing' | 'ready' | 'error';

declare global {
  interface Window {
    __rangeMap?: {
      status: RangeStatus;
      start: number;
      end: number;
      variable: string;
      vmax: number;
      fracSignificant: number;
      ms: number;
      valueAt: (lat: number, lng: number) => ReturnType<typeof valueAtResult> | undefined;
    };
  }
}

interface AnnualData {
  meta: AnnualMeta;
  data: Int16Array;
}

const annualCache = new Map<string, Promise<AnnualData>>();
function loadAnnual(variable: string): Promise<AnnualData> {
  let p = annualCache.get(variable);
  if (!p) {
    p = (async () => {
      const [mres, bres] = await Promise.all([
        fetch(dataUrl(`${variable}_annual.json`)),
        fetch(dataUrl(`${variable}_annual.bin`)),
      ]);
      if (!mres.ok || !bres.ok) throw new Error(`Failed to load the annual grid for ${variable}`);
      const meta = (await mres.json()) as AnnualMeta;
      return { meta, data: parseAnnualBin(await bres.arrayBuffer(), meta) };
    })();
    p.catch(() => annualCache.delete(variable));
    annualCache.set(variable, p);
  }
  return p;
}

interface CachedResult {
  result: RangeResult;
  url: string;
  ms: number;
}
const resultCache = new Map<string, CachedResult>();
const MAX_CACHED = 30;
function cachePut(key: string, entry: CachedResult) {
  resultCache.set(key, entry);
  if (resultCache.size > MAX_CACHED) {
    const oldest = resultCache.keys().next().value as string;
    const old = resultCache.get(oldest);
    resultCache.delete(oldest);
    if (old) URL.revokeObjectURL(old.url);
  }
}
const keyOf = (v: string, p: Period) => `${v}:${p[0]}:${p[1]}`;

const baseCache = new Map<string, Promise<Uint8ClampedArray>>();
/** basemap.png (same-origin) scaled to the texture size, as RGBA pixels; loaded once. */
function loadBasemap(render: RenderConfig): Promise<Uint8ClampedArray> {
  let p = baseCache.get(render.basemap);
  if (!p) {
    p = new Promise<Uint8ClampedArray>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = TEX_W;
        canvas.height = TEX_H;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('2D canvas unavailable'));
        ctx.drawImage(img, 0, 0, TEX_W, TEX_H);
        resolve(ctx.getImageData(0, 0, TEX_W, TEX_H).data);
      };
      img.onerror = () => reject(new Error('Failed to load the base map'));
      img.src = dataUrl(render.basemap);
    });
    p.catch(() => baseCache.delete(render.basemap));
    baseCache.set(render.basemap, p);
  }
  return p;
}

function canvasUrl(rgba: Uint8ClampedArray): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('2D canvas unavailable'));
  ctx.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, TEX_W, TEX_H), 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error('toBlob failed'))), 'image/png'),
  );
}

/** Compute slope/p for the period on up to 4 workers (falls back to the main thread if workers are unavailable). */
function computeParallel(
  d: AnnualData,
  period: Period,
  onProgress: (frac: number) => void,
  workers: Worker[],
): Promise<CellStats> {
  const { meta, data } = d;
  const ncells = meta.nlat * meta.nlon;
  const yi0 = period[0] - meta.years[0];
  const yi1 = period[1] - meta.years[0];
  const years: number[] = [];
  for (let yr = period[0]; yr <= period[1]; yr++) years.push(yr);
  const nw = Math.max(1, Math.min(4, (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2));
  // Split by contiguous row blocks of cells.
  const bounds: number[] = [];
  for (let w = 0; w <= nw; w++) bounds.push(Math.round((w * ncells) / nw));
  const slope = new Float64Array(ncells);
  const p = new Float64Array(ncells);
  const done = new Array<number>(nw).fill(0);
  const report = () => onProgress(done.reduce((a, b) => a + b, 0) / ncells);

  if (typeof Worker === 'undefined') {
    return new Promise((resolve) => {
      // Fallback: single thread, yielding between slices is not needed for correctness.
      const chunk = extractChunk(data, ncells, yi0, yi1, 0, ncells);
      resolve(computeChunk(chunk, years, ncells, meta.scale, (n) => onProgress(n / ncells)));
    });
  }

  return new Promise<CellStats>((resolve, reject) => {
    let remaining = nw;
    for (let w = 0; w < nw; w++) {
      const c0 = bounds[w];
      const c1 = bounds[w + 1];
      const worker = new Worker(new URL('./rangeWorker.ts', import.meta.url), { type: 'module' });
      workers.push(worker);
      worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
        const m = e.data;
        if (m.type === 'progress') {
          done[w] = m.done;
          report();
        } else {
          slope.set(m.slope, c0);
          p.set(m.p, c0);
          done[w] = c1 - c0;
          report();
          worker.terminate();
          if (--remaining === 0) resolve({ slope, p });
        }
      };
      worker.onerror = (e) => reject(new Error(e.message || 'worker failed'));
      const chunk = extractChunk(data, ncells, yi0, yi1, c0, c1);
      const req: WorkerRequest = { id: w, chunk, years, nc: c1 - c0, scale: meta.scale };
      worker.postMessage(req, [chunk.buffer]);
    }
  });
}

export interface RangeMapView {
  status: RangeStatus;
  /** Texture currently shown (PNG for the full period, otherwise the recomputed canvas image). */
  textureUrl: string;
  /** Period, vmax and significance share of the texture that is currently shown. */
  shown: { start: number; end: number; vmax: number; fracSignificant: number; recomputed: boolean };
  progress: number;
}

/**
 * Drives the map for the committed period. Full period: the precomputed PNG. Otherwise recompute in workers
 * (cached per variable and period); the previously shown recomputed map of the same variable stays visible
 * until the new one is ready. A stale job is cancelled (workers terminated) when the period or variable changes.
 */
export function useRangeMap(variable: string, period: Period, meta: VariableMeta | null): RangeMapView {
  const [status, setStatus] = useState<RangeStatus>('precomputed');
  const [progress, setProgress] = useState(0);
  const [shownRes, setShownRes] = useState<CachedResult | null>(null);
  const msRef = useRef(0);
  const full = isFullPeriod(period, meta?.years ?? FULL_PERIOD);
  const [p0, p1] = period;

  useEffect(() => {
    if (!meta) return;
    if (full) {
      setStatus('precomputed');
      return;
    }
    const per: Period = [p0, p1];
    const key = keyOf(variable, per);
    const cached = resultCache.get(key);
    if (cached) {
      msRef.current = cached.ms;
      setShownRes(cached);
      setStatus('ready');
      return;
    }
    let cancelled = false;
    const workers: Worker[] = [];
    const t0 = performance.now();
    setStatus('loading');
    setProgress(0);
    (async () => {
      const [annual, base] = await Promise.all([loadAnnual(variable), loadBasemap(meta.render)]);
      if (cancelled) return;
      setStatus('computing');
      const stats = await computeParallel(annual, per, (f) => !cancelled && setProgress(Math.min(f, 1)), workers);
      if (cancelled) return;
      const result = finishResult(variable, per[0], per[1], annual.meta, stats, meta.colormap_stops, base, meta.render);
      const url = await canvasUrl(result.rgba);
      if (cancelled) {
        URL.revokeObjectURL(url);
        return;
      }
      const entry: CachedResult = { result, url, ms: Math.round(performance.now() - t0) };
      result.rgba = new Uint8ClampedArray(0); // the texture lives on as the blob URL; free the pixels
      cachePut(key, entry);
      msRef.current = entry.ms;
      setShownRes(entry);
      setStatus('ready');
    })().catch((err) => {
      if (cancelled) return;
      console.error('Map recomputation failed', err);
      setStatus('error');
    });
    return () => {
      cancelled = true;
      workers.forEach((w) => w.terminate());
    };
  }, [variable, p0, p1, full, meta]);

  // What is shown: precomputed for the full period; otherwise the last recomputed map if it belongs to this
  // variable, else the variable's precomputed (full-period) map while waiting.
  const usePre = !meta || full || !shownRes || shownRes.result.variable !== variable;
  const view: RangeMapView = usePre
    ? {
        status: full ? 'precomputed' : status,
        textureUrl: trendTextureUrl(variable),
        shown: {
          start: meta?.years[0] ?? FULL_PERIOD[0],
          end: meta?.years[1] ?? FULL_PERIOD[1],
          vmax: meta?.vmax ?? 1,
          fracSignificant: meta?.frac_significant ?? 0,
          recomputed: false,
        },
        progress,
      }
    : {
        status,
        textureUrl: shownRes!.url,
        shown: {
          start: shownRes!.result.start,
          end: shownRes!.result.end,
          vmax: shownRes!.result.vmax,
          fracSignificant: shownRes!.result.fracSignificant,
          recomputed: true,
        },
        progress,
      };

  // Test hook.
  const target = full ? 'precomputed' : status;
  useEffect(() => {
    const res = target === 'ready' && shownRes && shownRes.result.variable === variable ? shownRes.result : null;
    window.__rangeMap = {
      status: target,
      start: p0,
      end: p1,
      variable,
      vmax: res ? res.vmax : meta?.vmax ?? NaN,
      fracSignificant: res ? res.fracSignificant : meta?.frac_significant ?? NaN,
      ms: res ? msRef.current : 0,
      valueAt: (lat, lng) => (res && res.start === p0 && res.end === p1 ? valueAtResult(res, lat, lng) : undefined),
    };
  }, [target, shownRes, variable, p0, p1, meta]);
  useEffect(
    () => () => {
      delete window.__rangeMap;
    },
    [],
  );

  return view;
}
