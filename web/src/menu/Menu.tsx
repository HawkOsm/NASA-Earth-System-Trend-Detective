import { useEffect, useState, type ReactNode } from 'react';
import './menu.css';
import type { VariableMeta } from '../data/data';
import { VARIABLE_GROUPS } from '../data/demos';
import { CONFIRMED_DISABLED_TEXT } from '../map/confirmedMap';
import { WHOLE_GLOBE_BUTTON_BELOW } from '../point/detail';
import { rateUnits } from '../data/format';
import { formatTick, overlayBarCss } from '../map/legend';
import PeriodBar from './PeriodBar';
import { periodText, type Period } from './period';

declare global {
  interface Window {
    __menu?: { open: boolean };
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
  shown: { start: number; end: number; vmax: number; fracSignificant: number; recomputed: boolean };
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
  /** The Show row ("All significant" / "Confirmed only", confirmedMap.ts): `enabled` per confirmedEnabled; `line` is the
   *  share sentence shown in the Scale row while `on`. */
  confirmed?: { enabled: boolean; on: boolean; onChange: (on: boolean) => void; line: string | null };
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

function Row({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`menu-row${className ? ` ${className}` : ''}`} role="group" aria-label={label}>
      <span className="menu-label" aria-hidden="true">
        {label}
      </span>
      <div className="menu-opts">{children}</div>
    </div>
  );
}

export default function Menu(p: MenuProps) {
  const [open, setOpen] = useState(() => !isNarrow());
  const [zoomedIn, setZoomedIn] = useState(false);
  const { meta, variable } = p;
  const group = groupOf(variable);
  const referenceLine = p.referenceLine;

  useEffect(() => {
    window.__menu = { open };
    // Lets other pieces step aside while the menu is open on a narrow screen (the start strip does).
    document.body.classList.toggle('menu-open', open);
  }, [open]);
  useEffect(
    () => () => {
      delete window.__menu;
      document.body.classList.remove('menu-open');
    },
    [],
  );

  // Escape closes the menu (unless a dialog is open: it takes Escape first).
  useEffect(() => {
    if (!open || p.overlayOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"]')) return;
      setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, p.overlayOpen]);

  // On a narrow screen the side panel takes the lower half: fold the menu away when it opens.
  useEffect(() => {
    if (p.panelOpen && isNarrow()) setOpen(false);
  }, [p.panelOpen]);

  // "Whole globe" is enabled only while the camera is close (the same rule the old button used).
  useEffect(() => {
    if (!open) return;
    const read = () => {
      const v = window.__view?.();
      setZoomedIn(!!v && v.altitude < WHOLE_GLOBE_BUTTON_BELOW);
    };
    read();
    const id = window.setInterval(read, 250);
    return () => window.clearInterval(id);
  }, [open]);

  const chooseGroup = (name: string) => {
    const g = VARIABLE_GROUPS.find((x) => x.name === name);
    if (g && g !== group) p.onVariable(g.variables[0]);
  };

  const key = clickKey(p.click.lift, p.click.sizeDeg);
  const { shown } = p;

  return (
    <div className={`menu-wrap${open ? ' is-open' : ''}`}>
      {open && (
        <div id="menu-panel" className="menu" role="region" aria-label="Menu">
          <Row label="Data" className="menu-data">
            <div className="menu-data-main">
              <strong>{meta ? meta.label : variable}</strong> <span className="menu-dim">change per decade</span>
            </div>
            {meta && <p className="menu-def">{meta.definition}</p>}
            {meta && meta.caveat && <p className="menu-def menu-caveat">{meta.caveat}</p>}
          </Row>

          <Row label="Period" className="menu-period">
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
          </Row>

          <Row label="Source">
            <a className="menu-link" href="https://power.larc.nasa.gov/" target="_blank" rel="noopener noreferrer">
              NASA POWER / MERRA-2
            </a>
          </Row>

          {meta && (
            <Row label="Scale" className="menu-scale">
              <div className="legend-bar" style={{ background: overlayBarCss(meta.legend_stops, meta.render) }} />
              <div className="legend-ticks">
                <span>{formatTick(-shown.vmax)}</span>
                <span>{formatTick(0)}</span>
                <span>{formatTick(shown.vmax)}</span>
              </div>
              <div className="menu-dim menu-note">
                Change per decade ({rateUnits(meta.units)}), {periodText([shown.start, shown.end])}
              </div>
              <div className="menu-dim menu-note">
                <span
                  className="menu-plain"
                  aria-hidden="true"
                  style={{ background: `linear-gradient(to right, ${meta.render.land} 50%, ${meta.render.ocean} 50%)` }}
                />
                {p.confirmed?.on && p.confirmed.line
                  ? p.confirmed.line
                  : `Plain map = no significant trend · ${Math.round(shown.fracSignificant * 100)}% ${shareOfText(meta.surface)} shows one`}
              </div>
              {shown.recomputed && <div className="menu-dim menu-note">Recomputed for this period at about 100 km detail.</div>}
              {referenceLine && (
                <div className="menu-dim menu-note menu-quality menu-reference">{referenceLine}</div>
              )}
              {meta.quality && !shown.recomputed && (
                <div className="menu-dim menu-note menu-quality">
                  Pattern checks: {Math.round(meta.quality.robust * 100)}% robust · {Math.round(meta.quality.caution * 100)}% caution ·{' '}
                  {Math.round(meta.quality.doubtful * 100)}% doubtful
                </div>
              )}
            </Row>
          )}

          {p.confirmed && (
            <Row label="Show" className="menu-show">
              {p.confirmed.enabled ? (
                <>
                  <Opt pressed={!p.confirmed.on} onClick={() => p.confirmed?.onChange(false)}>
                    All significant
                  </Opt>
                  <Opt pressed={p.confirmed.on} onClick={() => p.confirmed?.onChange(true)}>
                    Confirmed only
                  </Opt>
                </>
              ) : (
                <span className="menu-dim menu-note menu-show-off">{CONFIRMED_DISABLED_TEXT}</span>
              )}
            </Row>
          )}

          <Row label="Group">
            {VARIABLE_GROUPS.map((g) => (
              <Opt key={g.name} pressed={g === group} onClick={() => chooseGroup(g.name)}>
                {g.name}
              </Opt>
            ))}
          </Row>

          <Row label="Variable">
            {(group ? group.variables : []).map((v) => (
              <Opt key={v} pressed={v === variable} onClick={() => p.onVariable(v)}>
                {p.metas[v] ? p.metas[v].label : v}
              </Opt>
            ))}
          </Row>

          <Row label="Animate" className="menu-animate">
            <Opt pressed={p.wind.on} disabled={!p.wind.available} onClick={() => p.wind.onChange(!p.wind.on)}>
              Wind
            </Opt>
            {!p.wind.available && <span className="menu-dim menu-note">needs the 3D globe</span>}
            {p.wind.available && p.wind.on && (
              <div className="menu-dim menu-note menu-wide">
                Moving streaks: average wind, 1981–2025 (direction and speed)
                {variable === 'WS2M' ? '. Colours: how wind speed is changing.' : ', not a trend.'}
              </div>
            )}
          </Row>

          <Row label="Click">
            {CLICK_OPTIONS.map((o) => (
              <Opt
                key={String(o.key)}
                pressed={key === o.key}
                onClick={() => (o.key === 'lift' ? p.click.onLift() : p.click.onSize(o.key))}
              >
                {o.label}
              </Opt>
            ))}
          </Row>

          <Row label="Lines">
            <Opt pressed={p.mapLines} onClick={() => p.onMapLines(!p.mapLines)}>
              Borders &amp; labels
            </Opt>
          </Row>

          <Row label="View">
            <Opt pressed={false} disabled={!zoomedIn} onClick={p.onWholeGlobe}>
              Whole globe
            </Opt>
          </Row>

          <div className="menu-row menu-footer" role="group" aria-label="More">
            <span className="menu-label" aria-hidden="true" />
            <div className="menu-opts">
              <Opt pressed={false} onClick={p.onAbout}>
                about
              </Opt>
              {/* Slot: more footer buttons (e.g. "Detective") are passed in as `footerExtra`. */}
              {p.footerExtra}
            </div>
          </div>
        </div>
      )}
      <button
        type="button"
        className="menu-toggle"
        aria-expanded={open}
        aria-controls="menu-panel"
        onClick={() => setOpen((o) => !o)}
      >
        Menu <span aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
    </div>
  );
}
