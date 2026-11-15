import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { signedRate, type Analysis } from '../point/analysis';
import { cellRgb } from '../point/detail';
import { decadeMeans, fmtTick, fmtValue, niceTicks, padDomain, trendHistogram } from './countryStats';

/** The charts of the country view. All are plain SVG / HTML drawn at the card's real width, in the site's dark colours. */

const GRID = '#1c2230';
const AXIS = '#3a4a6a';
const INK = '#e6e9ef';
const ANNUAL = '#ffd166';

export type Stops = [number, number, number][];
/** The map's colour for a trend, so bars and dots read like the map. */
export const rateColour = (slope: number, vmax: number, stops: Stops): string => `rgb(${cellRgb(slope, vmax, stops).join(',')})`;

/** The dark card behind the country view's text (`.co-card` in styles.css), as red, green, blue. */
const CARD_RGB: [number, number, number] = [14, 20, 34];
/** The contrast that ordinary text needs against its background (WCAG AA). */
const TEXT_CONTRAST = 4.5;

const luminance = ([r, g, b]: number[]): number => {
  const lin = (c: number) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

/** Contrast ratio of a colour against the dark card (1 = the same, 21 = white on black). */
export function contrastOnCard(rgb: number[]): number {
  return (luminance(rgb) + 0.05) / (luminance(CARD_RGB) + 0.05);
}

/**
 * An `rgb(r,g,b)` colour, lightened step by step until it can be read as text on the dark card. The deep blue and
 * brown ends of the scales are too dark for that (the big rate of a cooling sea had a contrast of 2.9).
 */
export function readableOnDark(colour: string): string {
  const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(colour);
  if (!m) return colour;
  let rgb = [Number(m[1]), Number(m[2]), Number(m[3])];
  for (let k = 0; k < 40 && contrastOnCard(rgb) < TEXT_CONTRAST; k++) rgb = rgb.map((c) => c + (255 - c) * 0.1);
  return `rgb(${rgb.map((c) => Math.round(c)).join(',')})`;
}

/** Width of an element in CSS pixels, kept current. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(320);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setW(Math.max(el.clientWidth, 200));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// ---- rate with its 95% range, against the independent records -------------------------------------------------------

export interface RangeRecord {
  short: string;
  slope: number;
}

export function RangePlot({ a, records, colour }: { a: Analysis; records: RangeRecord[]; colour: string }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const labelW = records.length ? 92 : 0;
  const valueW = 44;
  const rowH = 20;
  const rows = 1 + records.length;
  const h = rows * rowH + 20;
  const [lo, hi] = padDomain([a.ciLowDecade, a.ciHighDecade, a.slopeDecade, ...records.map((r) => r.slope)], true, 0.1);
  const x = (v: number) => labelW + 6 + ((v - lo) / (hi - lo)) * (w - labelW - valueW - 12);
  const ticks = niceTicks(lo, hi, 3);
  const y0 = rowH / 2;
  return (
    <div ref={ref} className="cc-host">
      <svg width={w} height={h} role="img" aria-label={`Rate ${signedRate(a.slopeDecade)}, 95% range ${signedRate(a.ciLowDecade)} to ${signedRate(a.ciHighDecade)}${records.map((r) => `; ${r.short} ${signedRate(r.slope)}`).join('')}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={0} y2={rows * rowH} stroke={Math.abs(t) < 1e-9 ? AXIS : GRID} />
            <text x={x(t)} y={h - 4} textAnchor="middle" className="cc-tick">
              {t > 0 ? `+${fmtTick(t)}` : fmtTick(t)}
            </text>
          </g>
        ))}
        {records.length > 0 && (
          <text x={0} y={y0 + 4} className="cc-label">
            This data
          </text>
        )}
        <line x1={x(a.ciLowDecade)} x2={x(a.ciHighDecade)} y1={y0} y2={y0} stroke={colour} strokeWidth={2.5} strokeLinecap="round" />
        <line x1={x(a.ciLowDecade)} x2={x(a.ciLowDecade)} y1={y0 - 4} y2={y0 + 4} stroke={colour} strokeWidth={2} />
        <line x1={x(a.ciHighDecade)} x2={x(a.ciHighDecade)} y1={y0 - 4} y2={y0 + 4} stroke={colour} strokeWidth={2} />
        <circle cx={x(a.slopeDecade)} cy={y0} r={5} fill={colour} stroke="#0e1422" strokeWidth={1.5} />
        <text x={w} y={y0 + 4} textAnchor="end" className="cc-value">
          {signedRate(a.slopeDecade)}
        </text>
        {records.map((r, k) => {
          const y = rowH * (k + 1) + rowH / 2;
          return (
            <g key={r.short}>
              <text x={0} y={y + 4} className="cc-tick">
                {r.short}
              </text>
              <rect x={x(r.slope) - 4} y={y - 4} width={8} height={8} fill="#c9cfdb" transform={`rotate(45 ${x(r.slope)} ${y})`} />
              <text x={w} y={y + 4} textAnchor="end" className="cc-tick">
                {signedRate(r.slope)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---- the yearly series -------------------------------------------------------------------------------------------------

interface SeriesProps {
  a: Analysis;
  /** Every year of the record and the area's value in it (NaN: missing). */
  years: number[];
  values: number[];
  units: string;
  colour: string;
}

