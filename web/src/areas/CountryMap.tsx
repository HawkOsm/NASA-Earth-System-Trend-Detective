import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ALPHA_CELL,
  parseStops,
  summarize,
  type DetailCell,
  type LandPolygon,
  type Ring,
} from '../point/detail';
import { loadLand } from '../point/DetailMap';
import { landShifts, mixRgb, normaliseLand } from './sea';
import {
  countryCellRect,
  countryWidthKm,
  cx,
  cy,
  fitCountryProjection,
  frameLng,
  frameRing,
  hitCountryCell,
  labelOrder,
  leftOutText,
  mainPart,
  niceKm,
  placeLabels,
  type CityRec,
  type ProvinceTrend,
} from './country';
import type { VariableMeta } from '../data/data';
import { hexToRgb, overlayPixels } from '../map/rangeMap';

const DLAT = 0.5;
const DLNG = 0.625;
/** Land for the rim of a sea piece, unwrapped once (a lazy chunk, shared with the close-up map). */
let seaLand: Promise<LandPolygon[]> | null = null;
function loadSeaLand(): Promise<LandPolygon[]> {
  if (!seaLand) {
    seaLand = loadLand().then(normaliseLand).catch((err) => {
      seaLand = null;
      throw err;
    });
  }
  return seaLand;
}
/** Overlay weight of a cell that is not significant on its own (a significant cell is 1). */
const FADED_WEIGHT = 0.3;
import { signedRate } from '../point/analysis';
import { formatLatLng, rateUnits } from '../data/format';
import { fmtPValue } from '../stats/trend';

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
  /** Provinces / states with their own trend (null or empty: none are drawn). */
  provinces?: ProvinceTrend[] | null;
  /** Province highlighted from outside (hovering its row in the list), as an index into `provinces`. */
  highlightProvince?: number | null;
  /** Called with the province under the pointer (or null). */
  onHoverProvince?: (index: number | null) => void;
  /** A sea or ocean piece: its cell size; `polys` is then the frame rectangle and the land around it is drawn as the rim. */
  sea?: { dlat: number; dlng: number } | null;
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

