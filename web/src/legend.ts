/** Tick label with an explicit sign: "+0.74", "0", "-0.74". Decimals depend on magnitude. */
export function formatTick(v: number): string {
  const a = Math.abs(v);
  const decimals = a >= 10 ? 0 : a >= 1 ? 1 : 2;
  const body = a.toFixed(decimals);
  if (Number(body) === 0) return '0';
  return `${v > 0 ? '+' : '-'}${body}`;
}

export function gradientCss(stops: string[]): string {
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

/** Legend bar: the overlay colours at their real opacity (left to right, -vmax..+vmax) over a half land, half water backdrop. */
export function overlayBarCss(
  stops: { t: number; rgb: string; alpha: number }[],
  render: { land: string; ocean: string },
): string {
  const rgba = stops.map((s) => {
    const h = s.rgb.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    return `rgba(${r}, ${g}, ${b}, ${s.alpha})`;
  });
  return `${gradientCss(rgba)}, linear-gradient(to bottom, ${render.land} 50%, ${render.ocean} 50%)`;
}

export function significantText(frac: number): string {
  return `${Math.round(frac * 100)}% of the globe shows a significant trend.`;
}