/** Each year's value, the trend line over the selected period and the 95% range of its rate as a band. */
export function SeriesChart({ a, years, values, units, colour }: SeriesProps) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const h = 230;
  const m = { l: 44, r: 10, t: 22, b: 22 };

  const g = useMemo(() => {
    const pts = years.map((yr, k) => ({ yr, v: values[k] })).filter((p) => Number.isFinite(p.v));
    const mean = pts.reduce((s, p) => s + p.v, 0) / (pts.length || 1);
    // The trend line is the one analyze() fitted (stored as an anomaly from the mean of all valid years).
    const line = a.chart.x.map((t, k) => ({ t, v: a.chart.trend[k] })).filter((p): p is { t: number; v: number } => p.v !== null);
    const t0 = line.length ? line[0].t : a.period[0];
    const t1 = line.length ? line[line.length - 1].t : a.period[1];
    const v0 = line.length ? line[0].v + mean : mean;
    const v1 = line.length ? line[line.length - 1].v + mean : mean;
    const tm = (t0 + t1) / 2;
    const vm = (v0 + v1) / 2;
    const band = [a.ciLowDecade, a.ciHighDecade].map((s) => [vm + (s / 10) * (t0 - tm), vm + (s / 10) * (t1 - tm)]);
    return { pts, t0, t1, v0, v1, tm, vm, band };
  }, [a, years, values]);

  if (!g.pts.length) return null;
  const xMin = years[0];
  const xMax = years[years.length - 1];
  const [yLo, yHi] = padDomain([...g.pts.map((p) => p.v), ...g.band.flat()], false, 0.06);
  const x = (t: number) => m.l + ((t - xMin) / Math.max(xMax - xMin, 1)) * (w - m.l - m.r);
  const y = (v: number) => m.t + (1 - (v - yLo) / (yHi - yLo)) * (h - m.t - m.b);
  const yTicks = niceTicks(yLo, yHi, 4);
  const xTicks = years.filter((yr) => yr % 10 === 0);
  const hp = hover === null ? null : g.pts.find((p) => p.yr === hover) ?? null;

  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const t = xMin + ((e.clientX - box.left - m.l) / (w - m.l - m.r)) * (xMax - xMin);
    let best: number | null = null;
    let bd = Infinity;
    for (const p of g.pts) {
      const d = Math.abs(p.yr - t);
      if (d < bd) {
        bd = d;
        best = p.yr;
      }
    }
    setHover(best);
  };

  const [lowB, highB] = g.band;
  return (
    <div ref={ref} className="cc-host">
      <svg
        width={w}
        height={h}
        role="img"
        aria-label={`Yearly values ${xMin} to ${xMax} in ${units}, with the trend line for ${a.period[0]} to ${a.period[1]}`}
        onPointerMove={move}
        onPointerDown={move}
        onPointerLeave={() => setHover(null)}
        style={{ touchAction: 'pan-y' }}
      >
        {a.chart.shade && (
          <rect x={x(a.chart.shade[0])} y={m.t} width={Math.max(x(a.chart.shade[1]) - x(a.chart.shade[0]), 0)} height={h - m.t - m.b} fill="rgba(106,163,255,0.10)" />
        )}
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={w - m.r} y1={y(t)} y2={y(t)} stroke={GRID} />
            <text x={m.l - 6} y={y(t) + 4} textAnchor="end" className="cc-tick">
              {fmtTick(t)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} x={x(t)} y={h - 6} textAnchor="middle" className="cc-tick">
            {t}
          </text>
        ))}
        <polygon points={`${x(g.t0)},${y(lowB[0])} ${x(g.tm)},${y(g.vm)} ${x(g.t0)},${y(highB[0])}`} fill={colour} opacity={0.22} />
        <polygon points={`${x(g.t1)},${y(lowB[1])} ${x(g.tm)},${y(g.vm)} ${x(g.t1)},${y(highB[1])}`} fill={colour} opacity={0.22} />
        <polyline fill="none" stroke={ANNUAL} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={g.pts.map((p) => `${x(p.yr)},${y(p.v)}`).join(' ')} />
        {g.pts.map((p) => (
          <circle key={p.yr} cx={x(p.yr)} cy={y(p.v)} r={2.5} fill={ANNUAL} />
        ))}
        <line x1={x(g.t0)} y1={y(g.v0)} x2={x(g.t1)} y2={y(g.v1)} stroke="#ffffff" strokeWidth={2} strokeDasharray="6 5" />
        {hp && (
          <g>
            <line x1={x(hp.yr)} x2={x(hp.yr)} y1={m.t} y2={h - m.b} stroke={AXIS} />
            <circle cx={x(hp.yr)} cy={y(hp.v)} r={5} fill={ANNUAL} stroke="#0e1422" strokeWidth={2} />
          </g>
        )}
        <text x={hp ? Math.min(Math.max(x(hp.yr), m.l + 40), w - m.r - 40) : m.l} y={13} textAnchor={hp ? 'middle' : 'start'} className={hp ? 'cc-value' : 'cc-tick'}>
          {hp ? `${hp.yr}: ${fmtValue(hp.v)} ${units}` : units}
        </text>
      </svg>
      <div className="cc-legend">
        <span>
          <i className="cc-sw" style={{ background: ANNUAL }} /> Each year
        </span>
        <span>
          <i className="cc-sw cc-sw-dash" /> Trend
        </span>
        <span>
          <i className="cc-sw" style={{ background: colour, opacity: 0.45 }} /> 95% range of the rate
        </span>
      </div>
    </div>
  );
}

