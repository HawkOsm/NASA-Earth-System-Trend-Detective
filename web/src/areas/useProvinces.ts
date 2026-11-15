import { useEffect, useMemo, useState } from 'react';
import type { CountryData } from './CountryPanel';
import { loadProvinces, provinceTrends, type ProvinceRec, type ProvinceTrend } from './country';
import type { Period } from '../menu/period';

/** Province outlines of the selected country (lazy, static file). */
export function useProvinces(idx: number | null) {
  const [state, setState] = useState<{ idx: number; list: ProvinceRec[] } | null>(null);
  useEffect(() => {
    if (idx === null) {
      setState(null);
      return;
    }
    let alive = true;
    loadProvinces(idx).then((list) => alive && setState({ idx, list }));
    return () => {
      alive = false;
    };
  }, [idx]);
  const ready = state && idx !== null && state.idx === idx ? state.list : null;
  return { status: idx === null ? ('none' as const) : ready === null ? ('loading' as const) : ready.length ? ('ready' as const) : ('none' as const), list: ready ?? [] };
}

/** Trend of every province for the selected period (recomputed with the variable and the period). */
export function useProvinceTrends(list: ProvinceRec[], data: CountryData | null, period: Period): ProvinceTrend[] | null {
  return useMemo(
    () => (list.length && data ? provinceTrends(list, data.cells, data.values, data.years, period) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list, data, period[0], period[1]],
  );
}
