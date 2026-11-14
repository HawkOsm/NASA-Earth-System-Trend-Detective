import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ALPHA_CELL,
  cellAlpha,
  cellRgb,
  parseStops,
  summarize,
  type DetailCell,
  type Ring,
} from './detail';
import {
  countryCellRect,
  countryWidthKm,
  cx,
  cy,
  fitCountryProjection,
  frameLng,
  hitCountryCell,
  labelOrder,
  niceKm,
  placeLabels,
  type CityRec,
} from './country';
import type { VariableMeta } from './data';
import { signedRate } from './analysis';
import { displayUnits, formatLatLng } from './format';
import { fmtPValue } from './stats/trend';

export interface CityTrend extends CityRec {
  slopeDecade: number | null;
  p: number | null;
}

interface Props {
  meta: VariableMeta;
  name: string;
  /** Outlines already normalised into one longitude frame. */
  polys: Ring[][];
  /** Longitude frame reference for a wrapping country (null: longitudes are used as they are). */
  wrapRef: number | null;
  cells: DetailCell[];
  cities: CityTrend[];
  vmax: number;
  tiny: boolean;
  onSelectCell: (lat: number, lng: number) => void;
  onSelectCity: (city: CityTrend) => void;
  /** Tallest the canvas may be, in CSS pixels (its width follows the container). */
  maxHeight?: number;
  /** Shown between the hover readout and the scale line (the colour legend). */
  children?: ReactNode;
}

type Hover = { kind: 'cell' | 'city'; index: number } | null;

const DEFAULT_MAX_HEIGHT = 420;

/** The "inside the country" sentence: how many cells are significant and the range of cell trends. */
export function insideText(summary: ReturnType<typeof summarize>, units: string): string {
  const head =
    summary.nWithData === 0
      ? 'No cell here has enough data in this period.'
      : `${summary.nSignificant} of ${summary.nCells} cells show a significant trend on their own (p < ${ALPHA_CELL}). Cell trends range from ${signedRate(summary.min as number)} to ${signedRate(summary.max as number)} ${units} per decade.`;
  const tail = summary.nWithData > 0 && summary.nWithData < summary.nCells ? ` (${summary.nCells - summary.nWithData} without enough data.)` : '';
  return head + tail;
}

function rate(slope: number | null, p: number | null, units: string): string {
  if (slope === null || p === null) return 'not enough data in this period';
  return `${signedRate(slope)} ${units} per decade (p ${p < 0.001 ? '< 0.001' : `= ${fmtPValue(p)}`})`;
}