// ---- decade averages ---------------------------------------------------------------------------------------------------

export function DecadeChart({ years, values, units }: { years: number[]; values: number[]; units: string }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const d = useMemo(() => decadeMeans(years, values), [years, values]);
  if (d.length < 2) return null;
  const h = 118;
  const [lo, hi] = padDomain(d.map((b) => b.mean), false, 0.25);
  const x = (k: number) => 28 + (k / (d.length - 1)) * (w - 56);
  const y = (v: number) => 22 + (1 - (v - lo) / (hi - lo)) * (h - 22 - 30);
  const change = d[d.length - 1].mean - d[0].mean;
  return (
    <div ref={ref} className="cc-host">
      <svg width={w} height={h} role="img" aria-label={`Decade averages in ${units}: ${d.map((b) => `${b.label} ${fmtValue(b.mean)}`).join(', ')}`}>
        <polyline fill="none" stroke={AXIS} strokeWidth={2} points={d.map((b, k) => `${x(k)},${y(b.mean)}`).join(' ')} />
        {d.map((b, k) => (
          <g key={b.from}>
            <circle cx={x(k)} cy={y(b.mean)} r={5} fill={ANNUAL} opacity={b.partial ? 0.6 : 1}>
              <title>{`${b.from}–${b.to}: ${fmtValue(b.mean)} ${units} (${b.n} years)`}</title>
            </circle>
            <text x={x(k)} y={y(b.mean) - 9} textAnchor="middle" className="cc-value">
              {fmtValue(b.mean)}
            </text>
            <text x={x(k)} y={h - 6} textAnchor="middle" className="cc-tick">
              {b.label}
            </text>
          </g>
        ))}
      </svg>
      <div className="cc-legend">
        <span>
          {d[0].label} to {d[d.length - 1].label}: <strong>{signedRate(change)} {units}</strong>
        </span>
      </div>
    </div>
  );
}

