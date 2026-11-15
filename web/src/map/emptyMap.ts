/**
 * The notice shown on the map when a recomputed period leaves it plain: no place passes the significance test once
 * every place on the map is tested at once (Benjamini-Hochberg, rangeMap.ts). Typical for periods of about ten years.
 */
import { periodText, type Period } from '../menu/period';
import { SPARSE_SHARE } from './rangeMap';

/** Below this share of the map the menu line reads "0%". */
export const EMPTY_SHARE = 0.005;
export { SPARSE_SHARE };

export interface ShownMap {
  start: number;
  end: number;
  fracSignificant: number;
  recomputed: boolean;
}

/**
 * True when the map on screen was recomputed for a chosen period and (almost) nothing on it passes the map-wide test.
 * The map then shows every change (rangeMap.ts finishResult) and the notice explains how to read it.
 */
export function isEmptyMap(shown: ShownMap): boolean {
  return shown.recomputed && Number.isFinite(shown.fracSignificant) && shown.fracSignificant < SPARSE_SHARE;
}

export function emptyMapText(shown: ShownMap): string {
  const period: Period = [shown.start, shown.end];
  const n = shown.end - shown.start + 1;
  const head =
    shown.fracSignificant < EMPTY_SHARE
      ? `No trend passes the map-wide test for ${periodText(period)}`
      : `Only ${Math.max(1, Math.round(shown.fracSignificant * 100))}% of the map passes the map-wide test for ${periodText(period)}`;
  return (
    `${head}, so the map shows every change instead, as the country view does: strong colour where a place is ` +
    `significant on its own, faded where it is not. With only ${n} years, about 1 place in 20 looks significant by ` +
    'chance alone, so read this as the direction of change, not as proof. A longer period gives a firmer answer.'
  );
}

/** Menu line for a map that shows every change (replaces "Plain map = no significant trend"). */
export function allChangesLine(shown: ShownMap, shareOf: string): string {
  return `Every change is drawn: strong = significant at that place on its own, faded = not significant. ${Math.round(shown.fracSignificant * 100)}% ${shareOf} passes the map-wide test`;
}
