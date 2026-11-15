import { useEffect, useMemo, useState } from 'react';
import { countryCells, countryMeanSeries, loadCountrySeries, loadMask, spotTrend, type CountryRec } from './country';
import { loadSeaCells, loadSeaSeries } from './sea';
import type { VariableMeta } from '../data/data';
import { VARIABLES } from '../data/demos';
import { surfaceMessage } from '../data/noData';
import type { Period } from '../menu/period';

/** The area's yearly mean of one variable, for the "all variables" row of the country view. */
export interface VariableTile {
  variable: string;
  label: string;
  units: string;
  /** 'nodata': the variable has no values for this area (wrong surface, never present, or the file failed). */
  status: 'loading' | 'ready' | 'nodata';
  years: number[];
  annual: number[];
  slopeDecade: number | null;
  p: number | null;
}

/** Above this many cells the other nine variables are not fetched (about 90 bytes per cell and variable). */
export const MAX_TILE_CELLS = 3000;

type Loaded = { years: number[]; annual: number[] } | 'nodata';

/**
 * Every variable's mean series for the selected country or sea (static files, cached by the loaders), and its trend
 * over the selected period. null: no area, or the area is too large to fetch ten variables for.
 */
export function useCountryVariables(rec: CountryRec | null, metas: Record<string, VariableMeta>, period: Period): VariableTile[] | null {
  const [loaded, setLoaded] = useState<{ rec: CountryRec; series: Record<string, Loaded> } | null>(null);
  const enabled = !!rec && rec.nCells <= MAX_TILE_CELLS;
  const ready = VARIABLES.every((v) => metas[v]);

  useEffect(() => {
    if (!rec || !enabled || !ready) return;
    let alive = true;
    setLoaded({ rec, series: {} });
    const put = (v: string, s: Loaded) => {
      if (alive) setLoaded((cur) => (cur && cur.rec === rec ? { rec, series: { ...cur.series, [v]: s } } : cur));
    };
    const isSea = !!rec.sea;
    const cells = isSea ? loadSeaCells(rec.idx) : loadMask().then((mask) => countryCells(mask, rec));
    for (const v of VARIABLES) {
      const m = metas[v];
      if (surfaceMessage(m.label, m.surface, isSea)) {
        put(v, 'nodata');
        continue;
      }
      const nYears = m.years[1] - m.years[0] + 1;
      const off = m.int16_offset ?? 0;
      const values = isSea ? loadSeaSeries(v, rec.idx, nYears, off) : loadCountrySeries(v, rec.idx, nYears, off);
      Promise.all([cells, values]).then(
        ([cs, vals]) => {
          const mean = countryMeanSeries(cs, vals);
          put(v, mean.nUsed === 0 ? 'nodata' : { years: Array.from({ length: nYears }, (_, k) => m.years[0] + k), annual: mean.annual });
        },
        () => put(v, 'nodata'),
      );
    }
    return () => {
      alive = false;
    };
    // metas only matters once every variable's meta is there (`ready`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec, enabled, ready]);

  return useMemo(() => {
    if (!rec || !enabled || !ready) return null;
    const series = loaded && loaded.rec === rec ? loaded.series : {};
    return VARIABLES.map((v): VariableTile => {
      const m = metas[v];
      const s = series[v];
      const base = { variable: v, label: m.label, units: m.units };
      if (!s) return { ...base, status: 'loading', years: [], annual: [], slopeDecade: null, p: null };
      if (s === 'nodata') return { ...base, status: 'nodata', years: [], annual: [], slopeDecade: null, p: null };
      const t = spotTrend(s.years, s.annual, period);
      return { ...base, status: 'ready', years: s.years, annual: s.annual, slopeDecade: t.slopeDecade, p: t.p };
    });
  }, [rec, enabled, ready, loaded, metas, period]);
}
