import type { VariableMeta } from './data';
import { displayUnits } from './format';
import { formatTick, gradientCss, significantText } from './legend';

export default function Legend({ meta }: { meta: VariableMeta }) {
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
    </div>
  );
}
