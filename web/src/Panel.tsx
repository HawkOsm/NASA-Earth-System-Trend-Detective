import type { ReactNode } from 'react';
import Chart from './Chart';
import { signedRate, type Analysis, MIN_YEARS } from './analysis';
import { periodText, type Period } from './period';
import { formatLatLng } from './format';
import type { Cell } from './power';
import type { RegionBox } from './region';
import type { LatLng } from './Globe';
import { fmtPValue } from './stats/trend';

interface PanelBase {
  /** Snapped grid cell of the click (marker position). */
  cell: Cell;
  /** Raw clicked position; the box is centred here. */
  center: LatLng;
  /** 0 = single grid cell, otherwise box side in degrees. */
  sizeDeg: number;
  box: RegionBox | null;
}

export type PanelState =
  | (PanelBase & { status: 'loading' })
  | (PanelBase & { status: 'error'; message: string })
  | (PanelBase & { status: 'insufficient'; nYears: number; nCells: number })
  | (PanelBase & { status: 'ready'; analysis: Analysis; nCells: number });

export const AREA_OPTIONS: { size: number; label: string }[] = [
  { size: 0, label: 'Point (~50 km)' },
  { size: 2, label: '2° box (~200 km)' },
  { size: 5, label: '5° box (~500 km)' },
  { size: 10, label: '10° box (~1000 km)' },
];

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
                  'nCells' in state ? ` (${state.nCells} grid cell${state.nCells === 1 ? '' : 's'})` : ''
                } centred at ${formatLatLng(state.center)}`
              : `Grid cell centred at ${formatLatLng({ lat: cell.lat, lng: cell.lng })}`}
          </p>
        </div>
        <button className="panel-close" onClick={onClose} aria-label="Close panel">
          ×
        </button>
      </div>

      <div className="area-picker" role="group" aria-label="Area">
        <span className="area-label">Area</span>
        {AREA_OPTIONS.map((o) => (
          <button
            key={o.size}
            className={`area-btn${o.size === sizeDeg ? ' active' : ''}`}
            aria-pressed={o.size === sizeDeg}
            onClick={() => onAreaChange(o.size)}
          >
            {o.label}
          </button>
        ))}
      </div>

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
          Not enough data: only {state.nYears} years have values here
          {fullPeriod ? '' : ` in ${periodText(period)}`} (at least {MIN_YEARS} are needed).
        </p>
      )}

      {state.status === 'ready' && <Result a={state.analysis} area={sizeDeg > 0} period={period} />}

      {detail}
    </aside>
  );
}

function Result({ a, area, period }: { a: Analysis; area: boolean; period: Period }) {
  return (
    <>
      <p className="period-line">Trend for {periodText(period)}</p>
      <Chart data={a.chart} units={a.units} />
      <p className="chart-legend">
        <span className="swatch swatch-monthly" /> Thin line: monthly values with the seasonal cycle removed.{' '}
        <span className="swatch swatch-annual" /> Bold line with dots: each year&apos;s average.{' '}
        <span className="swatch swatch-trend" /> Dashed line: the trend{a.chart.shade ? ' over the selected period (shaded)' : ''}.
      </p>
      <div className="tiles">
        <div className="tile">
          <div className="tile-label">Rate</div>
          <div className="tile-value">{signedRate(a.slopeDecade)}</div>
          <div className="tile-sub">{a.units} per decade</div>
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
          <div className="tile-sub">{a.units} per decade</div>
        </div>
      </div>
      {area && <p className="area-note">Area average, weighted by grid-cell area.</p>}
      <div className={`verdict verdict-${a.kind}`}>{a.verdict}</div>
    </>
  );
}
