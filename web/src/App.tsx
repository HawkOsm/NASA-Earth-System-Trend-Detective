import { useEffect, useMemo, useState } from 'react';
import Globe, { type LatLng, type PointOfView } from './Globe';
import { LANDMARKS } from './landmarks';
import { landmarksTextureUrl, loadMeta, trendTextureUrl, type VariableMeta } from './data';

const VARIABLE = 'T2M';
const DEFAULT_VIEW: PointOfView = { lat: 30, lng: 20, altitude: 2.2 };

function parseNum(v: string | null): number | undefined {
  if (v === null || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function formatLatLng({ lat, lng }: LatLng): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(2)}°${ns}, ${Math.abs(lng).toFixed(2)}°${ew}`;
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

  const handlePick = (pos: LatLng) => {
    setPick(pos);
    window.__lastPick = { lat: pos.lat, lng: pos.lng };
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
          exposeRef={debugLandmarks}
        />
        {pick && <div className="readout">Picked: {formatLatLng(pick)}</div>}
      </main>
      <footer className="footer">
        Data: NASA POWER / MERRA-2 (NASA Langley Research Center). Not affiliated with or endorsed by NASA.
      </footer>
    </div>
  );
}