// ---- spread of the cell trends -------------------------------------------------------------------------------------

interface HistProps {
  cells: { slopeDecade: number | null; p: number | null }[];
  alpha: number;
  vmax: number;
  stops: Stops;
  units: string;
}

export function TrendHistogram({ cells, alpha, vmax, stops, units }: HistProps) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const bins = useMemo(() => trendHistogram(cells, alpha), [cells, alpha]);
  if (!bins.length) return null;
  const h = 112;
  const top = 6;
  const base = h - 20;
  const max = Math.max(...bins.map((b) => b.n));
  const bw = (w - 12) / bins.length;
  const x = (k: number) => 6 + k * bw;
  const bh = (n: number) => (n / max) * (base - top);
  const lo = bins[0].lo;
  const hi = bins[bins.length - 1].hi;
  const xv = (v: number) => 6 + ((v - lo) / (hi - lo)) * (w - 12);
  const every = Math.max(1, Math.ceil(bins.length / Math.max(Math.floor(w / 56), 2)));
  return (
    <div ref={ref} className="cc-host">
      <svg width={w} height={h} role="img" aria-label={`Histogram of grid-cell trends from ${signedRate(lo)} to ${signedRate(hi)} ${units} per decade`}>
        {bins.map((b, k) => {
          const c = rateColour((b.lo + b.hi) / 2, vmax, stops);
          const hs = bh(b.nSig);
          const hn = bh(b.n - b.nSig);
          return (
            <g key={b.lo}>
              <title>{`${signedRate(b.lo)} to ${signedRate(b.hi)} ${units}/decade: ${b.n} cells, ${b.nSig} significant`}</title>
              {b.nSig > 0 && <rect x={x(k) + 1} y={base - hs} width={Math.max(bw - 2, 1)} height={hs} fill={c} />}
              {b.n > b.nSig && <rect x={x(k) + 1} y={base - hs - hn} width={Math.max(bw - 2, 1)} height={hn} fill={c} opacity={0.3} />}
            </g>
          );
        })}
        <line x1={6} x2={w - 6} y1={base} y2={base} stroke={AXIS} />
        {lo < 0 && hi > 0 && <line x1={xv(0)} x2={xv(0)} y1={top} y2={base + 3} stroke={INK} strokeDasharray="2 3" />}
        {bins.map((b, k) =>
          k % every === 0 && (k === 0 || w - 6 - x(k) > 64) ? (
            <text key={b.lo} x={x(k)} y={h - 5} textAnchor={k === 0 ? 'start' : 'middle'} className="cc-tick">
              {b.lo > 0 ? `+${fmtTick(b.lo)}` : fmtTick(b.lo)}
            </text>
          ) : null,
        )}
        <text x={w - 6} y={h - 5} textAnchor="end" className="cc-tick">
          {hi > 0 ? `+${fmtTick(hi)}` : fmtTick(hi)}
        </text>
      </svg>
    </div>
  );
}

// ---- rows of rates (provinces as bars, cities as dots) ---------------------------------------------------------------

export interface RateRow {
  key: string;
  name: string;
  slope: number | null;
  /** Significant on its own (drawn solid; otherwise faded). */
  solid: boolean;
  /** Tooltip / screen-reader text of the row. */
  title: string;
  active?: boolean;
  onClick?: () => void;
  onEnter?: () => void;
}

