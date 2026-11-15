import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { signedRate } from '../point/analysis';
import CountryMap, { insideText, type CityTrend } from './CountryMap';
import type { CountryPanelState } from './CountryPanel';
import { cityMark, countryMeanSeries, provinceHeading, sortProvinces, type ProvinceTrend } from './country';
import { DecadeChart, RangePlot, RateRows, SeriesChart, Sparkline, TrendHistogram, rateColour, type RateRow } from './CountryCharts';
import { useCountryVariables } from './useCountryVariables';
import type { VariableMeta } from '../data/data';
import { ALPHA_CELL, parseStops, summarize, type DetailCell, type Ring } from '../point/detail';
import { VARIABLE_GROUPS } from '../data/demos';
import { rateUnits, rateUnitsLong } from '../data/format';
import { formatTick, overlayBarCss } from '../map/legend';
import { MIN_YEARS } from '../point/analysis';
import PeriodBar from '../menu/PeriodBar';
import type { Analysis } from '../point/analysis';
import { fmtPValue } from '../stats/trend';
import { ReferenceLine } from '../evaluation/QualityBadge';
import { BADGE_LABEL, reasonSentences } from '../evaluation/quality';
import { combineGrade, hasReference } from '../evaluation/reference';
import { areaCheck, loadAreaReference, type AreaCheck, type AreaRefData } from '../evaluation/referenceAreas';
import type { RefClass } from '../evaluation/reference';
import { periodText, type Period } from '../menu/period';
import { cellKm } from './sea';
import { surfaceMessage } from '../data/noData';

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

/** Provinces shown before "Show all": this many from each end of the sorted list. */
const PROV_ENDS = 5;

const REF_CHIP: Record<RefClass, string> = {
  confirmed: 'Confirmed',
  partly: 'Partly confirmed',
  unconfirmed: 'Not confirmed',
  contradicted: 'Contradicted',
  info: 'Independent check',
  none: 'Independent check',
};

/** "Rising" / "Possibly falling" / "No clear trend": the verdict as one or three words. */
function trendWord(a: Analysis): string {
  if (a.slopeDecade === 0) return 'No change';
  if (a.kind === 'none') return 'No clear trend';
  const dir = a.slopeDecade > 0 ? 'rising' : 'falling';
  return a.kind === 'significant' ? dir[0].toUpperCase() + dir.slice(1) : `Possibly ${dir}`;
}

type ChipKey = 'sig' | 'grade' | 'ref' | 'note';

/**
 * The whole area in one card: the rate as the headline, its 95% range drawn against the independent records, and
 * the verdict, quality grade and independent check as chips. A chip opens the sentence(s) it stands for.
 */
