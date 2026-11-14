import { useEffect, useMemo, useRef, useState } from 'react';
import GlobeGL, { type GlobeMethods } from 'react-globe.gl';
import type { Landmark } from './landmarks';

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
  /** Expose the react-globe.gl ref as window.__globe (debug/testing). */
  exposeRef?: boolean;
}

declare global {
  interface Window {
    __globe?: GlobeMethods;
    __lastPick?: LatLng;
  }
}

const CYAN = '#00ffff';
const WHITE = '#ffffff';

interface PointDatum {
  lat: number;
  lng: number;
  color: string;
  radius: number;
}

export default function Globe({ textureUrl, initialView, onPick, landmarks, marker, exposeRef }: GlobeProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
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
    if (exposeRef) window.__globe = g;
  };

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
