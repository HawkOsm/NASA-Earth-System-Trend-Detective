/** Equirectangular image pixel -> lat/lng (x: lng -180..180, y: lat 90..-90). Clamped to the image. */
export function pixelToLatLng(x: number, y: number, width: number, height: number): { lat: number; lng: number } {
  const fx = Math.min(Math.max(x / width, 0), 1);
  const fy = Math.min(Math.max(y / height, 0), 1);
  return { lat: 90 - fy * 180, lng: -180 + fx * 360 };
}

/** Inverse of pixelToLatLng, as fractions (0..1) of the image width/height. */
export function latLngToFraction(lat: number, lng: number): { fx: number; fy: number } {
  return { fx: (lng + 180) / 360, fy: (90 - lat) / 180 };
}

/** Largest 2:1 box that fits inside the given container. */
export function fitTwoToOne(cw: number, ch: number): { width: number; height: number } {
  const width = Math.max(0, Math.min(cw, 2 * ch));
  return { width, height: width / 2 };
}
