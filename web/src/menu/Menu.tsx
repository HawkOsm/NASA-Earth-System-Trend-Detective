import { useEffect, useState, type ReactNode } from 'react';
import './menu.css';
import type { VariableMeta } from '../data/data';
import { VARIABLE_GROUPS } from '../data/demos';
import { CONFIRMED_DISABLED_TEXT } from '../map/confirmedMap';
import { WHOLE_GLOBE_BUTTON_BELOW } from '../point/detail';
import { rateUnits } from '../data/format';
import { formatTick, overlayBarCss } from '../map/legend';
import { allChangesLine, scaleChangedLine } from '../map/emptyMap';
import PeriodBar from './PeriodBar';
import { periodText, type Period } from './period';
import { MENU_STORAGE_KEY, SEGMENTS, defaultMenuState, parseMenuState, toggleSegment, type MenuState, type SegmentKey } from './menuState';

declare global {
  interface Window {
    __menu?: { open: boolean; segments: string[] };
  }
}

/** What a click on the globe does: lift the country or sea (default), or the Point / box sizes of the Area row. */
export const CLICK_OPTIONS: { key: 'lift' | number; label: string }[] = [
  { key: 'lift', label: 'Lift' },
  { key: 0, label: 'Point' },
  { key: 2, label: '2°' },
  { key: 5, label: '5°' },
  { key: 10, label: '10°' },
];

/** The pressed option of the Click row, from the app's state (lift mode wins over the box size). */
export function clickKey(lift: boolean, sizeDeg: number): 'lift' | number {
  return lift ? 'lift' : sizeDeg;
}

/** The group a variable belongs to (null if it is in none). */
export function groupOf(variable: string): (typeof VARIABLE_GROUPS)[number] | null {
  return VARIABLE_GROUPS.find((g) => (g.variables as readonly string[]).includes(variable)) ?? null;
}

/** What the share of significant cells is a share of: land-only and sea-only variables count only cells with data. */
export function shareOfText(surface: string | undefined): string {
  return surface && surface !== 'any' ? 'of the area with data' : 'of the globe';
}

const NARROW = '(max-width: 760px)';
const isNarrow = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(NARROW).matches;

export interface MenuProps {
  metas: Record<string, VariableMeta>;
  meta: VariableMeta | null;
  variable: string;
  onVariable: (v: string) => void;
  period: Period;
  fullYears: Period;
  onPeriodChange: (p: Period) => void;
  onPeriodCommit: () => void;
  onPeriodReset: () => void;
  /** 0..1 while the map is being recomputed, else null. */
  recomputing: number | null;
  mapFailed: boolean;
  /** The map actually displayed: its period, colour range and share of significant cells. */
  shown: { start: number; end: number; vmax: number; fracSignificant: number; recomputed: boolean; allChanges?: boolean };
  /** Wind streaks need the 3D globe; `available` is false on the flat map. */
  wind: { available: boolean; on: boolean; onChange: (on: boolean) => void };
  click: { lift: boolean; sizeDeg: number; onLift: () => void; onSize: (size: number) => void };
  mapLines: boolean;
  onMapLines: (on: boolean) => void;
  onWholeGlobe: () => void;
  onAbout: () => void;
  /** A side panel is open (the menu closes itself on a narrow screen so the two do not stack). */
  panelOpen: boolean;
  /** The country / sea overlay is open: the menu steps aside (it has its own controls). */
  overlayOpen: boolean;
  /** Slot for extra footer buttons next to "about" (the "Detective" button goes here). */
  footerExtra?: ReactNode;
  /** "Independent check (SHORT): ..." for temperature and rainfall at the full period (reference.ts summaryLine), else null. */
  referenceLine?: string | null;
  /** "GPM, 2001–2025: ..." for a variable with a satellite record (instrument.ts instrumentSummaryLine), else null. */
  instrumentLine?: string | null;
  /** The Show row ("All significant" / "Confirmed only", confirmedMap.ts): `enabled` per confirmedEnabled; `line` is the
   *  share sentence shown in the Scale row while `on`. */
  confirmed?: { enabled: boolean; on: boolean; onChange: (on: boolean) => void; line: string | null };
  /** Show the switches and every segment whatever the user chose (the guided tour points at controls inside them). */
  showAll?: boolean;
}

function Opt({
  pressed,
  onClick,
  disabled,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button type="button" className="menu-opt" aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

/** One sub-menu: its name is the button; a click drops its controls down under it, another click folds them away. */
function Seg({ id, label, open, onToggle, children }: { id: SegmentKey; label: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section className={`menu-seg menu-seg-${id}${open ? ' is-open' : ''}`} role="group" aria-label={label}>
      <button type="button" className="menu-seg-head" aria-expanded={open} aria-controls={`menu-seg-${id}`} onClick={onToggle}>
        {label} <span aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div id={`menu-seg-${id}`} className="menu-seg-body">
          {children}
        </div>
      )}
    </section>
  );
}

