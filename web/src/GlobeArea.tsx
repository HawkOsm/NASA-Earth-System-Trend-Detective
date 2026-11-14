import { Component, type ReactNode } from 'react';
import FlatMap from './FlatMap';
import Globe, { type LatLng, type PointOfView } from './Globe';
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
  flyRef: { current: ((v: PointOfView) => void) | null };
}

const webgl = typeof document !== 'undefined' ? hasWebGL() : false;

export default function GlobeArea({ forceFlat, textureUrl, initialView, onPick, landmarks, marker, flyRef }: Props) {
  const flat = <FlatMap textureUrl={textureUrl} onPick={onPick} marker={marker} />;
  if (forceFlat || !webgl) return flat;
  return (
    <Boundary fallback={flat}>
      <Globe
        textureUrl={textureUrl}
        initialView={initialView}
        onPick={onPick}
        landmarks={landmarks}
        marker={marker}
        flyRef={flyRef}
      />
    </Boundary>
  );
}
