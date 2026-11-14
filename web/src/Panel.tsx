import type { ReactNode } from 'react';
import Chart from './Chart';
import { signedRate, type Analysis, MIN_YEARS } from './analysis';
import { periodText, type Period } from './period';
import { formatLatLng, rateUnits } from './format';
import type { Cell } from './power';
import type { RegionBox } from './region';
import type { LatLng } from './Globe';
import { fmtPValue } from './stats/trend';
import { QualityBlock } from './QualityBadge';

interface PanelBase {
  /** Snapped grid cell of the click (marker position). */
  cell: Cell;
  /** Raw clicked position; the box is centred here. */
  center: LatLng;
  /** 0 = single grid cell, otherwise box side in degrees. */
  sizeDeg: number;
  box: RegionBox | null;
  /** Box only: grid cells in the response (some may have no data for this variable). */
  nTotal?: number;
}

export type PanelState =
  | (PanelBase & { status: 'loading' })
  | (PanelBase & { status: 'error'; message: string })
  | (PanelBase & { status: 'insufficient'; nYears: number; nCells: number })
  | (PanelBase & { status: 'ready'; analysis: Analysis; nCells: number });

/** "4 grid cells", or "4 of 9 grid cells have data" when some cells of the box have no data for the variable. */
export function cellsText(nCells: number, nTotal?: number): string {
  if (nTotal !== undefined && nTotal > nCells) return `${nCells} of ${nTotal} grid cells have data`;
  return `${nCells} grid cell${nCells === 1 ? '' : 's'}`;
}

export const AREA_OPTIONS: { size: number; label: string }[] = [
  { size: 0, label: 'Point (~50 km)' },
  { size: 2, label: '2° box (~200 km)' },
  { size: 5, label: '5° box (~500 km)' },
  { size: 10, label: '10° box (~1000 km)' },
];

/** Area control: Point, three box sizes, and Country. `sizeDeg` is ignored while `country` is active. */
export function AreaPicker({
  sizeDeg,
  country,
  onAreaChange,
  onCountry,
}: {
  sizeDeg: number;
  country: boolean;
  onAreaChange: (size: number) => void;
  onCountry: () => void;
}) {
  return (
    <div className="area-picker" role="group" aria-label="Area">
      <span className="area-label">Area</span>
      {AREA_OPTIONS.map((o) => {
        const active = !country && o.size === sizeDeg;
        return (
          <button
            key={o.size}
            className={`area-btn${active ? ' active' : ''}`}
            aria-pressed={active}
            onClick={() => onAreaChange(o.size)}
          >
            {o.label}
          </button>
        );
      })}
      <button className={`area-btn${country ? ' active' : ''}`} aria-pressed={country} onClick={onCountry}>
        Country
      </button>
    </div>
  );
}

interface PanelProps {
  state: PanelState;
  label: string;
  yearsText: string;
  onClose: () => void;
  sizeDeg: number;
  onAreaChange: (size: number) => void;
  onRetry: () => void;
  period: Period;
  /** True when the period is the whole data period (then no period line is shown). */
  fullPeriod: boolean;
  /** Close-up map section, shown under the verdict (or the not-enough-data message). */
  detail?: ReactNode;
  onCountryArea: () => void;
  /** The country the selected spot lies in (null: none / not known yet). */
  inCountry?: { name: string; onShow: () => void } | null;
  /** The variable's one-line caveat (meta.caveat), shown under the quality grade. */
  caveat?: string;
}

