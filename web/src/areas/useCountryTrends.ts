import { useEffect, useState } from 'react';
import type { CityTrend } from './CountryMap';
import type { CountryData } from './CountryPanel';
import { computeCellTrends, spotTrend } from './country';
import type { DetailCell } from '../point/detail';
import type { Period } from '../menu/period';

interface Done {
  data: CountryData;
  period: Period;
  cells: DetailCell[];
  cities: CityTrend[];
}

/**
 * Per-cell and per-city trends of the selected country for the selected period (the existing trend() on each
 * series). Large countries are computed in chunks; a change of country, variable or period cancels the run.
 * `trends` is null while the result for the current inputs is not there yet.
 */
export function useCountryTrends(data: CountryData | null, period: Period) {
  const [done, setDone] = useState<Done | null>(null);

  useEffect(() => {
    if (!data) {
      setDone(null);
      return;
    }
    let cancelled = false;
    computeCellTrends(data.cells, data.values, data.years, period, () => cancelled).then((cells) => {
      if (cancelled || !cells) return;
      const cities: CityTrend[] = data.cities.map((c, k) => {
        const t = spotTrend(data.years, data.cityValues[k], period);
        return { ...c, slopeDecade: t.slopeDecade, p: t.p };
      });
      setDone({ data, period: [period[0], period[1]], cells, cities });
    });
    return () => {
      cancelled = true;
    };
  }, [data, period]);

  const fresh = done && data && done.data === data && done.period[0] === period[0] && done.period[1] === period[1];
  return { trends: fresh ? { cells: done.cells, cities: done.cities } : null };
}
