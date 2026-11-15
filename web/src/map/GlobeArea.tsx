import { Component, type ReactNode } from 'react';
import FlatMap from './FlatMap';
import Globe, { type LatLng, type PointOfView } from './Globe';
import type { RegionBox } from '../point/region';
import type { Landmark } from './landmarks';

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

const webgl = typeof document !== 'undefined' ? hasWebGL() : false;

export default function GlobeArea({ forceFlat, textureUrl, initialView, onPick, landmarks, marker, box, countryOutline, flyRef, wind, mapLines }: Props) {
  const flat = <FlatMap textureUrl={textureUrl} onPick={onPick} marker={marker} box={box} mapLines={mapLines} />;
  if (forceFlat || !webgl) return flat;
  return (
    <Boundary fallback={flat}>
      <Globe
        textureUrl={textureUrl}
        initialView={initialView}
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
