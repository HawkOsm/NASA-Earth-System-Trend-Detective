import type { VariableMeta } from './data';
import { displayUnits } from './format';
import { formatTick, gradientCss, significantText } from './legend';
import { periodText } from './period';

interface WindControl {
  on: boolean;
  onChange: (on: boolean) => void;
}

export default function Legend({
  meta,
  wind,
  mapLines,
  shown,
}: {
  meta: VariableMeta;
  /** The map actually displayed: its period, colour range and share of significant cells. */
  shown: { start: number; end: number; vmax: number; fracSignificant: number; recomputed: boolean };
  wind?: WindControl;
  mapLines?: WindControl;
}) {
  return (
    <div className="legend" aria-label="Legend">
      <div className="legend-title">Change per decade ({displayUnits(meta.units)}), {periodText([shown.start, shown.end])}</div>
      <div className="legend-bar" style={{ background: gradientCss(meta.colormap_stops) }} />
      <div className="legend-ticks">
        <span>{formatTick(-shown.vmax)}</span>
        <span>{formatTick(0)}</span>
        <span>{formatTick(shown.vmax)}</span>
      </div>
      <div className="legend-sig">
        <span className="legend-grey" /> Pale / grey: no statistically significant trend
      </div>
      <div className="legend-ctx">{significantText(shown.fracSignificant)}</div>
      {shown.recomputed && <div className="legend-ctx">Recomputed for this period at about 100 km detail.</div>}
      {mapLines && (
        <div className="legend-wind">
          <label className="legend-wind-toggle">
            <input type="checkbox" checked={mapLines.on} onChange={(e) => mapLines.onChange(e.target.checked)} /> Map
            lines &amp; labels
          </label>
        </div>
      )}
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
