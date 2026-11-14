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
import { landmarksTextureUrl, loadMeta, type VariableMeta } from './data';
import PeriodBar from './PeriodBar';
import { useRangeMap } from './useRangeMap';
import { FULL_PERIOD, clampPeriod, isFullPeriod, periodText, type Period } from './period';

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
      period: [number, number];
    };
    __setArea?: (sizeDeg: number) => void;
    __pickAt?: (lat: number, lng: number) => void;
    __setVariable?: (name: string) => void;
    __runDemo?: (index: number) => void;
    __setPeriod?: (startYear: number, endYear: number) => void;
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
  const [period, setPeriodState] = useState<Period>(FULL_PERIOD);
  const [mapPeriod, setMapPeriod] = useState<Period>(FULL_PERIOD);
  const [windOn, setWindOn] = useState(() => !prefersReducedMotion());

  const abortRef = useRef<AbortController | null>(null);
  const flyRef = useRef<((v: PointOfView) => void) | null>(null);
  const metasRef = useRef(metas);
  metasRef.current = metas;
  const variableRef = useRef<string>(DEFAULT_VARIABLE);
  const sizeRef = useRef<number>(0);
  const panelRef = useRef(panel);
  panelRef.current = panel;
  const periodRef = useRef<Period>(FULL_PERIOD);
  const commitTimer = useRef<number | undefined>(undefined);
  /** The fetched series of the open panel, so a period change recomputes without a new request. */
  const fetchedRef = useRef<{
    base: Omit<Extract<PanelState, { status: 'loading' }>, 'status'>;
    series: PointSeries;
    cells: [number, number][];
    variable: string;
  } | null>(null);

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

  /** Statistics + panel + __lastResult for the given period, from an already-fetched series. */
  const showResult = (
    base: Omit<Extract<PanelState, { status: 'loading' }>, 'status'>,
    series: PointSeries,
    cells: [number, number][],
    v: string,
    per: Period,
  ) => {
    const a = analyze(series, per);
    if (!a) {
      const nYears = series.annual.filter((x, k) => !Number.isNaN(x) && series.years[k] >= per[0] && series.years[k] <= per[1]).length;
      setPanel({ ...base, status: 'insufficient', nYears, nCells: cells.length });
      return;
    }
    const { cell, box, sizeDeg: size } = base;
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
      annual: a.annual,
      years: a.years,
      period: [per[0], per[1]],
    };
    setPanel({ ...base, status: 'ready', analysis: a, nCells: cells.length });
  };

  const load = (center: LatLng, v: string, size: number) => {
    const m = metasRef.current[v];
    if (!m) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const cell = snapToCell(center.lat, center.lng, m.grid);
    const box: RegionBox | null = size > 0 ? regionBox(center.lat, center.lng, size) : null;
    const base = { cell, center: { lat: center.lat, lng: center.lng }, sizeDeg: size, box };
    fetchedRef.current = null;
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
        fetchedRef.current = { base, series, cells, variable: v };
        showResult(base, series, cells, v, periodRef.current);
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

  /** Live period change (sliders while dragging): numbers and side panel update at once, from the fetched series. */
  const changePeriod = (p: Period) => {
    if (p[0] === periodRef.current[0] && p[1] === periodRef.current[1]) return;
    periodRef.current = p;
    setPeriodState(p);
    const f = fetchedRef.current;
    if (f && panelRef.current && (panelRef.current.status === 'ready' || panelRef.current.status === 'insufficient')) {
      showResult(f.base, f.series, f.cells, f.variable, p);
    }
  };

  /** Slider released (or programmatic): recompute the map for the current period, debounced. */
  const commitPeriod = (immediate = false) => {
    window.clearTimeout(commitTimer.current);
    const go = () => setMapPeriod([periodRef.current[0], periodRef.current[1]]);
    if (immediate) go();
    else commitTimer.current = window.setTimeout(go, 150);
  };

  const setPeriod = (start: number, end: number) => {
    changePeriod(clampPeriod(start, end, 'both'));
    commitPeriod(true);
  };

  const resetPeriod = () => {
    changePeriod(FULL_PERIOD);
    commitPeriod(true);
  };

  const runDemo = (index: number) => {
    const d = DEMOS[index];
    if (!d) return;
    periodRef.current = FULL_PERIOD;
    setPeriodState(FULL_PERIOD);
    commitPeriod(true);
    fetchedRef.current = null;
    selectVariable(d.variable, false);
    sizeRef.current = 0;
    setSizeDegState(0);
    flyRef.current?.({ lat: d.lat, lng: d.lng, altitude: 1.3 });
    handlePick({ lat: d.lat, lng: d.lng });
  };

  // Always-current handlers so the window hooks run exactly the UI code paths.
  const handlersRef = useRef({ handlePick, selectVariable, runDemo, selectArea, setPeriod });
  handlersRef.current = { handlePick, selectVariable, runDemo, selectArea, setPeriod };
  useEffect(() => {
    window.__pickAt = (lat, lng) => handlersRef.current.handlePick({ lat, lng });
    window.__setVariable = (name) => handlersRef.current.selectVariable(name, true);
    window.__runDemo = (i) => handlersRef.current.runDemo(i);
    window.__setArea = (n) => handlersRef.current.selectArea(n);
    window.__setPeriod = (s, e) => handlersRef.current.setPeriod(s, e);
    return () => {
      delete window.__pickAt;
      delete window.__setVariable;
      delete window.__runDemo;
      delete window.__setArea;
      delete window.__setPeriod;
    };
  }, []);

  const closePanel = () => {
    abortRef.current?.abort();
    fetchedRef.current = null;
    setPanel(null);
  };

  const meta = metas[variable] ?? null;
  const fullYears: Period = meta ? [meta.years[0], meta.years[1]] : FULL_PERIOD;
  const subtitle = meta ? `How has ${meta.label.toLowerCase()} changed, ${periodText(period)}?` : '';
  const isFull = isFullPeriod(period, fullYears);
  const range = useRangeMap(variable, mapPeriod, meta);

  const windAvailable = variable === 'WS2M' && !forceFlat && hasWebGL();

  const textureUrl =
    debugLandmarks && !range.shown.recomputed ? landmarksTextureUrl(variable) : range.textureUrl;
  const recomputing = range.status === 'loading' || range.status === 'computing' ? range.progress : null;

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
              shown={range.shown}
            />
          )}
          {meta && (
            <PeriodBar
              period={period}
              full={fullYears}
              onChange={changePeriod}
              onCommit={() => commitPeriod()}
              onReset={resetPeriod}
              recomputing={recomputing}
              failed={range.status === 'error'}
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
            period={period}
            fullPeriod={isFull}
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
