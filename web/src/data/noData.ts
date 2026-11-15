/**
 * One definition of "no data" for values that come from the NASA POWER API in the browser (the pipeline applies the
 * same rules to the cached grids, see pipeline/products.py):
 *  - a value that is not a finite number, equals the API fill value, or is <= -900 is missing;
 *  - percent variables (display_scale 100) are shown as a whole percent: round(value * 100);
 *  - zero_means_absent (snow cover, sea ice): a cell whose annual value is 0 in every year has no data.
 */
export const FILL_LIMIT = -900;
export const MISSING_INT16 = -32768;

/** What the browser needs to know about a variable's data (from {VAR}_meta.json). */
export interface VariableRules {
  displayScale: number;
  zeroMeansAbsent: boolean;
  /** Units to show instead of the API's own ("1" for a fraction). */
  units?: string;
}

export const PLAIN_RULES: VariableRules = { displayScale: 1, zeroMeansAbsent: false };

/** The rules of a variable from its meta (missing fields mean the plain defaults). */
export function rulesFromMeta(
  m: { display_scale?: number; zero_means_absent?: boolean; units?: string } | null | undefined,
): VariableRules {
  if (!m) return PLAIN_RULES;
  return { displayScale: m.display_scale ?? 1, zeroMeansAbsent: m.zero_means_absent ?? false, units: m.units };
}

/** One API value -> displayed value, or NaN when it is missing (fill value, <= -900, not a number). */
export function cleanApiValue(v: unknown, fill: number, displayScale = 1): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v === fill || v <= FILL_LIMIT) return NaN;
  return displayScale === 1 ? v : Math.round(v * displayScale);
}

/** True when every valid annual value is exactly 0 (and there is at least one): "never any snow / ice here". */
export function neverPresent(annual: number[]): boolean {
  let any = false;
  for (const v of annual) {
    if (Number.isNaN(v)) continue;
    if (v !== 0) return false;
    any = true;
  }
  return any;
}

/** Int16 stored value -> value: round(v * 100) with an offset added back; -32768 is NaN. */
export function fromInt16(v: number, offset = 0): number {
  return v === MISSING_INT16 ? NaN : v / 100 + offset;
}

/**
 * The no-data message of an area piece that cannot have values because of the variable's surface (meta "surface"):
 * a sea piece of a land-only variable, a country piece of a sea-only variable. null = the piece has files.
 * Decided before fetching: those files are not shipped.
 */
export function surfaceMessage(label: string, surface: string | undefined, isSea: boolean): string | null {
  if (surface === 'land' && isSea) return `${label} is only defined over land.`;
  if (surface === 'sea' && !isSea) return `${label} is only defined over the sea.`;
  return null;
}
