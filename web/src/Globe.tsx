import { useEffect, useMemo, useRef, useState } from 'react';
import GlobeGL, { type GlobeMethods } from 'react-globe.gl';
import type { Landmark } from './landmarks';
import { buildCoastlines } from './coastlines';
import { dataUrl } from './data';
import { createWindLayer } from './wind/WindLayer';
import { loadWindField, type WindField } from './wind/windField';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface PointOfView extends LatLng {
  altitude: number;
}

interface GlobeProps {
  textureUrl: string;
  initialView: PointOfView;
  onPick: (pos: LatLng) => void;
  /** When set, landmarks are drawn as cyan points + labels (debug alignment mode). */
  landmarks?: Landmark[];
  /** Selected grid-cell centre, drawn as a small white point. */
  marker?: LatLng | null;
  /** Filled with a camera-fly function once the globe is ready (null in flat mode). */
  flyRef?: { current: ((v: PointOfView) => void) | null };
  /** Draw the animated mean-wind streaks. */
  wind?: boolean;
}

let windPromise: Promise<WindField> | null = null;
function getWindField(): Promise<WindField> {
  if (!windPromise) {
    windPromise = loadWindField(dataUrl);
    windPromise.catch(() => {
      windPromise = null; // allow a retry next time
    });
  }
  return windPromise;
}

declare global {
  interface Window {
    __globe?: GlobeMethods;
    __lastPick?: LatLng;
  }
}

const CYAN = '#00ffff';
const WHITE = '#ffffff';
const COASTLINES = buildCoastlines();

interface PointDatum {
  lat: number;
  lng: number;
  color: string;
  radius: number;
}

export default function Globe({ textureUrl, initialView, onPick, landmarks, marker, flyRef, wind }: GlobeProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Track the container size (follows window resizes via flex layout).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  const points = useMemo<PointDatum[]>(() => {
    const list: PointDatum[] = (landmarks ?? []).map((l) => ({ lat: l.lat, lng: l.lng, color: CYAN, radius: 0.25 }));
    if (marker) list.push({ lat: marker.lat, lng: marker.lng, color: WHITE, radius: 0.45 });
    return list;
  }, [landmarks, marker]);

  const handleReady = () => {
    const g = globeRef.current;
    if (!g) return;
    g.pointOfView(initialView, 0);
    window.__globe = g;
    if (flyRef) flyRef.current = (v) => g.pointOfView(v, 1500);
    setReady(true);
  };

  // Wind streaks: created when wanted, fully disposed when switched off or on unmount.
  useEffect(() => {
    const g = globeRef.current;
    if (!wind || !ready || !g) return;
    let cancelled = false;
    let handle: { dispose: () => void } | null = null;
    getWindField()
      .then((field) => {
        if (cancelled) return;
        handle = createWindLayer(g, field);
      })
      .catch((err) => console.error('Wind layer unavailable', err));
    return () => {
      cancelled = true;
      handle?.dispose();
    };
  }, [wind, ready]);

  useEffect(
    () => () => {
      if (flyRef) flyRef.current = null;
    },
    [flyRef],
  );

  return (
    <div ref={wrapRef} style={{ position: 'absolute', inset: 0 }}>
      {size.width > 0 && size.height > 0 && (
        <GlobeGL
          ref={globeRef}
          width={size.width}
          height={size.height}
          globeImageUrl={textureUrl}
          backgroundColor="#05070d"
          showAtmosphere={true}
          onGlobeReady={handleReady}
          onGlobeClick={({ lat, lng }) => onPick({ lat, lng })}
          pointsData={points}
          pointLat="lat"
          pointLng="lng"
          pointColor={(d) => (d as PointDatum).color}
          pointRadius={(d) => (d as PointDatum).radius}
          pointAltitude={0.01}
          pointsMerge={false}
          onPointClick={(d) => onPick({ lat: (d as PointDatum).lat, lng: (d as PointDatum).lng })}
          pathsData={COASTLINES}
          pathPointLat={(p) => (p as [number, number])[1]}
          pathPointLng={(p) => (p as [number, number])[0]}
          pathPointAlt={0.002}
          pathColor={() => 'rgba(20,20,30,0.75)'}
          pathStroke={0.6}
          pathDashLength={1}
          pathDashGap={0}
          pathDashAnimateTime={0}
          pathTransitionDuration={0}
          onPathClick={(_path, _ev, { lat, lng }) => onPick({ lat, lng })}
          labelsData={landmarks ?? []}
          labelLat="lat"
          labelLng="lng"
          labelText="name"
          labelColor={() => CYAN}
          labelSize={1.2}
          labelDotRadius={0.3}
          labelAltitude={0.012}
        />
      )}
    </div>
  );
}
