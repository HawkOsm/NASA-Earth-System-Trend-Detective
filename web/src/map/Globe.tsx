import { useEffect, useMemo, useRef, useState } from 'react';
import GlobeGL, { type GlobeMethods } from 'react-globe.gl';
import type { Landmark } from './landmarks';
import { buildBorders, buildCoastlines } from './coastlines';
import { buildGraticule, buildGraticuleLabels, type MapLabel } from './graticule';
import { boxOutline, type RegionBox } from '../point/region';
import { PLACES } from './places';
import { WHOLE_GLOBE_ALTITUDE, WHOLE_GLOBE_BUTTON_BELOW } from '../point/detail';
import { dataUrl } from '../data/data';
import { createWindLayer } from './wind/WindLayer';
import { loadWindField, type WindField } from './wind/windField';
import { renderOnDemand, type RenderControl } from './renderOnDemand';
import { createMergedLines, type LineStyle, type MergedLines } from './mergedLines';

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
  /** Selected analysis box, outlined in white. */
  box?: RegionBox | null;
  /** Outline of the selected country, as polylines (already split at the antimeridian). */
  countryOutline?: [number, number][][] | null;
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
    /** Current camera, for testing. Not set in flat mode. */
    __view?: () => { lat: number; lng: number; altitude: number };
    __lastPick?: LatLng;
    __mapLines?: { on: boolean; graticuleLines: number; borderLines: number; labels: number };
  }
}

const CYAN = '#00ffff';
const WHITE = '#ffffff';
const SLATE = 'rgba(15,20,35,0.85)';

interface LabelDatum extends MapLabel {
  color: string;
  size: number;
  dot: number;
}

// Map lines are drawn as one merged mesh per style (a few draw calls instead of one per polyline).
const LINE_ALT = 0.002;
const SELECTION_ALT = 0.004;
const COASTLINES = buildCoastlines();
const BORDERS = buildBorders();
const GRATICULE = buildGraticule();
const COAST_STYLE: LineStyle = { lines: COASTLINES, color: 'rgba(20,20,30,0.75)', stroke: 0.6, altitude: LINE_ALT };
const BORDER_STYLE: LineStyle = { lines: BORDERS, color: 'rgba(20,20,30,0.4)', stroke: 0.3, altitude: LINE_ALT };
const GRATICULE_STYLES: LineStyle[] = [
  { lines: GRATICULE.filter((g) => g.strong).map((g) => g.coords), color: 'rgba(20,25,40,0.6)', stroke: 0.35, altitude: LINE_ALT },
  { lines: GRATICULE.filter((g) => !g.strong).map((g) => g.coords), color: 'rgba(20,25,40,0.35)', stroke: 0.35, altitude: LINE_ALT },
];
const GRATICULE_LABELS: LabelDatum[] = buildGraticuleLabels().map((l) => ({ ...l, color: SLATE, size: 0.7, dot: 0 }));
const PLACE_LABELS: LabelDatum[] = PLACES.map((l) => ({ ...l, color: SLATE, size: 1.0, dot: 0 }));

/** Draws `styles` as merged line meshes; rebuilt only when the styles change, resized with the canvas. */
function useMergedLines(
  globeRef: { current: GlobeMethods | undefined },
  ready: boolean,
  styles: LineStyle[],
  size: { width: number; height: number },
  renderCtl: { current: RenderControl | null },
) {
  const handle = useRef<MergedLines | null>(null);
  const sizeRef = useRef(size);
  sizeRef.current = size;

  useEffect(() => {
    const g = globeRef.current;
    if (!ready || !g || !styles.length) return;
    const h = createMergedLines(g, styles, sizeRef.current.width, sizeRef.current.height);
    handle.current = h;
    renderCtl.current?.invalidate();
    return () => {
      h.dispose();
      handle.current = null;
      renderCtl.current?.invalidate();
    };
  }, [globeRef, ready, styles, renderCtl]);

  useEffect(() => {
    handle.current?.setResolution(size.width, size.height);
  }, [size.width, size.height]);
}

