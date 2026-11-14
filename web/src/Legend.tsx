import type { VariableMeta } from './data';
import { displayUnits } from './format';
import { formatTick, gradientCss, significantText } from './legend';

interface WindControl {
  on: boolean;
  onChange: (on: boolean) => void;
}

export default function Legend({ meta, wind }: { meta: VariableMeta; wind?: WindControl }) {
  return (
    <div className="legend" aria-label="Legend">
      <div className="legend-title">Change per decade ({displayUnits(meta.units)})</div>
      <div className="legend-bar" style={{ background: gradientCss(meta.colormap_stops) }} />
      <div className="legend-ticks">
        <span>{formatTick(-meta.vmax)}</span>
        <span>{formatTick(0)}</span>
        <span>{formatTick(meta.vmax)}</span>
      </div>
      <div className="legend-sig">
        <span className="legend-grey" /> Pale / grey: no statistically significant trend
      </div>
      <div className="legend-ctx">{significantText(meta.frac_significant)}</div>
      {wind && (
        <div className="legend-wind">
          <label className="legend-wind-toggle">
            <input type="checkbox" checked={wind.on} onChange={(e) => wind.onChange(e.target.checked)} /> Show wind
            flow
          </label>
          {wind.on && (
            <div className="legend-wind-note">
              Moving streaks: average wind, 1981–2025 (direction and speed). Colours: how wind speed is changing.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
