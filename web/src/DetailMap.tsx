import { useEffect, useMemo, useRef, useState } from 'react';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import {
  ALPHA_CELL,
  cellAlpha,
  cellRect,
  cellRgb,
  degreeTicks,
  hitCell,
  landInBox,
  latLabel,
  lngLabel,
  makeProjection,
  parseStops,
  projX,
  projY,
  summarize,
  toLandPolygons,
  type DetailCell,
  type LandPolygon,
} from './detail';
import type { RegionBox } from './region';
import type { VariableMeta } from './data';
import { signedRate } from './analysis';
import { formatLatLng, rateUnits } from './format';
import { fmtPValue } from './stats/trend';

let landPromise: Promise<LandPolygon[]> | null = null;
/** Natural Earth 50 m land, loaded on first use as its own chunk. */
export function loadLand(): Promise<LandPolygon[]> {
  if (!landPromise) {
    landPromise = import('world-atlas/land-50m.json')
      .then((mod) => {
        const topo = (mod.default ?? mod) as unknown as Topology;
        const fc = feature(topo, topo.objects.land as GeometryCollection);
        const polys: number[][][][] = [];
        for (const f of fc.features) {
          const g = f.geometry;
          if (g.type === 'Polygon') polys.push(g.coordinates);
          else if (g.type === 'MultiPolygon') polys.push(...g.coordinates);
        }
        return toLandPolygons(polys);
      })
      .catch((err) => {
        landPromise = null;
        throw err;
      });
  }
  return landPromise;
}

interface Props {
  meta: VariableMeta;
  box: RegionBox;
  cells: DetailCell[];
  vmax: number;
  /** Raw click position (marked on the map) and the snapped cell (Point selection; null for an area). */
  center: { lat: number; lng: number };
  selected: { lat: number; lng: number } | null;
  onSelectCell: (lat: number, lng: number) => void;
}

