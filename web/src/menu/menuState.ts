/** What the menu shows (Menu.tsx): which of its sub-menus are dropped down. */

export const SEGMENTS = [
  { key: 'data', label: 'Data' },
  { key: 'period', label: 'Period' },
  { key: 'scale', label: 'Scale' },
  { key: 'click', label: 'Click' },
  { key: 'layers', label: 'Layers' },
] as const;

export type SegmentKey = (typeof SEGMENTS)[number]['key'];

export interface MenuState {
  /** Sub-menus that are dropped down. */
  on: SegmentKey[];
}

export const MENU_STORAGE_KEY = 'trend-detective.menu.v2';

/** A wide window starts with the variable and colour scale dropped down; a phone starts with every sub-menu folded. */
export function defaultMenuState(narrow: boolean): MenuState {
  return narrow ? { on: [] } : { on: ['data', 'scale'] };
}

const isKey = (k: unknown): k is SegmentKey => SEGMENTS.some((s) => s.key === k);

/** The stored state, or the default when nothing valid is stored. Unknown segments are dropped; order follows SEGMENTS. */
export function parseMenuState(raw: string | null, narrow: boolean): MenuState {
  if (!raw) return defaultMenuState(narrow);
  try {
    const v = JSON.parse(raw) as { on?: unknown };
    if (typeof v !== 'object' || v === null || !Array.isArray(v.on)) return defaultMenuState(narrow);
    const on = v.on;
    return { on: SEGMENTS.map((s) => s.key).filter((k) => on.includes(k) && isKey(k)) };
  } catch {
    return defaultMenuState(narrow);
  }
}

/** Switch one segment on or off (kept in SEGMENTS order). */
export function toggleSegment(on: SegmentKey[], key: SegmentKey): SegmentKey[] {
  const next = on.includes(key) ? on.filter((k) => k !== key) : [...on, key];
  return SEGMENTS.map((s) => s.key).filter((k) => next.includes(k));
}
