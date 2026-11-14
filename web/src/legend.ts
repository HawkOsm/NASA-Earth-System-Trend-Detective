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

export function significantText(frac: number): string {
  return `${Math.round(frac * 100)}% of the globe shows a significant trend.`;
}