export default function DetailMap({ meta, box, cells, vmax, center, selected, onSelectCell }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [land, setLand] = useState<LandPolygon[] | null>(null);
  const [hover, setHover] = useState<number>(-1);
  const lastPointer = useRef<string>('mouse');

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const update = () => setWidth(Math.floor(el.clientWidth));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    loadLand()
      .then((l) => alive && setLand(l))
      .catch((err) => console.error('Close-up coastline unavailable', err));
    return () => {
      alive = false;
    };
  }, []);

  const stops = useMemo(() => parseStops(meta.colormap_stops), [meta]);
  const pr = useMemo(() => (width > 0 ? makeProjection(box, width) : null), [box, width]);
  const summary = useMemo(() => summarize(cells), [cells]);
  const units = rateUnits(meta.units);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pr) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(pr.width * dpr);
    canvas.height = Math.round(pr.height * dpr);
    canvas.style.width = `${pr.width}px`;
    canvas.style.height = `${pr.height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, pr.width, pr.height);

    // Base map: water, then land.
    ctx.fillStyle = meta.render.ocean;
    ctx.fillRect(0, 0, pr.width, pr.height);
    if (land) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, pr.width, pr.height);
      ctx.clip();
      ctx.fillStyle = meta.render.land;
      ctx.strokeStyle = 'rgba(20,20,30,0.75)';
      ctx.lineWidth = 1;
      ctx.lineJoin = 'round';
      for (const poly of landInBox(land, box)) {
        ctx.beginPath();
        for (const ring of poly.rings) {
          ring.forEach(([lng, lat], k) => {
            const x = projX(pr, lng);
            const y = projY(pr, lat);
            if (k === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.closePath();
        }
        ctx.fill('evenodd');
        ctx.stroke();
      }
      ctx.restore();
    }

    // Cells.
    cells.forEach((c) => {
      const r = cellRect(pr, c.lat, c.lng);
      if (c.slopeDecade === null) {
        ctx.fillStyle = 'rgba(120,125,135,0.35)';
        ctx.fillRect(r.x, r.y, r.w, r.h);
      } else {
        const [R, G, B] = cellRgb(c.slopeDecade, vmax, stops);
        ctx.fillStyle = `rgba(${R},${G},${B},${cellAlpha(c)})`;
        ctx.fillRect(r.x, r.y, r.w, r.h);
      }
      ctx.strokeStyle = 'rgba(15,20,35,0.45)';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(r.x + 0.25, r.y + 0.25, r.w - 0.5, r.h - 0.5);
    });

    // Selection: selected cell (Point) or the box outline (Area), and the click point.
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    if (selected) {
      const r = cellRect(pr, selected.lat, selected.lng);
      ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    } else {
      ctx.strokeRect(1, 1, pr.width - 2, pr.height - 2);
    }
    if (hover >= 0) {
      const r = cellRect(pr, cells[hover].lat, cells[hover].lng);
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x + 0.75, r.y + 0.75, r.w - 1.5, r.h - 1.5);
    }
    const cx = projX(pr, center.lng);
    const cy = projY(pr, center.lat);
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Degree labels: latitude on the left edge, longitude on the bottom edge.
    ctx.font = '11px system-ui, sans-serif';
    ctx.lineJoin = 'round';
    const label = (text: string, x: number, y: number) => {
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.strokeText(text, x, y);
      ctx.fillStyle = 'rgba(15,20,35,0.95)';
      ctx.fillText(text, x, y);
    };
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (const lat of degreeTicks(box.latMin, box.latMax)) {
      const y = projY(pr, lat);
      if (y > 8 && y < pr.height - 8) label(latLabel(lat), 5, y);
    }
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center';
    for (const lng of degreeTicks(box.lngMin, box.lngMax)) {
      const x = projX(pr, lng);
      if (x > 18 && x < pr.width - 18) label(lngLabel(lng), x, pr.height - 5);
    }
  }, [pr, land, cells, vmax, stops, meta, box, selected, center, hover]);

  const hitAt = (e: React.PointerEvent | React.MouseEvent): number => {
    const canvas = canvasRef.current;
    if (!canvas || !pr) return -1;
    const rect = canvas.getBoundingClientRect();
    return hitCell(pr, cells, e.clientX - rect.left, e.clientY - rect.top);
  };

  const onClick = (e: React.MouseEvent) => {
    const k = hitAt(e);
    if (k < 0) return;
    // Touch: the first tap shows the readout, tapping the same cell again selects it.
    if (lastPointer.current === 'touch' && hover !== k) {
      setHover(k);
      return;
    }
    onSelectCell(cells[k].lat, cells[k].lng);
  };

  const hc = hover >= 0 ? cells[hover] : null;
  let readout: string;
  if (!hc) readout = 'Hover or tap a cell to see its trend; click a cell to select it.';
  else if (hc.slopeDecade === null) readout = `${formatLatLng(hc)}: not enough data in this period`;
  else readout = `${formatLatLng(hc)}: ${signedRate(hc.slopeDecade)} ${units} per decade (p ${(hc.p as number) < 0.001 ? '< 0.001' : `= ${fmtPValue(hc.p as number)}`})`;

  return (
    <div className="detail-map">
      <div ref={hostRef} className="detail-canvas-host">
        <canvas
          ref={canvasRef}
          className="detail-canvas"
          role="img"
          aria-label="Close-up map of the trend in each grid cell around the selected spot"
          onPointerMove={(e) => {
            lastPointer.current = e.pointerType;
            if (e.pointerType !== 'touch') setHover(hitAt(e));
          }}
          onPointerDown={(e) => {
            lastPointer.current = e.pointerType;
          }}
          onPointerLeave={(e) => {
            if (e.pointerType !== 'touch') setHover(-1);
          }}
          onClick={onClick}
        />
      </div>
      <p className="detail-readout" aria-live="polite">
        {readout}
      </p>
      <p className="detail-summary">
        {summary.nWithData === 0
          ? 'No cell here has enough data in this period.'
          : `${summary.nSignificant} of ${summary.nCells} cells here show a significant trend on their own (p < ${ALPHA_CELL}). Cell trends range from ${signedRate(summary.min as number)} to ${signedRate(summary.max as number)} ${units} per decade.`}
        {summary.nWithData > 0 && summary.nWithData < summary.nCells
          ? ` (${summary.nCells - summary.nWithData} without enough data.)`
          : ''}
      </p>
      <p className="detail-note">Faded cells are not significant on their own.</p>
      <p className="detail-howto">
        <strong>How to read this:</strong> each small square is one ~50 km grid cell, coloured by its own trend with
        the same colours as the main map; a faded square is not significant by itself, and the main map uses a
        stricter rule across the whole globe. The white dot is the spot you clicked.
      </p>
    </div>
  );
}