export default function Panel({
  state,
  label,
  yearsText,
  sizeDeg,
  onAreaChange,
  onClose,
  onRetry,
  period,
  fullPeriod,
  detail,
  onCountryArea,
  inCountry,
  caveat,
}: PanelProps) {
  const { cell } = state;
  return (
    <aside className="panel" aria-label="Trend details">
      <div className="panel-head">
        <div>
          <h2>{label}</h2>
          <p className="panel-cell">
            {sizeDeg > 0
              ? `Average over a ${sizeDeg}° × ${sizeDeg}° area${
                  'nCells' in state ? ` (${cellsText(state.nCells, state.nTotal)})` : ''
                } centred at ${formatLatLng(state.center)}`
              : `Grid cell centred at ${formatLatLng({ lat: cell.lat, lng: cell.lng })}`}
          </p>
        </div>
        <button className="panel-close" onClick={onClose} aria-label="Close panel">
          ×
        </button>
      </div>

      <AreaPicker sizeDeg={sizeDeg} country={false} onAreaChange={onAreaChange} onCountry={onCountryArea} />
      {inCountry && (
        <p className="in-country">
          This spot is in {inCountry.name}.{' '}
          <button className="retry in-country-btn" onClick={inCountry.onShow}>
            Show the whole country
          </button>
        </p>
      )}

      {state.status === 'loading' && (
        <p className="panel-msg">
          {sizeDeg > 0
            ? `Fetching ${yearsText} years of data for this area from NASA POWER…`
            : `Fetching ${yearsText} years of data from NASA POWER…`}
        </p>
      )}

      {state.status === 'error' && (
        <div className="panel-msg panel-error">
          <p>{state.message}</p>
          <button className="retry" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}

      {state.status === 'insufficient' && (
        <p className="panel-msg">
          {state.nYears === 0
            ? 'No data here: this variable has no values at this spot (it is only measured over land or only over the sea, or it is always zero here, like snow in a desert).'
            : `Not enough data: only ${state.nYears} years have values here${fullPeriod ? '' : ` in ${periodText(period)}`} (at least ${MIN_YEARS} are needed).`}
        </p>
      )}

      {state.status === 'ready' && <Result a={state.analysis} area={sizeDeg > 0} period={period} caveat={caveat} />}

      {detail}
    </aside>
  );
}

/** Period line, chart and its legend text. */
export function ResultChart({ a, period, country = false }: { a: Analysis; period: Period; country?: boolean }) {
  return (
    <>
      <p className="period-line">Trend for {periodText(period)}</p>
      <Chart data={a.chart} units={a.units} />
      <p className="chart-legend">
        {!country && (
          <>
            <span className="swatch swatch-monthly" /> Thin line: monthly values with the seasonal cycle removed.{' '}
          </>
        )}
        <span className="swatch swatch-annual" /> Bold line with dots: each year&apos;s average.{' '}
        <span className="swatch swatch-trend" /> Dashed line: the trend{a.chart.shade ? ' over the selected period (shaded)' : ''}.
      </p>
    </>
  );
}

/** The rate, p-value and 95% range tiles, and the verdict. */
export function ResultSummary({ a, area, country = false, caveat }: { a: Analysis; area: boolean; country?: boolean; caveat?: string }) {
  return (
    <>
      <div className="tiles">
        <div className="tile">
          <div className="tile-label">Rate</div>
          <div className="tile-value">{signedRate(a.slopeDecade)}</div>
          <div className="tile-sub">{rateUnits(a.units)} per decade</div>
        </div>
        <div className="tile">
          <div className="tile-label">p-value</div>
          <div className="tile-value">{fmtPValue(a.p)}</div>
          <div className="tile-sub">lower = less likely chance</div>
        </div>
        <div className="tile">
          <div className="tile-label">95% range</div>
          <div className="tile-value tile-range">
            {signedRate(a.ciLowDecade)} to {signedRate(a.ciHighDecade)}
          </div>
          <div className="tile-sub">{rateUnits(a.units)} per decade</div>
        </div>
      </div>
      {area && !country && <p className="area-note">Area average, weighted by grid-cell area.</p>}
      <div className={`verdict verdict-${a.kind}`}>{a.verdict}</div>
      <QualityBlock a={a} caveat={caveat} />
    </>
  );
}

export function Result({
  a,
  area,
  period,
  country = false,
  caveat,
}: {
  a: Analysis;
  area: boolean;
  period: Period;
  /** Country mean: there is no monthly line, and the area note is the country's own sub-line. */
  country?: boolean;
  caveat?: string;
}) {
  return (
    <>
      <ResultChart a={a} period={period} country={country} />
      <ResultSummary a={a} area={area} country={country} caveat={caveat} />
    </>
  );
}
