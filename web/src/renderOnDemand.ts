/*
 * globe.gl redraws the whole scene on every animation frame, forever: 240 full redraws a second on a 240 Hz
 * screen even when nothing moves. This wraps the renderer so a frame is drawn only when something can have
 * changed (camera moved, canvas resized, a prop changed, an animation is running), at most about 60 times a
 * second, with a slow heartbeat so asynchronously loaded textures still appear.
 */
import type { GlobeMethods } from 'react-globe.gl';

/** Minimum gap between drawn frames. 13 ms gives 60 fps on 60/120/240 Hz screens and 72 fps on 144 Hz. */
export const MIN_FRAME_MS = 13;
/** While idle, still draw one frame this often (picks up textures and fonts that finish loading later). */
export const HEARTBEAT_MS = 500;
/** How long a change keeps frames coming, so layer updates and loads that land a little later are drawn. */
export const INVALIDATE_MS = 1500;
// The drawing-buffer resolution is left at globe.gl's default (device ratio, capped at 2). Capping it lower was
// tried: the browser then rescales the canvas, which blurs the picture and washes out the thin map lines.

export interface RenderControl {
  /** Keep drawing for the next `ms` milliseconds. */
  invalidate: (ms?: number) => void;
  /** Keep drawing continuously (for animations) until the returned function is called. */
  hold: () => () => void;
  dispose: () => void;
}

declare global {
  interface Window {
    /** Frame counters, for testing. */
    __render?: {
      rendered: number;
      skipped: number;
      pixelRatio: number;
      holds: number;
      /** Why frames were drawn, by first matching reason. */
      why: Record<'hold' | 'changed' | 'resized' | 'camera' | 'heartbeat', number>;
    };
  }
}

export function renderOnDemand(globe: GlobeMethods): RenderControl {
  const renderer = globe.renderer();
  const camera = globe.camera() as unknown as {
    position: { x: number; y: number; z: number };
    quaternion: { x: number; y: number; z: number; w: number };
    zoom: number;
    projectionMatrix: { elements: ArrayLike<number> };
  };
  // globe.gl draws each frame through a post-processing composer whose first pass clears the canvas and then calls
  // renderer.render. The gate must sit on the composer: gating only renderer.render would let the clear through
  // and wipe the picture on every skipped frame.
  type Drawable = { render: (...args: unknown[]) => void };
  const composer = (globe.postProcessingComposer?.() ?? null) as Drawable | null;
  const target: Drawable = composer ?? (renderer as unknown as Drawable);
  const original = target.render;
  const snapshot = new Float64Array(8 + 16);
  const current = new Float64Array(8 + 16);
  let last = -Infinity;
  let dirtyUntil = 0;
  let holds = 0;
  let width = -1;
  let height = -1;
  const stats = {
    rendered: 0,
    skipped: 0,
    pixelRatio: renderer.getPixelRatio(),
    holds: 0,
    why: { hold: 0, changed: 0, resized: 0, camera: 0, heartbeat: 0 },
  };
  window.__render = stats;

  const readCamera = (out: Float64Array) => {
    const p = camera.position;
    const q = camera.quaternion;
    out[0] = p.x;
    out[1] = p.y;
    out[2] = p.z;
    out[3] = q.x;
    out[4] = q.y;
    out[5] = q.z;
    out[6] = q.w;
    out[7] = camera.zoom;
    const m = camera.projectionMatrix.elements;
    for (let i = 0; i < 16; i++) out[8 + i] = m[i];
  };
  const cameraMoved = () => {
    readCamera(current);
    for (let i = 0; i < current.length; i++) if (current[i] !== snapshot[i]) return true;
    return false;
  };

  target.render = function (this: unknown, ...args: unknown[]) {
    const now = performance.now();
    if (now - last < MIN_FRAME_MS) {
      stats.skipped++;
      return;
    }
    const canvas = renderer.domElement;
    const resized = canvas.width !== width || canvas.height !== height;
    const why =
      holds > 0
        ? 'hold'
        : now < dirtyUntil
          ? 'changed'
          : resized
            ? 'resized'
            : cameraMoved()
              ? 'camera'
              : now - last >= HEARTBEAT_MS
                ? 'heartbeat'
                : null;
    if (!why) {
      stats.skipped++;
      return;
    }
    stats.why[why]++;
    last = now;
    width = canvas.width;
    height = canvas.height;
    readCamera(snapshot);
    stats.rendered++;
    original.apply(target, args);
  };

  return {
    invalidate: (ms = INVALIDATE_MS) => {
      dirtyUntil = Math.max(dirtyUntil, performance.now() + ms);
    },
    hold: () => {
      holds++;
      stats.holds = holds;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds--;
        stats.holds = holds;
      };
    },
    dispose: () => {
      target.render = original;
      if (window.__render === stats) delete window.__render;
    },
  };
}
