/**
 * The notice shown on the map when a recomputed period leaves it plain: no place passes the significance test once
 * every place on the map is tested at once (Benjamini-Hochberg, rangeMap.ts). Typical for periods of about ten years.
 */
import { periodText, type Period } from '../menu/period';

/** Below this share of the map the menu line reads "0%", and the map looks empty. */
export const EMPTY_SHARE = 0.005;
/** Below this share the map is not empty but looks it: a few specks of colour. */
export const SPARSE_SHARE = 0.03;

export interface ShownMap {
  start: number;
  end: number;
  fracSignificant: number;
  recomputed: boolean;
}

/** True when the map on screen was recomputed for a chosen period and (almost) nothing on it is significant. */
export function isEmptyMap(shown: ShownMap): boolean {
  return shown.recomputed && Number.isFinite(shown.fracSignificant) && shown.fracSignificant < SPARSE_SHARE;
}

export function emptyMapText(shown: ShownMap): string {
  const period: Period = [shown.start, shown.end];
  const n = shown.end - shown.start + 1;
  const head =
    shown.fracSignificant < EMPTY_SHARE
      ? `Nothing on the map is significant for ${periodText(period)}.`
      : `Only ${Math.max(1, Math.round(shown.fracSignificant * 100))}% of the map is significant for ${periodText(period)}.`;
  return (
    `${head} With only ${n} years, few trends stand out clearly enough once every place on the map is tested at ` +
    'once, so the map stays mostly plain. A click still shows the trend for the place you pick. Try a longer period.'
  );
}
