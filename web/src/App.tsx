import { useEffect, useMemo, useRef, useState } from 'react';
import GlobeArea, { hasWebGL } from './GlobeArea';
import { prefersReducedMotion } from './wind/WindLayer';
import type { LatLng, PointOfView } from './Globe';
import Picker from './Picker';
import Legend from './Legend';
import Demos from './Demos';
import HowToRead from './HowToRead';
import { DEMOS, VARIABLES } from './demos';
import { LANDMARKS } from './landmarks';
import Panel, { type PanelState } from './Panel';
import { analyze } from './analysis';
import { fetchPointSeries, fetchRegionSeries, snapToCell, type PointSeries } from './power';
import { areaMeanSeries, regionBox, type RegionBox } from './region';
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
      area: {
        sizeDeg: number;
        latMin: number;
        latMax: number;
        lngMin: number;
        lngMax: number;
        nCells: number;
        cells: [number, number][];
      };
      annual: number[];
      years: number[];
    };
    __setArea?: (sizeDeg: number) => void;
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
  const [sizeDeg, setSizeDegState] = useState<number>(0);
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [mapLines, setMapLines] = useState(true);
  const [windOn, setWindOn] = useState(() => !prefersReducedMotion());

  const abortRef = useRef<AbortController | null>(null);
  const flyRef = useRef<((v: PointOfView) => void) | null>(null);
  const metasRef = useRef(metas);
  metasRef.current = metas;
  const variableRef = useRef<string>(DEFAULT_VARIABLE);
  const sizeRef = useRef<number>(0);
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

  const load = (center: LatLng, v: string, size: number) => {
    const m = metasRef.current[v];
    if (!m) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const cell = snapToCell(center.lat, center.lng, m.grid);
    const box: RegionBox | null = size > 0 ? regionBox(center.lat, center.lng, size) : null;
    const base = { cell, center: { lat: center.lat, lng: center.lng }, sizeDeg: size, box };
    setPanel({ ...base, status: 'loading' });
    const request: Promise<{ series: PointSeries; cells: [number, number][] }> = box
      ? fetchRegionSeries(v, box, ctrl.signal, m.years).then((data) => {
          const mean = areaMeanSeries(data);
          return { series: mean.series, cells: mean.cells.map((c): [number, number] => [c.lat, c.lng]) };
        })
      : fetchPointSeries(v, cell.lat, cell.lng, ctrl.signal, m.years).then((series) => ({
          series,
          cells: [[cell.lat, cell.lng]] as [number, number][],
        }));
    request
      .then(({ series, cells }) => {
        if (ctrl.signal.aborted) return;
        const a = analyze(series);
        if (!a) {
          const nYears = series.annual.filter((x) => !Number.isNaN(x)).length;
          setPanel({ ...base, status: 'insufficient', nYears, nCells: cells.length });
          return;
        }
        const years: number[] = [];
        const annual: number[] = [];
        series.years.forEach((yr, k) => {
          if (!Number.isNaN(series.annual[k])) {
            years.push(yr);
            annual.push(series.annual[k]);
          }
        });
        window.__lastResult = {
          variable: v,
          cell,
          slopeDecade: a.slopeDecade,
          ciLowDecade: a.ciLowDecade,
          ciHighDecade: a.ciHighDecade,
          p: a.p,
          verdict: a.verdict,
          nYears: a.nYears,
          area: {
            sizeDeg: size,
            latMin: box ? box.latMin : cell.lat,
            latMax: box ? box.latMax : cell.lat,
            lngMin: box ? box.lngMin : cell.lng,
            lngMax: box ? box.lngMax : cell.lng,
            nCells: cells.length,
            cells,
          },
          annual,
          years,
        };
        setPanel({ ...base, status: 'ready', analysis: a, nCells: cells.length });
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        const message = err instanceof Error ? err.message : 'Something went wrong fetching data.';
        setPanel({ ...base, status: 'error', message });
      });
  };

  const handlePick = (pos: LatLng) => {
    window.__lastPick = { lat: pos.lat, lng: pos.lng };
    load(pos, variableRef.current, sizeRef.current);
  };

  /** Change the area size (0 = single grid cell); if the panel is open, re-run for the same centre. */
  const selectArea = (size: number) => {
    if (![0, 2, 5, 10].includes(size)) return;
    sizeRef.current = size;
    setSizeDegState(size);
    const p = panelRef.current;
    if (p) load(p.center, variableRef.current, size);
  };

  /** Switch variable; if the panel is open, refetch the same cell for the new variable. */
  const selectVariable = (v: string, reload: boolean) => {
    if (!(VARIABLES as readonly string[]).includes(v)) return;
    variableRef.current = v;
    setVariableState(v);
    const p = panelRef.current;
    if (reload && p) load(p.center, v, sizeRef.current);
  };

  const runDemo = (index: number) => {
    const d = DEMOS[index];
    if (!d) return;
    selectVariable(d.variable, false);
    sizeRef.current = 0;
    setSizeDegState(0);
    flyRef.current?.({ lat: d.lat, lng: d.lng, altitude: 1.3 });
    handlePick({ lat: d.lat, lng: d.lng });
  };

  // Always-current handlers so the window hooks run exactly the UI code paths.
  const handlersRef = useRef({ handlePick, selectVariable, runDemo, selectArea });
  handlersRef.current = { handlePick, selectVariable, runDemo, selectArea };
  useEffect(() => {
    window.__pickAt = (lat, lng) => handlersRef.current.handlePick({ lat, lng });
    window.__setVariable = (name) => handlersRef.current.selectVariable(name, true);
    window.__runDemo = (i) => handlersRef.current.runDemo(i);
    window.__setArea = (n) => handlersRef.current.selectArea(n);
    return () => {
      delete window.__pickAt;
      delete window.__setVariable;
      delete window.__runDemo;
      delete window.__setArea;
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

  const windAvailable = variable === 'WS2M' && !forceFlat && hasWebGL();

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
            box={panel?.box ?? null}
            flyRef={flyRef}
            wind={windAvailable && windOn}
            mapLines={mapLines}
          />
          <div className="overlay-tl">
            <Picker metas={metas} value={variable} onChange={(v) => selectVariable(v, true)} />
            <Demos onRun={runDemo} />
          </div>
          {meta && (
            <Legend
              meta={meta}
              wind={windAvailable ? { on: windOn, onChange: setWindOn } : undefined}
              mapLines={{ on: mapLines, onChange: setMapLines }}
            />
          )}
        </div>
        {panel && meta && (
          <Panel
            state={panel}
            label={meta.label}
            yearsText={String(meta.years[1] - meta.years[0] + 1)}
            onClose={closePanel}
            sizeDeg={sizeDeg}
            onAreaChange={selectArea}
            onRetry={() => load(panel.center, variable, sizeDeg)}
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
