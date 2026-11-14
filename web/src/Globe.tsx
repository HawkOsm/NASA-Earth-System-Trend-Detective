import { useEffect, useRef, useState } from 'react';
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

export default function Globe({ textureUrl, initialView, onPick, landmarks, exposeRef }: GlobeProps) {
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
          pointsData={landmarks ?? []}
          pointLat="lat"
          pointLng="lng"
          pointColor={() => CYAN}
          pointRadius={0.25}
          pointAltitude={0.01}
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
