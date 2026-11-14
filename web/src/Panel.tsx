import Chart from './Chart';
import { signedRate, type Analysis, MIN_YEARS } from './analysis';
import { formatLatLng } from './format';
import type { Cell } from './power';
import { fmtPValue } from './stats/trend';

export type PanelState =
  | { cell: Cell; status: 'loading' }
  | { cell: Cell; status: 'error'; message: string }
  | { cell: Cell; status: 'insufficient'; nYears: number }
  | { cell: Cell; status: 'ready'; analysis: Analysis };

interface PanelProps {
  state: PanelState;
  label: string;
  yearsText: string;
  onClose: () => void;
  onRetry: () => void;
}

export default function Panel({ state, label, yearsText, onClose, onRetry }: PanelProps) {
  const { cell } = state;
  return (
    <aside className="panel" aria-label="Trend details">
      <div className="panel-head">
        <div>
          <h2>{label}</h2>
          <p className="panel-cell">
            Grid cell centred at {formatLatLng({ lat: cell.lat, lng: cell.lng })}
          </p>
        </div>
        <button className="panel-close" onClick={onClose} aria-label="Close panel">
          ×
        </button>
      </div>

      {state.status === 'loading' && <p className="panel-msg">Fetching {yearsText} years of data from NASA POWER…</p>}

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
          Not enough data: only {state.nYears} years have values here (at least {MIN_YEARS} are needed).
        </p>
      )}

      {state.status === 'ready' && <Result a={state.analysis} />}
    </aside>
  );
}

function Result({ a }: { a: Analysis }) {
  return (
    <>
      <Chart data={a.chart} units={a.units} />
      <p className="chart-legend">
        <span className="swatch swatch-monthly" /> Thin line: monthly values with the seasonal cycle removed.{' '}
        <span className="swatch swatch-annual" /> Bold line with dots: each year&apos;s average.{' '}
        <span className="swatch swatch-trend" /> Dashed line: the overall trend.
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
      <div className={`verdict verdict-${a.kind}`}>{a.verdict}</div>
    </>
  );
}