function SummaryCard({ a, units, colour, caveat, reference }: { a: Analysis; units: string; colour: string; caveat?: string; reference: AreaCheck | null }) {
  const [open, setOpen] = useState<ChipKey | null>(null);
  const q = a.quality;
  const grade = combineGrade(q.grade, reference ? reference.cls : null);
  const sentences = reasonSentences(q, a.years, rateUnitsLong(a.units));
  const badge = grade === 'robust' || grade === 'caution' || grade === 'doubtful' ? BADGE_LABEL[grade] : null;
  const records = reference ? reference.records.filter((r) => r.available && r.slope !== null).map((r) => ({ short: r.short, slope: r.slope as number })) : [];
  const refCls = reference ? reference.cls ?? 'info' : null;
  const refLabel = reference && refCls ? (refCls === 'confirmed' && reference.n > 1 ? `Confirmed ${reference.k} of ${reference.n}` : REF_CHIP[refCls]) : null;
  const chip = (key: ChipKey, label: string, tone: string) => (
    <button key={key} className={`chip chip-${tone}${open === key ? ' open' : ''}`} aria-expanded={open === key} aria-controls="co-chip-panel" onClick={() => setOpen(open === key ? null : key)}>
      {label}
    </button>
  );
  return (
    <>
      <div className="hero">
        <div className="hero-rate" style={{ color: colour }}>
          {signedRate(a.slopeDecade)}
        </div>
        <div className="hero-side">
          <div className="hero-word">{trendWord(a)}</div>
          <div className="hero-units">{units} per decade</div>
        </div>
      </div>
      <div className="co-cap">{records.length ? 'Rate and its 95% range, against independent records' : 'Rate and its 95% range'}</div>
      <RangePlot a={a} records={records} colour={colour} />
      <div className={`chips quality quality-${grade}`} data-grade={grade} data-pattern-grade={q.grade}>
        {chip('sig', a.kind === 'significant' ? 'Significant' : a.kind === 'possible' ? 'Possible trend' : 'Not significant', a.kind)}
        {(badge || sentences.length > 0) && chip('grade', badge ?? 'Pattern checks', badge ? grade : 'none')}
        {refLabel && refCls && chip('ref', refLabel, `ref-${refCls}`)}
        {caveat && chip('note', 'Data note', 'none')}
      </div>
      {open && (
        <div id="co-chip-panel" className="chip-panel">
          {open === 'sig' && (
            <>
              <div className={`verdict verdict-${a.kind}`}>{a.verdict}</div>
              <p className="quality-reason">
                p-value {fmtPValue(a.p)} (lower = less likely chance). 95% range {signedRate(a.ciLowDecade)} to {signedRate(a.ciHighDecade)} {units} per decade.
              </p>
            </>
          )}
          {open === 'grade' &&
            sentences.map((s) => (
              <p key={s} className="quality-reason">
                {s}
              </p>
            ))}
          {open === 'ref' && reference && <ReferenceLine check={reference} />}
          {open === 'note' && <p className="quality-reason">{caveat}</p>}
        </div>
      )}
    </>
  );
}