export default function CountryMap({ meta, name, polys, wrapRef, cells, cities, vmax, tiny, onSelectCell, onSelectCity, provinces = null, highlightProvince = null, onHoverProvince, maxHeight = DEFAULT_MAX_HEIGHT, sea = null, children }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<Hover>(null);
  const [provHover, setProvHover] = useState<number | null>(null);
  const lastPointer = useRef<string>('mouse');
  const [land, setLand] = useState<LandPolygon[] | null>(null);
  const dlat = sea ? sea.dlat : DLAT;
  const dlng = sea ? sea.dlng : DLNG;

  useEffect(() => {
    if (!sea) return;
    let alive = true;
    loadSeaLand()
      .then((l) => alive && setLand(l))
      .catch((err) => console.error('Coastline unavailable', err));
    return () => {
      alive = false;
    };
  }, [!!sea]);

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
  const units = rateUnits(meta.units);
  // The view frames the country's main part (country.ts mainPart): far-away territories would shrink it to a speck.
  const main = useMemo(() => (sea ? { polys, left: 0 } : mainPart(polys)), [polys, sea]);
  const pr = useMemo(() => (width > 0 && main.polys.length ? fitCountryProjection(main.polys, width, maxHeight) : null), [main, width, maxHeight]);
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

  // Province borders: one path per province (rings moved into the country's longitude frame). A segment that lies on
  // the +-180 line is a cut in the source data, not a border, and is left out.
  const provPaths = useMemo(() => {
    if (!pr || !provinces || !provinces.length) return null;
    return provinces.map((pv) => {
      const path = new Path2D();
      const fill = new Path2D();
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const raw of pv.rings) {
        const ring = frameRing(raw, wrapRef);
        ring.forEach(([lng, lat], k) => {
          const x = cx(pr, lng);
          const y = cy(pr, lat);
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
          if (k === 0) {
            path.moveTo(x, y);
            fill.moveTo(x, y);
          } else {
            const [pl] = raw[k - 1];
            const cut = Math.abs(Math.abs(pl) - 180) < 0.002 && Math.abs(Math.abs(raw[k][0]) - 180) < 0.002;
            if (cut) path.moveTo(x, y);
            else path.lineTo(x, y);
            fill.lineTo(x, y);
          }
        });
        fill.closePath();
      }
      return { path, fill, box: [x0, y0, x1, y1] as [number, number, number, number] };
    });
  }, [pr, provinces, wrapRef]);

  const provAt = (e: React.PointerEvent | React.MouseEvent): number | null => {
    const canvas = canvasRef.current;
    if (!canvas || !pr || !provPaths) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const kx = canvas.width / pr.width;
    const ky = canvas.height / pr.height;
    for (let k = 0; k < provPaths.length; k++) {
      const b = provPaths[k].box;
      if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
      if (ctx.isPointInPath(provPaths[k].fill, x * kx, y * ky, 'evenodd')) return k;
    }
    return null;
  };

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
    const k = hitCountryCell(pr, fcells.map((c) => ({ lat: c.lat, lng: c.flng })), x, y, dlat / 2, dlng / 2);
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
    // Same look as the globe: the land colour underneath, the trend laid over it with the globe's overlay rule,
    // blended smoothly between grid points. One pixel per grid cell is coloured, then scaled up with smoothing.
    // A sea piece: the sea itself lies on the globe's ocean colour, the water around it is darkened and muted.
    const [lr, lg, lb] = hexToRgb(sea ? meta.render.ocean : meta.render.land);
    if (sea) {
      const [mr, mg, mb] = mixRgb([lr * 255, lg * 255, lb * 255], [34, 48, 72], 0.6);
      ctx.fillStyle = `rgb(${Math.round(mr)},${Math.round(mg)},${Math.round(mb)})`;
    } else {
      ctx.fillStyle = `rgb(${Math.round(lr * 255)},${Math.round(lg * 255)},${Math.round(lb * 255)})`;
    }
    ctx.fillRect(0, 0, pr.width, pr.height);
    if (fcells.length) {
      let latMin = Infinity, latMax = -Infinity, lngMin = Infinity, lngMax = -Infinity;
      for (const c of fcells) {
        latMin = Math.min(latMin, c.lat); latMax = Math.max(latMax, c.lat);
        lngMin = Math.min(lngMin, c.flng); lngMax = Math.max(lngMax, c.flng);
      }
      const nI = Math.round((latMax - latMin) / dlat) + 1;
      const nJ = Math.round((lngMax - lngMin) / dlng) + 1;
      const present = new Uint8Array(nI * nJ);
      let slope = new Float64Array(nI * nJ).fill(NaN);
      let wgt = new Float64Array(nI * nJ).fill(NaN);
      for (const c of fcells) {
        present[Math.round((latMax - c.lat) / dlat) * nJ + Math.round((c.flng - lngMin) / dlng)] = 1;
        if (c.slopeDecade === null) continue;
        const k = Math.round((latMax - c.lat) / dlat) * nJ + Math.round((c.flng - lngMin) / dlng);
        slope[k] = c.slopeDecade;
        wgt[k] = c.p !== null && c.p < ALPHA_CELL ? 1 : FADED_WEIGHT;
      }
      // Spread the edge values outwards a few cells so the smooth blend reaches the coastline and borders.
      for (let pass = 0; pass < 3; pass++) {
        const s2 = slope.slice(), w2 = wgt.slice();
        for (let i = 0; i < nI; i++) for (let j = 0; j < nJ; j++) {
          const k = i * nJ + j;
          if (!Number.isNaN(slope[k])) continue;
          let n = 0, ss = 0, ww = 0;
          for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
            const ii = i + di, jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= nI || jj >= nJ) continue;
            const q = ii * nJ + jj;
            if (Number.isNaN(slope[q])) continue;
            n++; ss += slope[q]; ww += wgt[q];
          }
          if (n) { s2[k] = ss / n; w2[k] = ww / n; }
        }
        slope = s2; wgt = w2;
      }
      const base = new Uint8ClampedArray(nI * nJ * 4);
      for (let k = 0; k < nI * nJ; k++) { base[k * 4] = lr * 255; base[k * 4 + 1] = lg * 255; base[k * 4 + 2] = lb * 255; base[k * 4 + 3] = 255; }
      const px = overlayPixels(slope, wgt, vmax, meta.colormap_stops, base, meta.render);
      // A sea: transparent wherever there is no cell of this sea (after the edge spreading above), so the image
      // itself is the mask; the blend between grid points then fades out over half a cell at the sea's edge.
      if (sea) for (let k = 0; k < nI * nJ; k++) if (!present[k]) px[k * 4 + 3] = 0;
      const small = document.createElement('canvas');
      small.width = nJ; small.height = nI;
      const sctx = small.getContext('2d');
      if (sctx) {
        const img = sctx.createImageData(nJ, nI);
        img.data.set(px);
        sctx.putImageData(img, 0, 0);
        const r0 = countryCellRect(pr, latMax, lngMin, dlat / 2, dlng / 2);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(small, r0.x, r0.y, r0.w * nJ, r0.h * nI);
      }
    }
    if (sea) {
      // The rim: land from Natural Earth 50 m, muted, with a thin dark coastline, on top of the sea.
      if (land) {
        const [mr, mg, mb] = mixRgb(hexToRgb(meta.render.land).map((v) => v * 255) as [number, number, number], [120, 124, 128], 0.55);
        const frame = { latMin: pr.latMax - pr.latSpan, latMax: pr.latMax, lngMin: pr.lngMin, lngMax: pr.lngMin + pr.lngSpan };
        const path = new Path2D();
        for (const { poly, shift } of landShifts(land, frame)) {
          for (const ring of poly.rings) {
            ring.forEach(([lng, lat], k) => {
              const x = cx(pr, lng + shift);
              const y = cy(pr, lat);
              if (k === 0) path.moveTo(x, y);
              else path.lineTo(x, y);
            });
            path.closePath();
          }
        }
        ctx.fillStyle = `rgb(${Math.round(mr)},${Math.round(mg)},${Math.round(mb)})`;
        ctx.fill(path, 'evenodd');
        ctx.strokeStyle = 'rgba(20,20,30,0.8)';
        ctx.lineWidth = 0.8;
        ctx.lineJoin = 'round';
        ctx.stroke(path);
      }
      return off;
    }
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = '#000';
    ctx.fill(outline, 'evenodd');
    return off;
  }, [pr, outline, fcells, vmax, meta, sea, land, dlat, dlng]);

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
      const r = countryCellRect(pr, c.lat, c.flng, dlat / 2, dlng / 2);
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    }
    if (provPaths) {
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(20,26,42,0.55)';
      ctx.lineWidth = 0.7;
      for (const pp of provPaths) ctx.stroke(pp.path);
      const hp = provHover ?? highlightProvince;
      if (hp !== null && provPaths[hp]) {
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 2;
        ctx.stroke(provPaths[hp].path);
      }
    }
    ctx.restore();
    if (!sea) {
      ctx.strokeStyle = '#141a2a';
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.stroke(outline);
    }

    // Cities: dots, then labels for the capital and the largest few (a label that would collide is skipped).
    ctx.font = '11px system-ui, sans-serif';
    const inView = (c: { flng: number; lat: number }) => {
      const x = cx(pr, c.flng);
      const y = cy(pr, c.lat);
      return x >= 0 && x <= pr.width && y >= 0 && y <= pr.height;
    };
    fcities.forEach((c, k) => {
      if (!inView(c)) return; // a city in a distant part that is outside the view
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
    const order = labelOrder(fcities.filter(inView), 7);
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
  }, [pr, outline, layer, fcells, fcities, vmax, stops, hover, provPaths, provHover, highlightProvince, sea, dlat, dlng]);

  const onClick = (e: React.MouseEvent) => {
    const h = hitAt(e);
    if (!h) return;
    if (lastPointer.current === 'touch' && !(hover && hover.kind === h.kind && hover.index === h.index)) {
      setHover(h);
      setProvHover(provAt(e));
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

  const shownProv = provHover ?? highlightProvince;
  let provLine: string | null = null;
  if (provinces && shownProv !== null && provinces[shownProv]) {
    const pv = provinces[shownProv];
    const kind = pv.type ? pv.type.toLowerCase() : 'region';
    provLine = `${pv.name} (${kind}): ${rate(pv.slopeDecade, pv.p, units)}${pv.slopeDecade === null ? '' : `, average of ${pv.nCells} grid cell${pv.nCells === 1 ? '' : 's'}`}`;
  }

  return (
    <div className="detail-map country-map">
      <div ref={hostRef} className="detail-canvas-host">
        <canvas
          ref={canvasRef}
          className="detail-canvas country-canvas"
          role="img"
          aria-label={
            sea
              ? `${name}, each grid cell coloured by its own trend, with the land around it and the cities on its shores`
              : `${name} on its own, each grid cell coloured by its own trend, with its cities`
          }
          onPointerMove={(e) => {
            lastPointer.current = e.pointerType;
            if (e.pointerType !== 'touch') {
              setHover(hitAt(e));
              const pv = provAt(e);
              setProvHover(pv);
              onHoverProvince?.(pv);
            }
          }}
          onPointerDown={(e) => {
            lastPointer.current = e.pointerType;
          }}
          onPointerLeave={(e) => {
            if (e.pointerType !== 'touch') {
              setHover(null);
              setProvHover(null);
              onHoverProvince?.(null);
            }
          }}
          onClick={onClick}
        />
      </div>
      <p className="detail-readout" aria-live="polite">
        {provLine && <span className="ro-line ro-prov">{provLine}</span>}
        <span className="ro-line">{readout}</span>
      </p>
      {children}
      {pr && (
        <p className="country-size">
          {sea ? 'This view is about' : 'About'} {Math.round(countryWidthKm(pr)).toLocaleString('en-US')} km wide{tiny ? ' (smaller than one grid cell)' : ''}.{leftOutText(main.left)}
        </p>
      )}
    </div>
  );
}
