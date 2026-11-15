/**
 * Menu lines for a period map: which rule the colours follow, and how the colour scale differs from the whole record.
 * A short period leaves almost nothing that passes the map-wide test, so its map shows every change instead
 * (rangeMap.ts finishResult, SPARSE_SHARE); and its trends per decade are several times larger, so the scale widens.
 */
import { formatTick } from './legend';
import { periodText, type Period } from '../menu/period';

export interface ShownMap {
  start: number;
  end: number;
  fracSignificant: number;
  recomputed: boolean;
  vmax?: number;
}

/** Menu line for a map that shows every change (replaces "Plain map = no significant trend"). */
export function allChangesLine(shown: ShownMap, shareOf: string): string {
  return `Every change is drawn: strong = significant at that place on its own, faded = not significant. ${Math.round(shown.fracSignificant * 100)}% ${shareOf} passes the map-wide test`;
}

/**
 * The line shown when a period map's colour scale differs from the whole record's (null when it does not). The scale is
 * a rate (change per decade), and a rate measured over fewer years swings more, so it WIDENS for a short period. To make
 * that less surprising the line also gives each scale as the total change along the trend line over its own years
 * (rate x (last year - first year) / 10), which is the more intuitive size and is usually similar or smaller.
 */
export function scaleChangedLine(shown: ShownMap, fullVmax: number, fullYears: Period): string | null {
  if (!shown.recomputed || shown.vmax === undefined || !(fullVmax > 0) || shown.vmax === fullVmax) return null;
  const plain = (v: number) => formatTick(v).replace(/^[+-]/, '');
  const total = (rate: number, p: Period) => plain((rate * (p[1] - p[0])) / 10);
  const here: Period = [shown.start, shown.end];
  return (
    `The colour scale has changed for this period: ±${plain(shown.vmax)} per decade, which is about ±${total(shown.vmax, here)} ` +
    `in total over ${periodText(here)}. For ${periodText(fullYears)} it is ±${plain(fullVmax)} per decade, about ±${total(fullVmax, fullYears)} ` +
    'in total. A rate measured over fewer years swings more, so the per-decade scale is wider for a short period.'
  );
}
