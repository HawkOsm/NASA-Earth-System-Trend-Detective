import { Component, type ReactNode } from 'react';
import FlatMap from './FlatMap';
import Globe, { type LatLng, type PointOfView } from './Globe';
import type { RegionBox } from '../point/region';
import type { Landmark } from './landmarks';

/**
 * True if this browser can make a WebGL context. Each call MAKES one (on a throwaway canvas), and a browser keeps only
 * about sixteen alive: calling this on every render made it drop the oldest, which is the globe's own. Call it once and
 * keep the answer: use HAS_WEBGL below.
 */
export function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl'));
  } catch {
    return false;
  }
}

class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.error('Globe failed, falling back to flat map', err);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

interface Props {
  forceFlat: boolean;
  textureUrl: string;
  initialView: PointOfView;
  /** See Globe.tsx: start with the whole globe in sight. */
  fitStart?: boolean;
  onPick: (pos: LatLng) => void;
  landmarks?: Landmark[];
  marker: LatLng | null;
  box?: RegionBox | null;
  /** Outline of the selected country (globe only; the flat map shows nothing for it). */
  countryOutline?: [number, number][][] | null;
  flyRef: { current: ((v: PointOfView) => void) | null };
  wind?: boolean;
  mapLines: boolean;
}

/** Whether WebGL is available, tested once when the page loads. */
export const HAS_WEBGL = typeof document !== 'undefined' ? hasWebGL() : false;
const webgl = HAS_WEBGL;

export default function GlobeArea({ forceFlat, textureUrl, initialView, fitStart, onPick, landmarks, marker, box, countryOutline, flyRef, wind, mapLines }: Props) {
  const flat = <FlatMap textureUrl={textureUrl} onPick={onPick} marker={marker} box={box} mapLines={mapLines} />;
  if (forceFlat || !webgl) return flat;
  return (
    <Boundary fallback={flat}>
      <Globe
        textureUrl={textureUrl}
        initialView={initialView}
        fitStart={fitStart}
        onPick={onPick}
        landmarks={landmarks}
        marker={marker}
        box={box}
        countryOutline={countryOutline}
        flyRef={flyRef}
        wind={wind}
        mapLines={mapLines}
      />
    </Boundary>
  );
}