interface RateRowsProps {
  rows: RateRow[];
  /** Bars grow from zero; dots sit on an axis fitted to the values, with a stem from the reference. */
  mode: 'bar' | 'dot';
  vmax: number;
  stops: Stops;
  /** The whole area's rate, drawn as a line through the rows. */
  reference: number | null;
  onLeave?: () => void;
  /** Values the axis is fitted to when the rows shown are only part of the list. */
  domain?: (number | null)[];
  /** A divider (with this text) after the row of this index: rows were left out there. */
  gap?: { after: number; label: string };
}

export function RateRows({ rows, mode, vmax, stops, reference, onLeave, domain, gap }: RateRowsProps) {
  const vals = (domain ?? rows.map((r) => r.slope)).filter((v): v is number => v !== null);
  const [lo, hi] = padDomain(reference === null ? vals : [...vals, reference], mode === 'bar', mode === 'bar' ? 0.04 : 0.12);
  const pos = (v: number) => `${(((v - lo) / (hi - lo)) * 100).toFixed(2)}%`;
  const span = (a: number, b: number) => ({ left: pos(Math.min(a, b)), width: `${((Math.abs(b - a) / (hi - lo)) * 100).toFixed(2)}%` });
  const refIn = reference !== null && reference >= lo && reference <= hi;
  return (
    <>
      <ul className="rr" onMouseLeave={onLeave}>
        {rows.map((r, k) => {
          const c = r.slope === null ? '#3a4a6a' : rateColour(r.slope, vmax, stops);
          const inner = (
            <>
              <span className="rr-name">{r.name}</span>
              <span className="rr-track">
                {mode === 'bar' && lo < 0 && <i className="rr-zero" style={{ left: pos(0) }} />}
                {refIn && <i className="rr-ref" style={{ left: pos(reference as number) }} />}
                {r.slope !== null && mode === 'bar' && <i className="rr-bar" style={{ ...span(0, r.slope), background: c, opacity: r.solid ? 1 : 0.35 }} />}
                {r.slope !== null && mode === 'dot' && refIn && <i className="rr-stem" style={{ ...span(reference as number, r.slope), background: c }} />}
                {r.slope !== null && mode === 'dot' && <i className="rr-dot" style={{ left: pos(r.slope), background: r.solid ? c : 'transparent', borderColor: c }} />}
              </span>
              <span className="rr-val">{r.slope === null ? 'no data' : signedRate(r.slope)}</span>
            </>
          );
          return (
            <li key={r.key} onMouseEnter={r.onEnter} className={gap && gap.after === k ? 'rr-gap' : undefined} data-gap={gap && gap.after === k ? gap.label : undefined}>
              {r.onClick ? (
                <button className={`rr-row rr-btn${r.active ? ' active' : ''}`} onClick={r.onClick} title={r.title} aria-label={r.title}>
                  {inner}
                </button>
              ) : (
                <div className={`rr-row${r.active ? ' active' : ''}`} title={r.title} aria-label={r.title}>
                  {inner}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="rr-axis">
        <span />
        <span className="rr-axis-track">
          <span>{lo > 0 ? `+${fmtTick(+lo.toPrecision(2))}` : fmtTick(+lo.toPrecision(2))}</span>
          <span>{hi > 0 ? `+${fmtTick(+hi.toPrecision(2))}` : fmtTick(+hi.toPrecision(2))}</span>
        </span>
        <span />
      </div>
    </>
  );
}

// ---- sparkline ---------------------------------------------------------------------------------------------------------

export function Sparkline({ values, colour }: { values: number[]; colour: string }) {
  const pts = values.map((v, k) => ({ k, v })).filter((p) => Number.isFinite(p.v));
  if (pts.length < 2) return <svg className="cc-spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true" />;
  const [lo, hi] = padDomain(pts.map((p) => p.v), false, 0.1);
  const n = values.length - 1;
  return (
    <svg className="cc-spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
      <polyline
        fill="none"
        stroke={colour}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        points={pts.map((p) => `${((p.k / n) * 100).toFixed(1)},${(28 - ((p.v - lo) / (hi - lo)) * 28).toFixed(1)}`).join(' ')}
      />
    </svg>
  );
}
