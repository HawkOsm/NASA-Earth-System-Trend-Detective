import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { signedRate } from './analysis';
import CountryMap, { insideText, type CityTrend } from './CountryMap';
import type { CountryPanelState } from './CountryPanel';
import { cityMark, provinceHeading, sortProvinces, type ProvinceTrend } from './country';
import type { VariableMeta } from './data';
import { summarize, type DetailCell, type Ring } from './detail';
import { VARIABLES } from './demos';
import { displayUnits } from './format';
import { formatTick, overlayBarCss } from './legend';
import { MIN_YEARS } from './analysis';
import PeriodBar from './PeriodBar';
import { ResultChart, ResultSummary } from './Panel';
import { periodText, type Period } from './period';

export type OverlayState = Exclude<CountryPanelState, { status: 'water' }>;

interface Props {
  state: OverlayState;
  meta: VariableMeta;
  metas: Record<string, VariableMeta>;
  variable: string;
  onVariable: (v: string) => void;
  period: Period;
  fullYears: Period;
  fullPeriod: boolean;
  onPeriodChange: (p: Period) => void;
  onPeriodCommit: () => void;
  onPeriodReset: () => void;
  recomputing: number | null;
  mapFailed: boolean;
  onClose: () => void;
  onRetry: () => void;
  trends: { cells: DetailCell[]; cities: CityTrend[] } | null;
  /** Provinces / states with their trend for the selected period (null: none, or not computed yet). */
  provinces?: ProvinceTrend[] | null;
  polys: Ring[][] | null;
  outlineError: boolean;
  wrapRef: number | null;
  vmax: number;
  onSelectCell: (lat: number, lng: number) => void;
  onSelectCity: (city: CityTrend) => void;
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/** The selected country lifted to the whole screen: the piece in the middle, its data in cards around it. */
export default function CountryOverlay(p: Props) {
  const { state, meta } = p;
  const units = displayUnits(meta.units);
  const rec = state.status === 'ready' ? state.data.rec : state.rec;
  const rootRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const [height, setHeight] = useState(700);
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1100px)').matches);

