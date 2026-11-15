/*
 * Animated wind-flow particles drawn inside the react-globe.gl three.js scene.
 * Approach credit: cambecc/earth (MIT, https://github.com/cambecc/earth) for the idea of particles advected
 * through a gridded wind field with fading trails (as on earth.nullschool.net). Written from scratch, CPU based;
 * mapbox/webgl-wind (ISC) was read for the idea only. No third-party code is included.
 */
import * as THREE from 'three';
import type { GlobeMethods } from 'react-globe.gl';
import type { WindField } from './windField';

declare global {
  interface Window {
    __wind?: { active: boolean; particles: number; frames: number };
  }
}

const TRAIL = 22; // positions per particle (TRAIL-1 segments)
const ALTITUDE = 0.006;
const K = 0.02; // degrees of latitude per (m/s) per 60 fps frame
const MIN_SPEED = 0.3; // m/s; slower cells respawn the particle
const MIN_STEP_MS = 13; // same frame cap as the globe renderer (renderOnDemand.ts)
const MAX_FRAMES_STEP = 3;
const FADE = 12; // frames of fade in / out at birth and death

export function defaultParticleCount(): number {
  const small = typeof window !== 'undefined' && window.innerWidth < 700;
  const slow = typeof navigator !== 'undefined' && (navigator.hardwareConcurrency ?? 8) <= 4;
  return small || slow ? 2500 : 4500;
}

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export interface WindLayerHandle {
  dispose: () => void;
}

export function createWindLayer(globe: GlobeMethods, field: WindField, count = defaultParticleCount()): WindLayerHandle {
  const scene = globe.scene();
  const N = count;
  const segs = TRAIL - 1;
  const vertsPerParticle = segs * 2;

  const lat = new Float32Array(N);
  const lng = new Float32Array(N);
  const age = new Int32Array(N);
  const life = new Int32Array(N);
  const hist = new Float32Array(N * TRAIL * 3); // xyz, index 0 = head

  const positions = new Float32Array(N * vertsPerParticle * 3);
  const colors = new Float32Array(N * vertsPerParticle * 4);
  const geometry = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  const colAttr = new THREE.BufferAttribute(colors, 4);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  colAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', posAttr);
  geometry.setAttribute('color', colAttr);
  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthTest: true,
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(geometry, material);
  lines.frustumCulled = false; // buffers change every frame
  lines.renderOrder = 5;
  lines.raycast = () => {}; // never intercept clicks / hover
  lines.name = 'wind-flow';
  scene.add(lines);

  const respawn = (i: number, scatterAge: boolean) => {
    for (let tries = 0; tries < 8; tries++) {
      lat[i] = (Math.asin(2 * Math.random() - 1) * 180) / Math.PI;
      lng[i] = Math.random() * 360 - 180;
      const [u, v] = field.sample(lat[i], lng[i]);
      if (Math.hypot(u, v) >= MIN_SPEED) break;
    }
    life[i] = 60 + Math.floor(Math.random() * 61);
    age[i] = scatterAge ? Math.floor(Math.random() * life[i]) : 0;
    const p = globe.getCoords(lat[i], lng[i], ALTITUDE);
    const o = i * TRAIL * 3;
    for (let t = 0; t < TRAIL; t++) {
      hist[o + t * 3] = p.x;
      hist[o + t * 3 + 1] = p.y;
      hist[o + t * 3 + 2] = p.z;
    }
  };
  for (let i = 0; i < N; i++) respawn(i, true);

  const state = { active: true, particles: N, frames: 0 };
  window.__wind = state;

  let raf = 0;
  let last = 0;
  let disposed = false;

  const tick = (now: number) => {
    if (disposed) return;
    raf = requestAnimationFrame(tick);
    // Step the particles at most ~60 times a second; on a 240 Hz screen rAF fires 4x as often.
    if (last && now - last < MIN_STEP_MS) return;
    const dtFrames = last ? Math.min((now - last) / (1000 / 60), MAX_FRAMES_STEP) : 1;
    last = now;
    const step = K * dtFrames;

    for (let i = 0; i < N; i++) {
      const [u, v] = field.sample(lat[i], lng[i]);
      const speed = Math.hypot(u, v);
      age[i]++;
      if (age[i] >= life[i] || speed < MIN_SPEED) {
        respawn(i, false);
      } else {
        const [nlat, nlng] = field.advect(lat[i], lng[i], step);
        lat[i] = nlat;
        lng[i] = nlng;
        const o = i * TRAIL * 3;
        hist.copyWithin(o + 3, o, o + (TRAIL - 1) * 3);
        const p = globe.getCoords(nlat, nlng, ALTITUDE);
        hist[o] = p.x;
        hist[o + 1] = p.y;
        hist[o + 2] = p.z;
      }
      const fade = Math.min(1, age[i] / FADE, (life[i] - age[i]) / FADE);
      const base = Math.max(0, fade) * (0.35 + 0.65 * Math.min(speed / 8, 1));
      const o = i * TRAIL * 3;
      let vi = i * vertsPerParticle;
      for (let s = 0; s < segs; s++) {
        const a = o + s * 3;
        const b = a + 3;
        const pi = vi * 3;
        positions[pi] = hist[a];
        positions[pi + 1] = hist[a + 1];
        positions[pi + 2] = hist[a + 2];
        positions[pi + 3] = hist[b];
        positions[pi + 4] = hist[b + 1];
        positions[pi + 5] = hist[b + 2];
        const a0 = 0.9 * base * (1 - s / segs);
        const a1 = 0.9 * base * (1 - (s + 1) / segs);
        const ci = vi * 4;
        colors[ci] = colors[ci + 1] = colors[ci + 2] = 0.07;
        colors[ci + 3] = a0;
        colors[ci + 4] = colors[ci + 5] = colors[ci + 6] = 0.07;
        colors[ci + 7] = a1;
        vi += 2;
      }
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    state.frames++;
  };

  const onVisibility = () => {
    cancelAnimationFrame(raf);
    if (disposed) return;
    if (!document.hidden) {
      last = 0;
      raf = requestAnimationFrame(tick);
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  if (!document.hidden) raf = requestAnimationFrame(tick);

  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
      scene.remove(lines);
      geometry.dispose();
      material.dispose();
      state.active = false;
      state.particles = 0;
    },
  };
}
