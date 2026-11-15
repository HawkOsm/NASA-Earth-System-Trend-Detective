/**
 * quality.bin + quality.json (pipeline/evaluation/export_quality.py): the quality flags of every coarse cell and variable of
 * summary.bin, for the Detective's point answers. Rows follow summary.bin's bitmaps, so the lookup reuses its `rowOf`.
 * Per variable: flags Uint8 (bit0 STEP, bit1 ONE_YEAR, bit2 REVERSAL, bit3 END_SENSITIVE, bits 4-5 grade), stepYear
 * Uint16 (0 = none), outlierYear Uint16 (0 = none).
 */
import { dataUrl } from '../data/data';
import type { Grade, VarQuality } from './quality';
import { loadSummary, nearestCell, type Summary } from '../detective/whatsChanging';

export interface QualityVariable {
  variable: string;
  count: number;
  flagsOffset: number;
  stepYearOffset: number;
  outlierYearOffset: number;
}

export interface QualityMeta {
  nlat: number;
  nlon: number;
  bytes?: number;
  variables: QualityVariable[];
}

export interface QualityData {
  meta: QualityMeta;
  blocks: Map<string, { flags: Uint8Array; stepYear: Uint16Array; outlierYear: Uint16Array }>;
}

const GRADES: Grade[] = ['none', 'robust', 'caution', 'doubtful'];

export function parseQuality(meta: QualityMeta, buf: ArrayBuffer): QualityData {
  if (meta.bytes !== undefined && meta.bytes !== buf.byteLength) {
    throw new Error(`quality.bin has ${buf.byteLength} bytes, expected ${meta.bytes}`);
  }
  const blocks: QualityData['blocks'] = new Map();
  for (const v of meta.variables) {
    blocks.set(v.variable, {
      flags: new Uint8Array(buf, v.flagsOffset, v.count),
      stepYear: new Uint16Array(buf, v.stepYearOffset, v.count),
      outlierYear: new Uint16Array(buf, v.outlierYearOffset, v.count),
    });
  }
  return { meta, blocks };
}

/** Decode one stored cell (flags byte + years). */
export function decodeCell(flags: number, stepYear: number, outlierYear: number): VarQuality {
  return {
    grade: GRADES[(flags >> 4) & 3],
    flags: { step: !!(flags & 1), oneYear: !!(flags & 2), reversal: !!(flags & 4), endSensitive: !!(flags & 8) },
    stepYear: stepYear || null,
    outlierYear: outlierYear || null,
  };
}

/** The quality of every variable with data at the coarse cell nearest to (lat, lng) (same cell as rankAt). */
export function qualityAt(q: QualityData, s: Summary, lat: number, lng: number): Map<string, VarQuality> {
  const [i, j] = nearestCell(s, lat, lng);
  const k = i * s.nlon + j;
  const out = new Map<string, VarQuality>();
  for (const b of s.blocks) {
    const r = b.rowOf[k];
    const qb = q.blocks.get(b.meta.variable);
    if (r < 0 || !qb) continue;
    out.set(b.meta.variable, decodeCell(qb.flags[r], qb.stepYear[r], qb.outlierYear[r]));
  }
  return out;
}

let cached: Promise<QualityData> | null = null;

/** Fetch quality.json and quality.bin once (checked against the summary's cell counts); a failure is not cached. */
export function loadQuality(): Promise<QualityData> {
  if (!cached) {
    const get = async (file: string) => {
      const res = await fetch(dataUrl(file));
      if (!res.ok) throw new Error(`Failed to load ${file}: HTTP ${res.status}`);
      return res;
    };
    cached = Promise.all([
      get('quality.json').then((r) => r.json() as Promise<QualityMeta>),
      get('quality.bin').then((r) => r.arrayBuffer()),
      loadSummary(),
    ])
      .then(([meta, buf, summary]) => {
        const q = parseQuality(meta, buf);
        for (const b of summary.blocks) {
          const v = meta.variables.find((x) => x.variable === b.meta.variable);
          if (!v || v.count !== b.meta.count) throw new Error(`quality.bin does not match summary.bin for ${b.meta.variable}`);
        }
        return q;
      })
      .catch((err) => {
        cached = null;
        throw err;
      });
  }
  return cached;
}
