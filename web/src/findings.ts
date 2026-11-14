import type { VariableName } from './demos';

/**
 * Three findings the first-run card offers as a place to start. Each opens the ordinary point panel for the grid cell
 * that contains the place, for the whole period, so the panel shows the same number as the card.
 *
 * The rates were computed on 14 November 2026 with the site's own code (fetchPointSeries + analyze: Theil–Sen slope,
 * Mann–Kendall p-value) from the NASA POWER monthly point API, 1981–2025. All three have p < 0.001.
 *   Istanbul     cell 41.00°N 28.75°E   T2M          +0.54 °C per decade        (95% range +0.42 to +0.65)
 *   Cebu         cell 10.50°N 123.75°E  PRECTOTCORR  +0.87 mm/day per decade    (95% range +0.64 to +1.11)
 *   Porto Velho  cell 9.00°S 63.75°W    GWETROOT     -3.33 % points per decade  (95% range -4.27 to -2.27)
 * If the data or the method changes, recompute them: the card must never disagree with the panel.
 */
export interface Finding {
  id: string;
  /** The sentence on the button. */
  title: string;
  /** The number under it, as the panel shows it. */
  detail: string;
  variable: VariableName;
  lat: number;
  lng: number;
}

export const FINDINGS: readonly Finding[] = [
  {
    id: 'istanbul',
    title: 'Istanbul is warming',
    detail: 'Air temperature: +0.54 °C per decade',
    variable: 'T2M',
    lat: 41.01,
    lng: 28.98,
  },
  {
    id: 'cebu',
    title: 'Cebu is getting wetter',
    detail: 'Precipitation: +0.87 mm/day per decade',
    variable: 'PRECTOTCORR',
    lat: 10.32,
    lng: 123.89,
  },
  {
    id: 'porto-velho',
    title: 'The Amazon near Porto Velho is drying',
    detail: 'Soil moisture: -3.33 percentage points per decade',
    variable: 'GWETROOT',
    lat: -8.76,
    lng: -63.9,
  },
];
