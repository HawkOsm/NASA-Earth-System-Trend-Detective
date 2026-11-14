import { useEffect, useMemo, useRef, useState } from 'react';
import GlobeArea from './GlobeArea';
import type { LatLng, PointOfView } from './Globe';
import Picker from './Picker';
import Legend from './Legend';
import Demos from './Demos';
import HowToRead from './HowToRead';
import { DEMOS, VARIABLES } from './demos';
import { LANDMARKS } from './landmarks';
import Panel, { type PanelState } from './Panel';
import { analyze } from './analysis';
import { fetchPointSeries, snapToCell } from './power';
import { landmarksTextureUrl, loadMeta, trendTextureUrl, type VariableMeta } from './data';

const DEFAULT_VARIABLE = VARIABLES[0];

declare global {
  interface Window {
    __lastResult?: {
      variable: string;
      cell: { lat: number; lng: number; i: number; j: number };
      slopeDecade: number;
      ciLowDecade: number;
      ciHighDecade: number;
      p: number;
      verdict: string;
      nYears: number;
    };
    __pickAt?: (lat: number, lng: number) => void;
    __setVariable?: (name: string) => void;
    __runDemo?: (index: number) => void;
  }
}

const DEFAULT_VIEW: PointOfView = { lat: 30, lng: 20, altitude: 2.2 };

function parseNum(v: string | null): number | undefined {
  if (v === null || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export default function App() {
  const { debugLandmarks, initialView, forceFlat } = useMemo(() => {
    const q = new URLSearchParams(window.location.search);
    const view: PointOfView = {
      lat: parseNum(q.get('lat')) ?? DEFAULT_VIEW.lat,
      lng: parseNum(q.get('lng')) ?? DEFAULT_VIEW.lng,
      altitude: parseNum(q.get('alt')) ?? DEFAULT_VIEW.altitude,
    };
    return { debugLandmarks: q.get('debug') === 'landmarks', initialView: view, forceFlat: q.get('flat') === '1' };
  }, []);

  useEffect(() => {
    document.title = 'Trend Detective — Earth system trends 1981–2025';
  }, []);

  const [metas, setMetas] = useState<Record<string, VariableMeta>>({});
  const [variable, setVariableState] = useState<string>(DEFAULT_VARIABLE);
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const flyRef = useRef<((v: PointOfView) => void) | null>(null);
  const metasRef = useRef(metas);
  metasRef.current = metas;
  const variableRef = useRef<string>(DEFAULT_VARIABLE);
  const panelRef = useRef(panel);
  panelRef.current = panel;

  useEffect(() => {
    let alive = true;
    Promise.all(VARIABLES.map((v) => loadMeta(v)))
      .then((list) => {
        if (!alive) return;
        const rec: Record<string, VariableMeta> = {};
        list.forEach((m) => (rec[m.variable] = m));
        setMetas(rec);
      })
      .catch((err) => console.error(err));
    return () => {
      alive = false;
    };
  }, []);

  const load = (cell: ReturnType<typeof snapToCell>, v: string) => {
    const m = metasRef.current[v];
    if (!m) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPanel({ cell, status: 'loading' });
    fetchPointSeries(v, cell.lat, cell.lng, ctrl.signal, m.years)
      .then((series) => {
        if (ctrl.signal.aborted) return;
        const a = analyze(series);
        if (!a) {
          const nYears = series.annual.filter((x) => !Number.isNaN(x)).length;
          setPanel({ cell, status: 'insufficient', nYears });
          return;
        }
        window.__lastResult = {
          variable: v,
          cell,
          slopeDecade: a.slopeDecade,
          ciLowDecade: a.ciLowDecade,
          ciHighDecade: a.ciHighDecade,
          p: a.p,
          verdict: a.verdict,
          nYears: a.nYears,
        };
        setPanel({ cell, status: 'ready', analysis: a });
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        const message = err instanceof Error ? err.message : 'Something went wrong fetching data.';
        setPanel({ cell, status: 'error', message });
      });
  };

  const handlePick = (pos: LatLng) => {
    window.__lastPick = { lat: pos.lat, lng: pos.lng };
    const m = metasRef.current[variableRef.current];
    if (m) load(snapToCell(pos.lat, pos.lng, m.grid), variableRef.current);
  };

  /** Switch variable; if the panel is open, refetch the same cell for the new variable. */
  const selectVariable = (v: string, reload: boolean) => {
    if (!(VARIABLES as readonly string[]).includes(v)) return;
    variableRef.current = v;
    setVariableState(v);
    const p = panelRef.current;
    if (reload && p) load(p.cell, v);
  };

  const runDemo = (index: number) => {
    const d = DEMOS[index];
    if (!d) return;
    selectVariable(d.variable, false);
    flyRef.current?.({ lat: d.lat, lng: d.lng, altitude: 1.3 });
    handlePick({ lat: d.lat, lng: d.lng });
  };

  // Always-current handlers so the window hooks run exactly the UI code paths.
  const handlersRef = useRef({ handlePick, selectVariable, runDemo });
  handlersRef.current = { handlePick, selectVariable, runDemo };
  useEffect(() => {
    window.__pickAt = (lat, lng) => handlersRef.current.handlePick({ lat, lng });
    window.__setVariable = (name) => handlersRef.current.selectVariable(name, true);
    window.__runDemo = (i) => handlersRef.current.runDemo(i);
    return () => {
      delete window.__pickAt;
      delete window.__setVariable;
      delete window.__runDemo;
    };
  }, []);

  const closePanel = () => {
    abortRef.current?.abort();
    setPanel(null);
  };

  const meta = metas[variable] ?? null;
  const subtitle = meta
    ? `How has ${meta.label.toLowerCase()} changed, ${meta.years[0]}–${meta.years[1]}?`
    : '';

  const textureUrl = debugLandmarks ? landmarksTextureUrl(variable) : trendTextureUrl(variable);

  return (
    <div className="app">
      <header className="header">
        <h1>Trend Detective</h1>
        <p className="subtitle">{subtitle}</p>
        <button className="howto-btn" onClick={() => setShowHelp(true)}>
          How to read this
        </button>
      </header>
      <main className={`globe-wrap${panel ? ' has-panel' : ''}`}>
        <div className="globe-area">
          <GlobeArea
            forceFlat={forceFlat}
            textureUrl={textureUrl}
            initialView={initialView}
            onPick={handlePick}
            landmarks={debugLandmarks ? LANDMARKS : undefined}
            marker={panel ? { lat: panel.cell.lat, lng: panel.cell.lng } : null}
            flyRef={flyRef}
          />
          <div className="overlay-tl">
            <Picker metas={metas} value={variable} onChange={(v) => selectVariable(v, true)} />
            <Demos onRun={runDemo} />
          </div>
          {meta && <Legend meta={meta} />}
        </div>
        {panel && meta && (
          <Panel
            state={panel}
            label={meta.label}
            yearsText={String(meta.years[1] - meta.years[0] + 1)}
            onClose={closePanel}
            onRetry={() => load(panel.cell, variable)}
          />
        )}
      </main>
      <footer className="footer">
        Data: NASA POWER / MERRA-2 (NASA Langley Research Center). Not affiliated with or endorsed by NASA.
      </footer>
      {showHelp && <HowToRead onClose={() => setShowHelp(false)} />}
    </div>
  );
}