  // Focus the back button on open; give focus back to where it was on close.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    backRef.current?.focus();
    return () => {
      if (prev && prev !== document.body && document.contains(prev)) prev.focus();
      else (document.querySelector('.header .howto-btn') as HTMLElement | null)?.blur();
    };
  }, []);

  // Escape closes (unless the help dialog is open on top); Tab stays inside the dialog.
  const closeRef = useRef(p.onClose);
  closeRef.current = p.onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (document.querySelector('.modal-backdrop')) return;
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !rootRef.current || document.querySelector('.modal-backdrop')) return;
      const els = Array.from(rootRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      const act = document.activeElement;
      if (!rootRef.current.contains(act)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && act === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && act === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const update = () => setHeight(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    const mq = window.matchMedia('(min-width: 1100px)');
    const onMq = () => setWide(mq.matches);
    mq.addEventListener('change', onMq);
    return () => {
      ro.disconnect();
      mq.removeEventListener('change', onMq);
    };
  }, []);

  // Room for the piece: the overlay height minus top bar, title, readout, legend, scale line and period bar.
  const pieceMax = wide ? Math.min(Math.max(height - 420, 260), 900) : Math.min(Math.max(height - 360, 240), 520);

  const sub = rec.tiny
    ? 'This country is smaller than one grid cell; values are for the single cell that covers it.'
    : `Average over the whole country (${rec.nCells.toLocaleString('en-US')} grid cells of about 50 km, weighted by area)`;

  const summary = useMemo(() => (p.trends ? summarize(p.trends.cells) : null), [p.trends]);
  const bare = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t === e.currentTarget || t.dataset.bare !== undefined) p.onClose();
  };

  const ready = state.status === 'ready' ? state : null;

  // Provinces: the map and its hooks use the file order; the list is sorted by trend.
  const provs = p.provinces && p.provinces.length ? p.provinces : null;
  const [hoverProv, setHoverProv] = useState<number | null>(null);
  const provRows = useMemo(() => (provs ? sortProvinces(provs.map((pv, index) => ({ pv, index, name: pv.name, slopeDecade: pv.slopeDecade }))) : []), [provs]);
  const provHeading = useMemo(() => (provs ? provinceHeading(provs.map((pv) => pv.type)) : ''), [provs]);

  return (
    <div
      ref={rootRef}
      className="co"
      role="dialog"
      aria-modal="true"
      aria-labelledby="co-title"
      onClick={bare}
    >
      <div className="co-inner" data-bare>
        <div className="co-top" data-bare>
          <button ref={backRef} className="co-back" onClick={p.onClose}>
            ← Back to the globe
          </button>
          <div className="co-vars" role="group" aria-label="Variable">
            {VARIABLES.map((v) => (
              <button key={v} className={`co-var${v === p.variable ? ' active' : ''}`} aria-pressed={v === p.variable} onClick={() => p.onVariable(v)}>
                {p.metas[v] ? p.metas[v].label : v}
              </button>
            ))}
          </div>
        </div>

        <div className="co-grid" data-bare>
          <section className="co-centre" data-bare aria-label="The country">
            <h2 id="co-title" className="co-title">
              {rec.name}
            </h2>
            <p className="co-sub">{sub}</p>
            {state.status === 'loading' && <p className="panel-msg detail-msg">Loading {state.rec.name}…</p>}
            {state.status === 'error' && (
              <div className="panel-msg panel-error">
                <p>{state.message}</p>
                <button className="retry" onClick={p.onRetry}>
                  Try again
                </button>
              </div>
            )}
            {ready && !p.trends && <p className="panel-msg detail-msg">Computing…</p>}
            {ready && p.trends && !p.polys && !p.outlineError && <p className="panel-msg detail-msg">Loading the outline…</p>}
            {ready && p.outlineError && <p className="panel-msg panel-error detail-msg">The country outline could not be loaded.</p>}
            {ready && p.trends && p.polys && (
              <CountryMap
                meta={meta}
                name={rec.name}
                polys={p.polys}
                wrapRef={p.wrapRef}
                cells={p.trends.cells}
                cities={p.trends.cities}
                vmax={p.vmax}
                tiny={rec.tiny}
                maxHeight={pieceMax}
                onSelectCell={p.onSelectCell}
                onSelectCity={p.onSelectCity}
                provinces={provs}
                highlightProvince={hoverProv}
                onHoverProvince={setHoverProv}
              >
                <div className="co-legend" aria-label="Colour legend">
                  <div className="co-legend-title">Change per decade ({units}), {periodText(p.period)}</div>
                  <div className="legend-bar" style={{ background: overlayBarCss(meta.legend_stops, meta.render) }} />
                  <div className="legend-ticks">
                    <span>{formatTick(-p.vmax)}</span>
                    <span>{formatTick(0)}</span>
                    <span>{formatTick(p.vmax)}</span>
                  </div>
                </div>
              </CountryMap>
            )}
          </section>

          {ready && (
            <div className="co-col co-left" data-bare>
              {ready.analysis ? (
                <>
                  <section className="co-card" aria-label="Whole country">
                    <h3 className="co-card-title">Whole country</h3>
                    <ResultSummary a={ready.analysis} area={true} country={true} />
                  </section>
                  <section className="co-card" aria-label="Trend chart">
                    <ResultChart a={ready.analysis} period={p.period} country={true} />
                  </section>
                </>
              ) : (
                <section className="co-card" aria-label="Whole country">
                  <h3 className="co-card-title">Whole country</h3>
                  <p className="panel-msg">
                    Not enough data: only {ready.nYears} years have values for this country
                    {p.fullPeriod ? '' : ` in ${periodText(p.period)}`} (at least {MIN_YEARS} are needed).
                  </p>
                </section>
              )}
            </div>
          )}

          {ready && (
            <div className="co-col co-right" data-bare>
              <section className="co-card" aria-label="Inside the country">
                <h3 className="co-card-title">Inside the country</h3>
                {summary ? (
                  <>
                    <p className="detail-summary">{insideText(summary, units)}</p>
                    <p className="detail-note">Faded cells are not significant on their own.</p>
                  </>
                ) : (
                  <p className="panel-msg detail-msg">Computing…</p>
                )}
              </section>
              {provs && (
                <section className="co-card co-provs" aria-label={provHeading}>
                  <h3 className="co-card-title">{provHeading}</h3>
                  <ul className="provs" onMouseLeave={() => setHoverProv(null)}>
                    {provRows.map(({ pv, index }) => {
                      const m = cityMark(pv.slopeDecade, pv.p);
                      return (
                        <li key={`${pv.name}-${index}`}>
                          <div
                            className={`prov-row${hoverProv === index ? ' active' : ''}`}
                            onMouseEnter={() => setHoverProv(index)}
                          >
                            <span className="city-name">{pv.name}</span>
                            <span className="city-rate">{pv.slopeDecade === null ? 'no data' : `${signedRate(pv.slopeDecade)} ${units}/decade`}</span>
                            <span className={`city-mark city-mark-${m.kind}`} title={m.label} aria-label={m.label}>
                              {m.symbol}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
              {p.trends && p.trends.cities.length > 0 && (
                <section className="co-card co-cities" aria-label="Cities">
                  <h3 className="co-card-title">Cities</h3>
                  <ul className="cities">
                    {p.trends.cities.map((c) => {
                      const m = cityMark(c.slopeDecade, c.p);
                      return (
                        <li key={c.id}>
                          <button className="city-row" onClick={() => p.onSelectCity(c)}>
                            <span className="city-name">
                              {c.name}
                              {c.capital ? ' (capital)' : ''}
                            </span>
                            <span className="city-rate">{c.slopeDecade === null ? 'no data' : `${signedRate(c.slopeDecade)} ${units}/decade`}</span>
                            <span className={`city-mark city-mark-${m.kind}`} title={m.label}>
                              {m.symbol} {m.label}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="detail-note">A city&apos;s value is the ~50 km grid cell it sits in, not the city alone.</p>
                </section>
              )}
            </div>
          )}
        </div>

        <PeriodBar
          inline
          period={p.period}
          full={p.fullYears}
          onChange={p.onPeriodChange}
          onCommit={p.onPeriodCommit}
          onReset={p.onPeriodReset}
          recomputing={p.recomputing}
          failed={p.mapFailed}
        />
        <p className="detail-howto co-howto">
                <strong>How to read this:</strong> the country is shown alone, in its own shape. The colours are blended smoothly between
                grid points about 50 km apart, as on the globe, so detail finer than that is not real; they use the same colours as the main
                map. The headline numbers are the area-weighted average of the grid cells inside the country, and a province&apos;s or city&apos;s
                number is the average of the grid cell(s) it covers.
        </p>
      </div>
    </div>
  );
}
