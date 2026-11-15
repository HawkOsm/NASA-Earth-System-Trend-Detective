import type { VariableName } from '../data/demos';

/**
 * Where a first-time visitor can begin: three places whose trend is not only significant but also CONFIRMED by an
 * independent observation record (see reference.ts and docs/EVALUATION.md).
 *
 * How they were chosen (14 November 2026): every city in cities.json was screened against the pipeline products for a
 * trend that is significant in MERRA-2, graded "Robust" by the pattern checks, has no flagged bad year, and whose
 * surrounding box in the independent record shows a significant change in the same direction. From that list one
 * well-known place was taken per story (warming, wetter, drier). The numbers below were then read from the site's own
 * point panel, which computes them live from the NASA POWER API, so opening a finding shows the same figures:
 *
 *   Istanbul      cell 41.00°N  28.75°E   air temperature  +0.5383 °C/decade      p = 4.6e-10   GISTEMP +0.5465
 *   Shanghai      cell 31.00°N 121.25°E   precipitation    +0.3608 mm/day/decade  p = 2.7e-5    GPCP    +0.2593
 *   Porto Velho   cell  9.00°S  63.75°W   precipitation    -0.6711 mm/day/decade  p = 3.8e-8    GPCP    -0.3596
 *
 * A finding must never be listed here on significance alone. With four rainfall records (GPCP, CMAP, GPCC, PREC/L),
 * Shanghai is confirmed by all four and Porto Velho by three. An earlier candidate, rainfall at Cebu (+0.87 mm/day per
 * decade in MERRA-2), is confirmed by three of four at about half that size; Shanghai was preferred.
 */
export interface StartFinding {
  key: string;
  /** What changed, as a short sentence. */
  headline: string;
  variable: VariableName;
  /** Label of the variable as the menu shows it. */
  variableLabel: string;
  lat: number;
  lng: number;
  /** Trend per decade as the point panel shows it, and its display units. */
  rate: number;
  units: string;
  /** The independent record that confirms it, and that record's trend per decade for the box around the place. */
  record: string;
  recordRate: number;
}

export const START_FINDINGS: readonly StartFinding[] = [
  {
    key: 'istanbul-warming',
    headline: 'Istanbul is getting warmer',
    variable: 'T2M',
    variableLabel: 'Air temperature',
    lat: 41.01,
    lng: 28.97,
    rate: 0.54,
    units: '°C',
    record: 'NASA GISTEMP',
    recordRate: 0.55,
  },
  {
    key: 'shanghai-wetter',
    headline: 'Shanghai is getting wetter',
    variable: 'PRECTOTCORR',
    variableLabel: 'Precipitation',
    lat: 31.22,
    lng: 121.43,
    rate: 0.36,
    units: 'mm/day',
    record: 'GPCP',
    recordRate: 0.26,
  },
  {
    key: 'amazon-drier',
    headline: 'The Amazon at Porto Velho is getting drier',
    variable: 'PRECTOTCORR',
    variableLabel: 'Precipitation',
    lat: -8.76,
    lng: -63.9,
    rate: -0.67,
    units: 'mm/day',
    record: 'GPCP',
    recordRate: -0.36,
  },
];

const signed = (x: number): string => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(2)}`;

/** "+0.54 °C per decade" */
export function rateText(f: StartFinding): string {
  return `${signed(f.rate)} ${f.units} per decade`;
}

/** "NASA GISTEMP agrees: +0.55" */
export function recordText(f: StartFinding): string {
  return `${f.record} agrees: ${signed(f.recordRate)}`;
}