function loadState(): MenuState {
  try {
    return parseMenuState(window.localStorage.getItem(MENU_STORAGE_KEY), isNarrow());
  } catch {
    return defaultMenuState(isNarrow());
  }
}

/**
 * The menu: the sub-menus (Data, Period, Scale, Click, Layers) in a column down the left edge of the map (a row across
 * the top on a phone). Each is a dropdown: a click on its name drops its controls down under it, another click folds
 * them away, and several can be down at once. Nothing has a box: it floats over the map.
 */
export default function Menu(p: MenuProps) {
  const [state, setState] = useState<MenuState>(loadState);
  const [zoomedIn, setZoomedIn] = useState(false);
  const [dataInfo, setDataInfo] = useState(false);
  const [scaleInfo, setScaleInfo] = useState(false);
  const { meta, variable } = p;
  const group = groupOf(variable);
  const on: readonly SegmentKey[] = p.showAll ? SEGMENTS.map((s) => s.key) : state.on;
  const has = (k: SegmentKey) => on.includes(k);
  const toggle = (k: SegmentKey) => setState((s) => ({ on: toggleSegment(s.on, k) }));

  useEffect(() => {
    window.__menu = { open: state.on.length > 0, segments: [...state.on] };
    // Lets other pieces step aside while a sub-menu is down on a narrow screen (the start strip does).
    document.body.classList.toggle('menu-open', state.on.length > 0);
    try {
      window.localStorage.setItem(MENU_STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* private window: the choice lasts for this visit only */
    }
  }, [state]);
  useEffect(
    () => () => {
      delete window.__menu;
      document.body.classList.remove('menu-open');
    },
    [],
  );

  // On a narrow screen the side panel takes the lower half: fold the sub-menus away when it opens.
  useEffect(() => {
    if (p.panelOpen && isNarrow()) setState({ on: [] });
  }, [p.panelOpen]);

  // "Whole globe" is enabled only while the camera is close (the same rule the old button used).
  const layersOn = has('layers');
  useEffect(() => {
    if (!layersOn) return;
    const read = () => {
      const v = window.__view?.();
      setZoomedIn(!!v && v.altitude < WHOLE_GLOBE_BUTTON_BELOW);
    };
    read();
    const id = window.setInterval(read, 250);
    return () => window.clearInterval(id);
  }, [layersOn]);

  const chooseGroup = (name: string) => {
    const g = VARIABLE_GROUPS.find((x) => x.name === name);
    if (g && g !== group) p.onVariable(g.variables[0]);
  };

  const key = clickKey(p.click.lift, p.click.sizeDeg);
  const { shown } = p;
  const scaleChanged = meta ? scaleChangedLine(shown, meta.vmax, p.fullYears) : null;
  const scaleDetails = !!meta && (shown.recomputed || !!p.referenceLine || !!p.instrumentLine || !!meta.quality || (!!p.confirmed && !p.confirmed.enabled));

  return (
    <div className="menu-wrap">
      <div id="menu-panel" className="menu" role="region" aria-label="Menu">
        <Seg id="data" label="Data" open={has('data')} onToggle={() => toggle('data')}>
          <div className="menu-data-main">
            <strong>{meta ? meta.label : variable}</strong> <span className="menu-dim">change per decade</span>
            {meta && (
              <button type="button" className="menu-info" aria-expanded={dataInfo} aria-label="About this variable" title="About this variable" onClick={() => setDataInfo(!dataInfo)}>
                ⓘ
              </button>
            )}
          </div>
          {meta && dataInfo && (
            <div className="menu-more">
              <p className="menu-def">{meta.definition}</p>
              {meta.caveat && <p className="menu-def menu-caveat">{meta.caveat}</p>}
              <p className="menu-def">
                Source:{' '}
                <a className="menu-link" href="https://power.larc.nasa.gov/" target="_blank" rel="noopener noreferrer">
                  NASA POWER / MERRA-2
                </a>
              </p>
            </div>
          )}
          <div className="menu-opts" role="group" aria-label="Group">
            {VARIABLE_GROUPS.map((g) => (
              <Opt key={g.name} pressed={g === group} onClick={() => chooseGroup(g.name)}>
                {g.name}
              </Opt>
            ))}
          </div>
          <div className="menu-opts menu-vars" role="group" aria-label="Variable">
            {(group ? group.variables : []).map((v) => (
              <Opt key={v} pressed={v === variable} onClick={() => p.onVariable(v)}>
                {p.metas[v] ? p.metas[v].label : v}
              </Opt>
            ))}
          </div>
        </Seg>

        <Seg id="period" label="Period" open={has('period')} onToggle={() => toggle('period')}>
          {!p.overlayOpen && (
            <PeriodBar
              inline
              title={`${p.period[0]} – ${p.period[1]}`}
              period={p.period}
              full={p.fullYears}
              onChange={p.onPeriodChange}
              onCommit={p.onPeriodCommit}
              onReset={p.onPeriodReset}
              recomputing={p.recomputing}
              failed={p.mapFailed}
            />
          )}
        </Seg>

        {meta && (
          <Seg id="scale" label="Scale" open={has('scale')} onToggle={() => toggle('scale')}>
            <div className="menu-scale">
              <div className="legend-bar" style={{ background: overlayBarCss(meta.legend_stops, meta.render) }} />
              <div className="legend-ticks">
                <span>{formatTick(-shown.vmax)}</span>
                <span>{formatTick(0)}</span>
                <span>{formatTick(shown.vmax)}</span>
              </div>
              <div className="menu-note">
                {rateUnits(meta.units)} per decade, {periodText([shown.start, shown.end])}
                {scaleDetails && (
                  <button type="button" className="menu-info" aria-expanded={scaleInfo} aria-label="More about this map" title="More about this map" onClick={() => setScaleInfo(!scaleInfo)}>
                    ⓘ
                  </button>
                )}
              </div>
              <div className="menu-dim menu-note">
                <span
                  className="menu-plain"
                  aria-hidden="true"
                  style={{ background: `linear-gradient(to right, ${meta.render.land} 50%, ${meta.render.ocean} 50%)` }}
                />
                {p.confirmed?.on && p.confirmed.line
                  ? p.confirmed.line
                  : shown.allChanges
                  ? allChangesLine(shown, shareOfText(meta.surface))
                  : `Plain map = no significant trend · ${Math.round(shown.fracSignificant * 100)}% ${shareOfText(meta.surface)} shows one`}
              </div>
              {scaleChanged && <div className="menu-note menu-scale-changed">{scaleChanged}</div>}
              {scaleInfo && scaleDetails && (
                <div className="menu-more">
                  {shown.recomputed && <div className="menu-dim menu-note">Recomputed for this period at about 100 km detail.</div>}
                  {p.referenceLine && <div className="menu-dim menu-note menu-quality menu-reference">{p.referenceLine}</div>}
                  {p.instrumentLine && <div className="menu-dim menu-note menu-quality menu-instrument">{p.instrumentLine}</div>}
                  {meta.quality && !shown.recomputed && (
                    <div className="menu-dim menu-note menu-quality">
                      Pattern checks: {Math.round(meta.quality.robust * 100)}% robust · {Math.round(meta.quality.caution * 100)}% caution ·{' '}
                      {Math.round(meta.quality.doubtful * 100)}% doubtful
                    </div>
                  )}
                  {p.confirmed && !p.confirmed.enabled && <div className="menu-dim menu-note menu-show-off">{CONFIRMED_DISABLED_TEXT}</div>}
                </div>
              )}
            </div>
            {p.confirmed && p.confirmed.enabled && (
              <div className="menu-opts menu-show" role="group" aria-label="Show">
                <Opt pressed={!p.confirmed.on} onClick={() => p.confirmed?.onChange(false)}>
                  All significant
                </Opt>
                <Opt pressed={p.confirmed.on} onClick={() => p.confirmed?.onChange(true)}>
                  Confirmed only
                </Opt>
              </div>
            )}
          </Seg>
        )}

        <Seg id="click" label="Click" open={has('click')} onToggle={() => toggle('click')}>
          <div className="menu-dim menu-note">A click on the map opens</div>
          <div className="menu-opts" role="group" aria-label="Click">
            {CLICK_OPTIONS.map((o) => (
              <Opt key={String(o.key)} pressed={key === o.key} onClick={() => (o.key === 'lift' ? p.click.onLift() : p.click.onSize(o.key))}>
                {o.label}
              </Opt>
            ))}
          </div>
        </Seg>

        <Seg id="layers" label="Layers" open={has('layers')} onToggle={() => toggle('layers')}>
          <div className="menu-opts menu-animate" role="group" aria-label="Layers">
            <Opt pressed={p.wind.on} disabled={!p.wind.available} onClick={() => p.wind.onChange(!p.wind.on)}>
              Wind
            </Opt>
            <Opt pressed={p.mapLines} onClick={() => p.onMapLines(!p.mapLines)}>
              Borders &amp; labels
            </Opt>
            <Opt pressed={false} disabled={!zoomedIn} onClick={p.onWholeGlobe}>
              Whole globe
            </Opt>
          </div>
          {!p.wind.available && <div className="menu-dim menu-note">Wind needs the 3D globe</div>}
          {p.wind.available && p.wind.on && (
            <div className="menu-dim menu-note">
              Streaks: average wind, 1981–2025{variable === 'WS2M' ? '. Colours: how wind speed is changing.' : ', not a trend.'}
            </div>
          )}
        </Seg>
        <div className="menu-seg menu-extra" role="group" aria-label="More">
          <Opt pressed={false} onClick={p.onAbout}>
            about
          </Opt>
          {/* Slot: more buttons (e.g. "Detective") are passed in as `footerExtra`. */}
          {p.footerExtra}
        </div>
      </div>
    </div>
  );
}
