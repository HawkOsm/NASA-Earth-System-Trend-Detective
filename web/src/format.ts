import type { LatLng } from './Globe';

export function formatLatLng({ lat, lng }: LatLng): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(2)}°${ns}, ${Math.abs(lng).toFixed(2)}°${ew}`;
}

/** Map API units to what the user should see ("C" -> "°C"); others unchanged. */
export function displayUnits(units: string): string {
  return units === 'C' ? '°C' : units;
}
