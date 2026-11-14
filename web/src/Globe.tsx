import { useEffect, useMemo, useRef, useState } from 'react';
import GlobeGL, { type GlobeMethods } from 'react-globe.gl';
import type { Landmark } from './landmarks';
import { buildBorders, buildCoastlines } from './coastlines';
import { buildGraticule, buildGraticuleLabels, type MapLabel } from './graticule';
import { PLACES } from './places';
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
  /** Graticule, graticule labels, country borders and place labels (coastlines always stay). */
  mapLines?: boolean;
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
    __mapLines?: { on: boolean; graticuleLines: number; borderLines: number; labels: number };
  }
}

const CYAN = '#00ffff';
const WHITE = '#ffffff';
const SLATE = 'rgba(15,20,35,0.85)';

interface PathDatum {
  coords: [number, number][];
  color: string;
  stroke: number;
}

interface LabelDatum extends MapLabel {
  color: string;
  size: number;
  dot: number;
}

const COAST_PATHS: PathDatum[] = buildCoastlines().map((coords) => ({
  coords,
  color: 'rgba(20,20,30,0.75)',
  stroke: 0.6,
}));
const BORDER_PATHS: PathDatum[] = buildBorders().map((coords) => ({
  coords,
  color: 'rgba(20,20,30,0.4)',
  stroke: 0.3,
}));
const GRATICULE_PATHS: PathDatum[] = buildGraticule().map((g) => ({
  coords: g.coords,
  color: g.strong ? 'rgba(20,25,40,0.6)' : 'rgba(20,25,40,0.35)',
  stroke: 0.35,
}));
const GRATICULE_LABELS: LabelDatum[] = buildGraticuleLabels().map((l) => ({ ...l, color: SLATE, size: 0.7, dot: 0 }));
const PLACE_LABELS: LabelDatum[] = PLACES.map((l) => ({ ...l, color: SLATE, size: 1.0, dot: 0 }));

interface PointDatum {
  lat: number;
  lng: number;
  color: string;
  radius: number;
}

export default function Globe({ textureUrl, initialView, onPick, landmarks, marker, flyRef, wind, mapLines = true }: GlobeProps) {
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

  const paths = useMemo<PathDatum[]>(
    () => (mapLines ? [...GRATICULE_PATHS, ...BORDER_PATHS, ...COAST_PATHS] : COAST_PATHS),
    [mapLines],
  );

  const labels = useMemo<LabelDatum[]>(() => {
    const debug: LabelDatum[] = (landmarks ?? []).map((l) => ({
      lat: l.lat,
      lng: l.lng,
      text: l.name,
      color: CYAN,
      size: 1.2,
      dot: 0.3,
    }));
    return mapLines ? [...GRATICULE_LABELS, ...PLACE_LABELS, ...debug] : debug;
  }, [landmarks, mapLines]);

  useEffect(() => {
    window.__mapLines = {
      on: mapLines,
      graticuleLines: mapLines ? GRATICULE_PATHS.length : 0,
      borderLines: mapLines ? BORDER_PATHS.length : 0,
      labels: mapLines ? GRATICULE_LABELS.length + PLACE_LABELS.length : 0,
    };
    return () => {
      delete window.__mapLines;
    };
  }, [mapLines]);

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

  // Lines and labels float slightly above the surface, so the coordinates react-globe.gl reports for a
  // click on them are a little off. Ask the globe for the surface point under the cursor instead.
  const surfaceAt = (ev: MouseEvent, fallback: { lat: number; lng: number }): LatLng => {
    const hit = globeRef.current?.toGlobeCoords(ev.offsetX, ev.offsetY);
    return hit ? { lat: hit.lat, lng: hit.lng } : { lat: fallback.lat, lng: fallback.lng };
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
          pathsData={paths}
          pathPoints={(d) => (d as PathDatum).coords}
          pathPointLat={(p) => (p as [number, number])[1]}
          pathPointLng={(p) => (p as [number, number])[0]}
          pathPointAlt={0.002}
          pathColor={(d: object) => (d as PathDatum).color}
          pathStroke={(d) => (d as PathDatum).stroke}
          pathDashLength={1}
          pathDashGap={0}
          pathDashAnimateTime={0}
          pathTransitionDuration={0}
          onPathClick={(_path, ev, c) => onPick(surfaceAt(ev, c))}
          labelsData={labels}
          labelLat="lat"
          labelLng="lng"
          labelText="text"
          labelColor={(d) => (d as LabelDatum).color}
          labelSize={(d) => (d as LabelDatum).size}
          labelDotRadius={(d) => (d as LabelDatum).dot}
          labelIncludeDot={(d: object) => (d as LabelDatum).dot > 0}
          labelAltitude={0.012}
          labelsTransitionDuration={0}
          onLabelClick={(_label, ev, c) => onPick(surfaceAt(ev, c))}
        />
      )}
    </div>
  );
}
