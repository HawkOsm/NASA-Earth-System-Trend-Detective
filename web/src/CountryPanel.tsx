import { signedRate, type Analysis, MIN_YEARS } from './analysis';
import CountryMap, { type CityTrend } from './CountryMap';
import { cityMark, type CountryRec, type CityRec } from './country';
import type { VariableMeta } from './data';
import type { DetailCell, Ring } from './detail';
import { displayUnits } from './format';
import { AreaPicker, Result } from './Panel';
import { periodText, type Period } from './period';

/** Everything loaded for the selected country and variable (static files, no API call). */
export interface CountryData {
  rec: CountryRec;
  variable: string;
  years: number[];
  cells: [number, number][];
  values: number[][];
  cities: CityRec[];
  cityValues: number[][];
}

export type CountryPanelState =
  | { status: 'water' }
  | { status: 'loading'; rec: CountryRec }
  | { status: 'error'; rec: CountryRec; message: string }
  | { status: 'ready'; data: CountryData; analysis: Analysis | null; nYears: number; nCellsUsed: number };

interface Props {
  state: CountryPanelState;
  meta: VariableMeta;
  label: string;
  period: Period;
  fullPeriod: boolean;
  sizeDeg: number;
  onAreaChange: (size: number) => void;
  onCountryArea: () => void;
  onClose: () => void;
  onRetry: () => void;
  /** Per-cell and per-city trends for the selected period; null while being computed. */
  trends: { cells: DetailCell[]; cities: CityTrend[] } | null;
  polys: Ring[][] | null;
  outlineError: boolean;
  wrapRef: number | null;
  vmax: number;
  onSelectCell: (lat: number, lng: number) => void;
  onSelectCity: (city: CityTrend) => void;
}

export default function CountryPanel(p: Props) {
  const { state, meta } = p;
  const units = displayUnits(meta.units);
  const rec = state.status === 'water' ? null : state.status === 'ready' ? state.data.rec : state.rec;

  let sub = '';
  if (rec) {
    sub = rec.tiny
      ? 'This country is smaller than one grid cell; values are for the single cell that covers it.'
      : `Average over the whole country (${rec.nCells.toLocaleString('en-US')} grid cells of about 50 km, weighted by area)`;
  }

  return (
    <aside className="panel country-panel" aria-label="Country trend details">
      <div className="panel-head">
        <div>
          <h2>{rec ? rec.name : p.label}</h2>
          {sub && <p className="panel-cell">{sub}</p>}
        </div>
        <button className="panel-close" onClick={p.onClose} aria-label="Close panel">
          ×
        </button>
      </div>

      <AreaPicker sizeDeg={p.sizeDeg} country={true} onAreaChange={p.onAreaChange} onCountry={p.onCountryArea} />

      {state.status === 'water' && <p className="panel-msg">No country here. Click on land to choose a country.</p>}
      {state.status === 'loading' && <p className="panel-msg">Loading {state.rec.name}…</p>}
      {state.status === 'error' && (
        <div className="panel-msg panel-error">
          <p>{state.message}</p>
          <button className="retry" onClick={p.onRetry}>
            Try again
          </button>
        </div>
      )}
      {state.status === 'ready' && state.analysis === null && (
        <p className="panel-msg">
          Not enough data: only {state.nYears} years have values for this country
          {p.fullPeriod ? '' : ` in ${periodText(p.period)}`} (at least {MIN_YEARS} are needed).
        </p>
      )}
      {state.status === 'ready' && (
        <section className="detail country-piece" aria-label="The piece">
          <h3 className="detail-title">The piece: {state.data.rec.name} on its own, cell by cell</h3>
          {!p.trends && <p className="panel-msg detail-msg">Computing…</p>}
          {p.trends && !p.polys && !p.outlineError && <p className="panel-msg detail-msg">Loading the outline…</p>}
          {p.outlineError && <p className="panel-msg panel-error detail-msg">The country outline could not be loaded.</p>}
          {p.trends && p.polys && (
            <CountryMap
              meta={meta}
              name={state.data.rec.name}
              polys={p.polys}
              wrapRef={p.wrapRef}
              cells={p.trends.cells}
              cities={p.trends.cities}
              vmax={p.vmax}
              tiny={state.data.rec.tiny}
              onSelectCell={p.onSelectCell}
              onSelectCity={p.onSelectCity}
            />
          )}
        </section>
      )}

      {state.status === 'ready' && state.analysis && (
        <Result a={state.analysis} area={true} period={p.period} country={true} />
      )}

      {state.status === 'ready' && p.trends && p.trends.cities.length > 0 && (
        <section className="detail city-list" aria-label="Cities">
          <h3 className="detail-title">Cities</h3>
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
                    <span className="city-rate">
                      {c.slopeDecade === null ? 'no data' : `${signedRate(c.slopeDecade)} ${units}/decade`}
                    </span>
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

      {state.status === 'ready' && (
        <p className="detail-howto">
          <strong>How to read this:</strong> the country is shown alone, in its own shape; each coloured patch is one
          ~50 km grid cell, coloured by its own trend with the same colours as the main map, so the colours follow the
          data&apos;s coarse grid rather than the border. The headline numbers are the area-weighted average of those
          cells, and a city is just the grid cell it sits in.
        </p>
      )}
    </aside>
  );
}
