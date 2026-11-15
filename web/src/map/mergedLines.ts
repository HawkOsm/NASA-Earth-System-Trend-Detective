/*
 * Map lines (coastlines, borders, graticule, selection outlines) drawn as one fat-line mesh per style instead of
 * one mesh per polyline: a handful of draw calls instead of several hundred. Same look as the globe's own path
 * layer (screen-space width in pixels, same colours and altitude). The meshes ignore raycasts, so a click on a
 * line falls through to the globe surface underneath.
 */
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { GlobeMethods } from 'react-globe.gl';
import { parseColor, segmentPositions, type LinePoint } from './lineGeometry';

export interface LineStyle {
  lines: LinePoint[][];
  color: string;
  /** Width in CSS pixels. */
  stroke: number;
  /** Altitude for points that do not give their own (fraction of the globe radius). */
  altitude: number;
}

export interface MergedLines {
  setResolution: (width: number, height: number) => void;
  dispose: () => void;
  /** Number of meshes (draw calls) added. */
  meshes: number;
}

export function createMergedLines(globe: GlobeMethods, styles: LineStyle[], width: number, height: number): MergedLines {
  const scene = globe.scene();
  const toXYZ = (lat: number, lng: number, alt: number) => globe.getCoords(lat, lng, alt);
  const made: { mesh: InstanceType<typeof LineSegments2>; geometry: InstanceType<typeof LineSegmentsGeometry>; material: InstanceType<typeof LineMaterial> }[] = [];

  for (const style of styles) {
    const positions = segmentPositions(style.lines, toXYZ, style.altitude);
    if (!positions.length) continue;
    const c = parseColor(style.color);
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(positions);
    const material = new LineMaterial({
      // CSS colours are sRGB; new THREE.Color(r, g, b) would read them as linear and draw them too light.
      color: new THREE.Color().setRGB(c.r, c.g, c.b, THREE.SRGBColorSpace),
      linewidth: style.stroke,
      transparent: c.opacity < 1,
      opacity: c.opacity,
    });
    material.resolution.set(width, height);
    const mesh = new LineSegments2(geometry, material);
    mesh.raycast = () => {};
    mesh.name = 'map-lines';
    scene.add(mesh);
    made.push({ mesh, geometry, material });
  }

  return {
    meshes: made.length,
    setResolution: (w, h) => {
      for (const m of made) m.material.resolution.set(w, h);
    },
    dispose: () => {
      for (const m of made) {
        scene.remove(m.mesh);
        m.geometry.dispose();
        m.material.dispose();
      }
      made.length = 0;
    },
  };
}