/** The selected country lifted to the whole screen: the piece in the middle, its data in cards around it. */
export default function CountryOverlay(p: Props) {
  const { state, meta } = p;
  const units = rateUnits(meta.units);
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

  const sea = rec.sea ?? null;
  const what = sea ? 'sea' : 'country';
  // How many of the piece's cells have data for this variable (a land-only variable has none over a sea, and so on).
  const dropped = state.status === 'ready' && state.nCellsUsed < rec.nCells ? ` ${state.nCellsUsed.toLocaleString('en-US')} of them have data for this variable.` : '';
  const sub = sea
    ? `Average over the whole sea (${rec.nCells.toLocaleString('en-US')} grid cells of about ${cellKm(sea)} km, weighted by area).${dropped}`
    : rec.tiny
      ? `This country is smaller than one grid cell; values are for the single cell that covers it.${dropped}`
      : `Average over the whole country (${rec.nCells.toLocaleString('en-US')} grid cells of about 50 km, weighted by area).${dropped}`;

  const summary = useMemo(() => (p.trends ? summarize(p.trends.cells) : null), [p.trends]);
  const bare = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t === e.currentTarget || t.dataset.bare !== undefined) p.onClose();
  };

  const ready = state.status === 'ready' ? state : null;

  // The independent check for the whole area (referenceAreas.ts): lazy, one fetch per variable. A failed load shows nothing.
  const [areaRef, setAreaRef] = useState<{ variable: string; data: AreaRefData | null } | null>(null);
  useEffect(() => {
    let alive = true;
    if (!hasReference(meta.variable)) {
      setAreaRef({ variable: meta.variable, data: null });
      return;
    }
    loadAreaReference(meta.variable).then(
      (data) => alive && setAreaRef({ variable: meta.variable, data }),
      (err) => console.error(err),
    );
    return () => {
      alive = false;
    };
  }, [meta.variable]);
  const analysis = ready ? ready.analysis : null;
  const reference = useMemo<AreaCheck | null>(() => {
    if (!ready || !analysis || ready.data.variable !== meta.variable || !areaRef || areaRef.variable !== meta.variable || !hasReference(meta.variable)) return null;
    return areaCheck({
      variable: meta.variable,
      data: areaRef.data,
      kind: sea ? 'seas' : 'countries',
      key: String(rec.idx),
      fullPeriod: p.fullPeriod,
      verdictKind: analysis.kind,
      slope: analysis.slopeDecade,
      unitsLong: rateUnitsLong(analysis.units),
      series: { years: analysis.years, values: analysis.annual },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis, areaRef, meta.variable, sea, rec.idx, p.fullPeriod]);
  // window.__lastResult.reference / .quality.combined for countries and seas, as for points (plus the coverage).
  useEffect(() => {
    const lr = window.__lastResult;
    if (!lr || !analysis || !reference || lr.variable !== meta.variable || typeof lr.area.sizeDeg === 'number') return;
    lr.quality.combined = combineGrade(lr.quality.grade, reference.cls);
    lr.reference = {
      cls: reference.cls, short: reference.short, refSlope: reference.refSlope, refP: reference.refP, boxLat: null, boxLng: null, n: reference.n, k: reference.k, c: reference.c, records: reference.records,
      badYears: reference.badYears, slopeWithout: reference.slopeWithout, pWithout: reference.pWithout, coverage: reference.coverage,
    };
  }, [reference, analysis, meta.variable]);

  // Provinces: the map and its hooks use the file order; the list is sorted by trend.
  const provs = p.provinces && p.provinces.length ? p.provinces : null;
  const [hoverProv, setHoverProv] = useState<number | null>(null);
  const provRows = useMemo(() => (provs ? sortProvinces(provs.map((pv, index) => ({ pv, index, name: pv.name, slopeDecade: pv.slopeDecade }))) : []), [provs]);
  const provHeading = useMemo(() => (provs ? provinceHeading(provs.map((pv) => pv.type)) : ''), [provs]);
  const [allProvs, setAllProvs] = useState(false);
  const [howto, setHowto] = useState(false);

  const stops = useMemo(() => parseStops(meta.colormap_stops), [meta]);
  // The area's value in every year of the record (the same mean the statistics use), for the charts.
  const data = ready ? ready.data : null;
  const mean = useMemo(() => (data ? countryMeanSeries(data.cells, data.values).annual : null), [data]);
  const tiles = useCountryVariables(rec, p.metas, p.period);
  const areaRate = analysis ? analysis.slopeDecade : null;

  const provList = useMemo(() => {
    const row = ({ pv, index }: (typeof provRows)[number]): RateRow => {
      const m = cityMark(pv.slopeDecade, pv.p);
      return {
        key: `${pv.name}-${index}`,
        name: pv.name,
        slope: pv.slopeDecade,
        solid: m.kind === 'rising' || m.kind === 'falling',
        title: `${pv.name}: ${pv.slopeDecade === null ? 'no data' : `${signedRate(pv.slopeDecade)} ${units}/decade, ${m.label}`}`,
        active: hoverProv === index,
        onEnter: () => setHoverProv(index),
      };
    };
    const withData = provRows.filter((r) => r.pv.slopeDecade !== null);
    const short = !allProvs && withData.length > 2 * PROV_ENDS + 2;
    const shown = short ? [...withData.slice(0, PROV_ENDS), ...withData.slice(-PROV_ENDS)] : provRows;
    return {
      rows: shown.map(row),
      domain: provRows.map((r) => r.pv.slopeDecade),
      gap: short ? { after: PROV_ENDS - 1, label: `${provRows.length - 2 * PROV_ENDS} more` } : undefined,
      canToggle: withData.length > 2 * PROV_ENDS + 2,
    };
  }, [provRows, allProvs, hoverProv, units]);

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
          <div className="co-vars">
            <label htmlFor="co-var-select">Variable</label>
            <select id="co-var-select" className="co-var-select" value={p.variable} onChange={(e) => p.onVariable(e.target.value)}>
              {VARIABLE_GROUPS.map((g) => (
                <optgroup key={g.name} label={g.name}>
                  {g.variables.map((v) => (
                    <option key={v} value={v}>
                      {p.metas[v] ? p.metas[v].label : v}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </div>

        <div className="co-grid" data-bare>
          <section className="co-centre" data-bare aria-label={sea ? 'The sea' : 'The country'}>
            <h2 id="co-title" className="co-title">
              {rec.name}
            </h2>
            <p className="co-sub">{sub}</p>
            {sea && (meta.variable === 'T2M' || meta.variable === 'T2M_MAX') && (
              <p className="co-sub">This is the air temperature 2 m above the water, not the water temperature.</p>
            )}
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
            {ready && p.outlineError && <p className="panel-msg panel-error detail-msg">The {what} outline could not be loaded.</p>}
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
                sea={sea}
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
            {tiles && (
              <section className="co-card co-tiles" aria-label={`All variables for ${rec.name}`}>
                <h3 className="co-card-title">
                  All variables for {rec.name} <span className="co-card-sub">change per decade, {periodText(p.period)}</span>
                </h3>
                <div className="vt-grid">
                  {tiles.map((t) => {
                    const m = cityMark(t.slopeDecade, t.p);
                    const clear = m.kind === 'rising' || m.kind === 'falling';
                    return (
                      <button key={t.variable} className={`vt${t.variable === p.variable ? ' active' : ''}`} aria-pressed={t.variable === p.variable} onClick={() => p.onVariable(t.variable)} disabled={t.status === 'nodata'}>
                        <span className="vt-name">{t.label}</span>
                        <Sparkline values={t.annual} colour={clear ? '#ffd166' : '#7d8597'} />
                        <span className={`vt-rate${clear ? ' clear' : ''}`}>
                          {t.status === 'loading' ? '…' : t.status === 'nodata' || t.slopeDecade === null ? 'no data' : `${m.symbol} ${signedRate(t.slopeDecade)} ${rateUnits(t.units)}`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}
          </section>

          {ready && (
            <div className="co-col co-left" data-bare>
              {ready.analysis && mean ? (
                <>
                  <section className="co-card" aria-label={sea ? 'Whole sea' : 'Whole country'}>
                    <h3 className="co-card-title">{sea ? 'Whole sea' : 'Whole country'}</h3>
                    <SummaryCard a={ready.analysis} units={units} colour={rateColour(ready.analysis.slopeDecade, p.vmax, stops)} caveat={meta.caveat} reference={reference} />
                  </section>
                  <section className="co-card" aria-label="Trend chart">
                    <h3 className="co-card-title">
                      {meta.label}, each year <span className="co-card-sub">trend for {periodText(p.period)}</span>
                    </h3>
                    <SeriesChart a={ready.analysis} years={ready.data.years} values={mean} units={ready.analysis.units} colour={rateColour(ready.analysis.slopeDecade, p.vmax, stops)} />
                  </section>
                  <section className="co-card" aria-label="Decade averages">
                    <h3 className="co-card-title">Then and now, decade averages</h3>
                    <DecadeChart years={ready.data.years} values={mean} units={ready.analysis.units} />
                  </section>
                </>
              ) : (
                <section className="co-card" aria-label={sea ? 'Whole sea' : 'Whole country'}>
                  <h3 className="co-card-title">{sea ? 'Whole sea' : 'Whole country'}</h3>
                  <p className="panel-msg">
                    {surfaceMessage(meta.label, meta.surface, !!sea)
                      ? `No data: ${surfaceMessage(meta.label, meta.surface, !!sea)}`
                      : ready.nCellsUsed === 0
                      ? `No data: ${meta.label} has no values for this ${what}. Either it is not defined here (some variables exist only over land or only over the sea, and snow cover, soil moisture and evaporation have no values on ice sheets) or it is always zero here (no snow or ice ever).`
                      : `Not enough data: only ${ready.nYears} years have values for this ${what}${p.fullPeriod ? '' : ` in ${periodText(p.period)}`} (at least ${MIN_YEARS} are needed).`}
                  </p>
                </section>
              )}
            </div>
          )}

          {ready && (
            <div className="co-col co-right" data-bare>
              <section className="co-card" aria-label={sea ? 'Inside the sea' : 'Inside the country'}>
                <h3 className="co-card-title">
                  {sea ? 'Inside the sea' : 'Inside the country'} <span className="co-card-sub">grid cells by trend, {units}/decade</span>
                </h3>
                {summary && p.trends ? (
                  summary.nWithData > 0 ? (
                    <>
                      <TrendHistogram cells={p.trends.cells} alpha={ALPHA_CELL} vmax={p.vmax} stops={stops} units={units} />
                      <p className="co-stat" title={insideText(summary, units)}>
                        <strong>
                          {summary.nSignificant.toLocaleString('en-US')} of {summary.nCells.toLocaleString('en-US')}
                        </strong>{' '}
                        cells significant on their own
                        {summary.nSignificant < summary.nWithData ? ' (the rest are faded)' : ''}
                      </p>
                    </>
                  ) : (
                    <p className="detail-summary">{insideText(summary, units)}</p>
                  )
                ) : (
                  <p className="panel-msg detail-msg">Computing…</p>
                )}
              </section>
              {provs && (
                <section className="co-card co-provs" aria-label={provHeading}>
                  <div className="co-card-head">
                    <h3 className="co-card-title">
                      {provHeading} <span className="co-card-sub">{units}/decade</span>
                    </h3>
                    {provList.canToggle && (
                      <button className="co-link" aria-expanded={allProvs} onClick={() => setAllProvs(!allProvs)}>
                        {allProvs ? 'Show fewer' : `Show all ${provRows.length}`}
                      </button>
                    )}
                  </div>
                  <div className={allProvs ? 'rr-scroll' : undefined}>
                    <RateRows rows={provList.rows} mode="bar" vmax={p.vmax} stops={stops} reference={areaRate} onLeave={() => setHoverProv(null)} domain={provList.domain} gap={provList.gap} />
                  </div>
                </section>
              )}
              {p.trends && p.trends.cities.length > 0 && (
                <section className="co-card co-cities" aria-label={sea ? 'Cities on its shores' : 'Cities'}>
                  <h3 className="co-card-title">
                    {sea ? 'Cities on its shores' : 'Cities'} <span className="co-card-sub">{units}/decade, ~50 km cell</span>
                  </h3>
                  <RateRows
                    rows={p.trends.cities.map((c): RateRow => {
                      const m = cityMark(c.slopeDecade, c.p);
                      return {
                        key: String(c.id),
                        name: `${c.name}${c.capital ? ' ★' : ''}`,
                        slope: c.slopeDecade,
                        solid: m.kind === 'rising' || m.kind === 'falling',
                        title: `${c.name}${c.capital ? ' (capital)' : ''}: ${c.slopeDecade === null ? 'no data' : `${signedRate(c.slopeDecade)} ${units}/decade, ${m.label}`}`,
                        onClick: () => p.onSelectCity(c),
                      };
                    })}
                    mode="dot"
                    vmax={p.vmax}
                    stops={stops}
                    reference={areaRate}
                  />
                </section>
              )}
              {areaRate !== null && (provs || (p.trends && p.trends.cities.length > 0)) && (
                <p className="co-key">
                  <i className="rr-ref rr-ref-key" /> whole {what} {signedRate(areaRate)} · faded or hollow = not significant on its own
                </p>
              )}
            </div>
          )}
        </div>

        <button className="co-link co-howto-btn" aria-expanded={howto} onClick={() => setHowto(!howto)}>
          ⓘ How to read this view
        </button>
        {howto && (
          <>
        {sea ? (
          <p className="detail-howto co-howto">
            <strong>How to read this:</strong> the sea is shown on its own, with the land around it. The colours are blended smoothly between
            grid points about {cellKm(sea)} km apart, as on the globe, so detail finer than that is not real; they use the same colours as the main
            map. The headline numbers are the area-weighted average of the grid cells inside the sea, and a city&apos;s number is the average of the
            grid cell it sits in. Ocean pieces are drawn from cells of about 100 km, and a named sea leaves out the smaller named seas, gulfs and
            bays inside it.
          </p>
        ) : (
          <p className="detail-howto co-howto">
                <strong>How to read this:</strong> the country is shown alone, in its own shape. The colours are blended smoothly between
                grid points about 50 km apart, as on the globe, so detail finer than that is not real; they use the same colours as the main
                map. The headline numbers are the area-weighted average of the grid cells inside the country, and a province&apos;s or city&apos;s
                number is the average of the grid cell(s) it covers.
          </p>
        )}
          </>
        )}
      </div>
    </div>
  );
}