export default function CountryMap({ meta, name, polys, wrapRef, cells, cities, vmax, tiny, onSelectCell, onSelectCity, maxHeight = DEFAULT_MAX_HEIGHT, children }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<Hover>(null);
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

  const stops = useMemo(() => parseStops(meta.colormap_stops), [meta]);
  const units = displayUnits(meta.units);
  const pr = useMemo(() => (width > 0 && polys.length ? fitCountryProjection(polys, width, maxHeight) : null), [polys, width, maxHeight]);
  const fcells = useMemo(() => cells.map((c) => ({ ...c, flng: wrapRef === null ? c.lng : frameLng(c.lng, wrapRef) })), [cells, wrapRef]);
  const fcities = useMemo(() => cities.map((c) => ({ ...c, flng: wrapRef === null ? c.lng : frameLng(c.lng, wrapRef) })), [cities, wrapRef]);

  const outline = useMemo(() => {
    if (!pr) return null;
    const path = new Path2D();
    for (const poly of polys) {
      for (const ring of poly) {
        ring.forEach(([lng, lat], k) => {
          const x = cx(pr, lng);
          const y = cy(pr, lat);
          if (k === 0) path.moveTo(x, y);
          else path.lineTo(x, y);
        });
        path.closePath();
      }
    }
    return path;
  }, [pr, polys]);

  const hitAt = (e: React.PointerEvent | React.MouseEvent): Hover => {
    const canvas = canvasRef.current;
    if (!canvas || !pr || !outline) return null;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let best = -1;
    let bestD = 8;
    fcities.forEach((c, k) => {
      const d = Math.hypot(cx(pr, c.flng) - x, cy(pr, c.lat) - y);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    });
    if (best >= 0) return { kind: 'city', index: best };
    const ctx = canvas.getContext('2d');
    if (!ctx || !ctx.isPointInPath(outline, x * (canvas.width / pr.width), y * (canvas.height / pr.height), 'evenodd')) return null;
    const k = hitCountryCell(pr, fcells.map((c) => ({ lat: c.lat, lng: c.flng })), x, y);
    return k >= 0 ? { kind: 'cell', index: k } : null;
  };

  // The cells are drawn once, unclipped, into an off-screen canvas and then masked by the outline in a single
  // composite. Filling thousands of rectangles under a complex clip path is extremely slow (tens of seconds
  // for a large country), and the hover redraw would repeat it.
  const layer = useMemo(() => {
    if (!pr || !outline) return null;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const off = document.createElement('canvas');
    off.width = Math.round(pr.width * dpr);
    off.height = Math.round(pr.height * dpr);
    const ctx = off.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#e9ecf1';
    ctx.fillRect(0, 0, pr.width, pr.height);
    fcells.forEach((c) => {
      const r = countryCellRect(pr, c.lat, c.flng);
      if (c.slopeDecade === null) {
        ctx.fillStyle = 'rgba(120,125,135,0.35)';
      } else {
        const [R, G, B] = cellRgb(c.slopeDecade, vmax, stops);
        ctx.fillStyle = `rgba(${R},${G},${B},${cellAlpha(c)})`;
      }
      ctx.fillRect(r.x, r.y, r.w, r.h);
      if (r.w > 6) {
        ctx.strokeStyle = 'rgba(15,20,35,0.35)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(r.x + 0.25, r.y + 0.25, r.w - 0.5, r.h - 0.5);
      }
    });
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = '#000';
    ctx.fill(outline, 'evenodd');
    return off;
  }, [pr, outline, fcells, vmax, stops]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pr || !outline) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(pr.width * dpr);
    canvas.height = Math.round(pr.height * dpr);
    canvas.style.width = `${pr.width}px`;
    canvas.style.height = `${pr.height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, pr.width, pr.height);

    // The piece: the pre-rendered cell layer (see `layer`), then the hover box, then the outline.
    ctx.save();
    if (layer) ctx.drawImage(layer, 0, 0, pr.width, pr.height);
    ctx.clip(outline, 'evenodd');
    if (hover?.kind === 'cell') {
      const c = fcells[hover.index];
      const r = countryCellRect(pr, c.lat, c.flng);
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    }
    ctx.restore();
    ctx.strokeStyle = '#141a2a';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke(outline);

    // Cities: dots, then labels for the capital and the largest few (a label that would collide is skipped).
    ctx.font = '11px system-ui, sans-serif';
    fcities.forEach((c, k) => {
      const x = cx(pr, c.flng);
      const y = cy(pr, c.lat);
      ctx.beginPath();
      ctx.arc(x, y, c.capital ? 4.5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = c.capital ? '#141a2a' : '#ffffff';
      ctx.fill();
      ctx.strokeStyle = c.capital ? '#ffffff' : '#141a2a';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      if (hover?.kind === 'city' && hover.index === k) {
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });
    const order = labelOrder(fcities, 7);
    const cands = order.map((c) => ({
      key: c.id,
      x: cx(pr, c.flng),
      y: cy(pr, c.lat),
      w: ctx.measureText(c.name).width,
      h: 12,
    }));
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.lineJoin = 'round';
    for (const l of placeLabels(cands, { width: pr.width, height: pr.height })) {
      const city = fcities.find((c) => c.id === l.key);
      if (!city) continue;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.strokeText(city.name, l.x, l.y + l.h / 2);
      ctx.fillStyle = '#141a2a';
      ctx.fillText(city.name, l.x, l.y + l.h / 2);
    }

    // Scale bar.
    const km = niceKm((pr.width * 0.4 * 111.32) / pr.scale);
    const barPx = (km / 111.32) * pr.scale;
    if (Number.isFinite(barPx) && barPx > 8) {
      const x0 = 8;
      const y0 = pr.height - 8;
      ctx.strokeStyle = '#c9cfdb';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x0, y0 - 4);
      ctx.lineTo(x0, y0);
      ctx.lineTo(x0 + barPx, y0);
      ctx.lineTo(x0 + barPx, y0 - 4);
      ctx.stroke();
      ctx.fillStyle = '#c9cfdb';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${km.toLocaleString('en-US')} km`, x0 + 2, y0 - 4);
    }
  }, [pr, outline, layer, fcells, fcities, vmax, stops, hover]);

  const onClick = (e: React.MouseEvent) => {
    const h = hitAt(e);
    if (!h) return;
    if (lastPointer.current === 'touch' && !(hover && hover.kind === h.kind && hover.index === h.index)) {
      setHover(h);
      return;
    }
    if (h.kind === 'city') onSelectCity(cities[h.index]);
    else onSelectCell(cells[h.index].lat, cells[h.index].lng);
  };

  let readout = 'Hover or tap a cell or city to see its trend; click one to select it.';
  if (hover?.kind === 'cell') {
    const c = cells[hover.index];
    readout = `${formatLatLng(c)}: ${rate(c.slopeDecade, c.p, units)}`;
  } else if (hover?.kind === 'city') {
    const c = cities[hover.index];
    readout = `${c.name}: ${rate(c.slopeDecade, c.p, units)}`;
  }

  return (
    <div className="detail-map country-map">
      <div ref={hostRef} className="detail-canvas-host">
        <canvas
          ref={canvasRef}
          className="detail-canvas country-canvas"
          role="img"
          aria-label={`${name} on its own, each grid cell coloured by its own trend, with its cities`}
          onPointerMove={(e) => {
            lastPointer.current = e.pointerType;
            if (e.pointerType !== 'touch') setHover(hitAt(e));
          }}
          onPointerDown={(e) => {
            lastPointer.current = e.pointerType;
          }}
          onPointerLeave={(e) => {
            if (e.pointerType !== 'touch') setHover(null);
          }}
          onClick={onClick}
        />
      </div>
      <p className="detail-readout" aria-live="polite">
        {readout}
      </p>
      {children}
      {pr && <p className="country-size">About {Math.round(countryWidthKm(pr)).toLocaleString('en-US')} km wide{tiny ? ' (smaller than one grid cell)' : ''}.</p>}
    </div>
  );
}
