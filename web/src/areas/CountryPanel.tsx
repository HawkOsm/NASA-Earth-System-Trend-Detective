import type { CountryRec, CityRec } from './country';
import type { Analysis } from '../point/analysis';
import { AreaPicker } from '../point/Panel';

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
  label: string;
  sizeDeg: number;
  onAreaChange: (size: number) => void;
  onCountryArea: () => void;
  onClose: () => void;
}

/**
 * The side panel while Area = Country and the click was on water. A picked country is shown in the full-screen
 * CountryOverlay instead.
 */
export default function CountryPanel(p: Props) {
  return (
    <aside className="panel country-panel" aria-label="Country trend details">
      <div className="panel-head">
        <div>
          <h2>{p.label}</h2>
        </div>
        <button className="panel-close" onClick={p.onClose} aria-label="Close panel">
          ×
        </button>
      </div>
      <AreaPicker sizeDeg={p.sizeDeg} country={true} onAreaChange={p.onAreaChange} onCountry={p.onCountryArea} />
      <p className="panel-msg">No country here. Click on land to choose a country.</p>
    </aside>
  );
}
