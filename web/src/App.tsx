import { useEffect, useMemo, useRef, useState } from 'react';
import Globe, { type LatLng, type PointOfView } from './Globe';
import { LANDMARKS } from './landmarks';
import Panel, { type PanelState } from './Panel';
import { analyze } from './analysis';
import { formatLatLng } from './format';
import { fetchPointSeries, snapToCell } from './power';
import { landmarksTextureUrl, loadMeta, trendTextureUrl, type VariableMeta } from './data';

const VARIABLE = 'T2M';
declare global {
  interface Window {
    __lastResult?: {
      cell: { lat: number; lng: number; i: number; j: number };
      slopeDecade: number;
      ciLowDecade: number;
      ciHighDecade: number;
      p: number;
      verdict: string;
      nYears: number;
    };
    __pickAt?: (lat: number, lng: number) => void;
  }
}

const DEFAULT_VIEW: PointOfView = { lat: 30, lng: 20, altitude: 2.2 };

function parseNum(v: string | null): number | undefined {
  if (v === null || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export default function App() {
  const { debugLandmarks, initialView } = useMemo(() => {
    const q = new URLSearchParams(window.location.search);
    const view: PointOfView = {
      lat: parseNum(q.get('lat')) ?? DEFAULT_VIEW.lat,
      lng: parseNum(q.get('lng')) ?? DEFAULT_VIEW.lng,
      altitude: parseNum(q.get('alt')) ?? DEFAULT_VIEW.altitude,
    };
    return { debugLandmarks: q.get('debug') === 'landmarks', initialView: view };
  }, []);

  const [meta, setMeta] = useState<VariableMeta | null>(null);
  const [pick, setPick] = useState<LatLng | null>(null);

  useEffect(() => {
    let alive = true;
    loadMeta(VARIABLE)
      .then((m) => alive && setMeta(m))
      .catch((err) => console.error(err));
    return () => {
      alive = false;
    };
  }, []);

  const [panel, setPanel] = useState<PanelState | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const metaRef = useRef<VariableMeta | null>(null);
  metaRef.current = meta;

  const load = (cell: ReturnType<typeof snapToCell>) => {
    const m = metaRef.current;
    if (!m) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPanel({ cell, status: 'loading' });
    fetchPointSeries(VARIABLE, cell.lat, cell.lng, ctrl.signal, m.years)
      .then((series) => {
        if (ctrl.signal.aborted) return;
        const a = analyze(series);
        if (!a) {
          const nYears = series.annual.filter((v) => !Number.isNaN(v)).length;
          setPanel({ cell, status: 'insufficient', nYears });
          return;
        }
        window.__lastResult = {
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
    setPick(pos);
    window.__lastPick = { lat: pos.lat, lng: pos.lng };
    const m = metaRef.current;
    if (m) load(snapToCell(pos.lat, pos.lng, m.grid));
  };

  // Always-current handler so window.__pickAt runs exactly the globe-click code path.
  const handlePickRef = useRef(handlePick);
  handlePickRef.current = handlePick;
  useEffect(() => {
    window.__pickAt = (lat: number, lng: number) => handlePickRef.current({ lat, lng });
    return () => {
      delete window.__pickAt;
    };
  }, []);

  const closePanel = () => {
    abortRef.current?.abort();
    setPanel(null);
  };

  const subtitle = meta
    ? `How has ${meta.label.toLowerCase()} changed, ${meta.years[0]}–${meta.years[1]}?`
    : '';

  const textureUrl = debugLandmarks ? landmarksTextureUrl(VARIABLE) : trendTextureUrl(VARIABLE);

  return (
    <div className="app">
      <header className="header">
        <h1>Trend Detective</h1>
        <p className="subtitle">{subtitle}</p>
      </header>
      <main className="globe-wrap">
        <Globe
          textureUrl={textureUrl}
          initialView={initialView}
          onPick={handlePick}
          landmarks={debugLandmarks ? LANDMARKS : undefined}
          marker={panel ? { lat: panel.cell.lat, lng: panel.cell.lng } : null}
          exposeRef={debugLandmarks}
        />
        {pick && <div className="readout">Picked: {formatLatLng(pick)}</div>}
        {panel && meta && (
          <Panel
            state={panel}
            label={meta.label}
            yearsText={String(meta.years[1] - meta.years[0] + 1)}
            onClose={closePanel}
            onRetry={() => load(panel.cell)}
          />
        )}
      </main>
      <footer className="footer">
        Data: NASA POWER / MERRA-2 (NASA Langley Research Center). Not affiliated with or endorsed by NASA.
      </footer>
    </div>
  );
}