interface PointDatum {
  lat: number;
  lng: number;
  color: string;
  radius: number;
}

export default function Globe({ textureUrl, initialView, onPick, landmarks, marker, box, countryOutline, flyRef, wind, mapLines = true }: GlobeProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [zoomedIn, setZoomedIn] = useState(false);
  const renderCtl = useRef<RenderControl | null>(null);

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

  const baseLines = useMemo<LineStyle[]>(
    () => (mapLines ? [...GRATICULE_STYLES, BORDER_STYLE, COAST_STYLE] : [COAST_STYLE]),
    [mapLines],
  );

  const selectionLines = useMemo<LineStyle[]>(() => {
    const out: LineStyle[] = [];
    if (box) out.push({ lines: [boxOutline(box)], color: WHITE, stroke: 1.0, altitude: SELECTION_ALT });
    // The selected country: white, a little thicker than the coastlines; clicks on it still pick the surface point.
    if (countryOutline?.length) out.push({ lines: countryOutline, color: WHITE, stroke: 0.9, altitude: SELECTION_ALT });
    return out;
  }, [box, countryOutline]);

  useMergedLines(globeRef, ready, baseLines, size, renderCtl);
  useMergedLines(globeRef, ready, selectionLines, size, renderCtl);

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
      graticuleLines: mapLines ? GRATICULE.length : 0,
      borderLines: mapLines ? BORDERS.length : 0,
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
    // Draw only when something changed, at most ~60 fps (see renderOnDemand.ts).
    renderCtl.current?.dispose();
    renderCtl.current = renderOnDemand(g);
    window.__globe = g;
    if (flyRef) flyRef.current = (v) => g.pointOfView(v, 1200);
    window.__view = () => {
      const v = g.pointOfView();
      return { lat: v.lat, lng: v.lng, altitude: v.altitude };
    };
    setReady(true);
  };

  // Wind streaks: created when wanted, fully disposed when switched off or on unmount.
  useEffect(() => {
    const g = globeRef.current;
    if (!wind || !ready || !g) return;
    let cancelled = false;
    let handle: { dispose: () => void } | null = null;
    let release: (() => void) | null = null;
    getWindField()
      .then((field) => {
        if (cancelled) return;
        handle = createWindLayer(g, field);
        release = renderCtl.current?.hold() ?? null; // the streaks move every frame
      })
      .catch((err) => console.error('Wind layer unavailable', err));
    return () => {
      cancelled = true;
      handle?.dispose();
      release?.();
      renderCtl.current?.invalidate();
    };
  }, [wind, ready]);

  useEffect(
    () => () => {
      if (flyRef) flyRef.current = null;
      delete window.__view;
    },
    [flyRef],
  );

  // Any change to what the globe shows keeps frames coming briefly (layer updates and texture loads land later).
  useEffect(() => {
    renderCtl.current?.invalidate();
  }, [textureUrl, points, labels, size.width, size.height, ready]);

  useEffect(
    () => () => {
      renderCtl.current?.dispose();
      renderCtl.current = null;
    },
    [],
  );

  // Show the "Whole globe" button while the camera is closer than WHOLE_GLOBE_BUTTON_BELOW.
  useEffect(() => {
    if (!ready) return;
    const id = window.setInterval(() => {
      const alt = globeRef.current?.pointOfView().altitude;
      if (alt !== undefined) setZoomedIn(alt < WHOLE_GLOBE_BUTTON_BELOW);
    }, 200);
    return () => window.clearInterval(id);
  }, [ready]);

  const wholeGlobe = () => {
    const g = globeRef.current;
    if (!g) return;
    const v = g.pointOfView();
    g.pointOfView({ lat: v.lat, lng: v.lng, altitude: WHOLE_GLOBE_ALTITUDE }, 1200);
  };

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
      {zoomedIn && (
        <button className="whole-globe" onClick={wholeGlobe}>
          Whole globe
        </button>
      )}
    </div>
  );
}
