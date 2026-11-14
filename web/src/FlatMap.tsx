import { useEffect, useRef, useState } from 'react';
import type { LatLng } from './Globe';
import { buildGraticule, buildGraticuleLabels } from './graticule';
import { fitTwoToOne, latLngToFraction, pixelToLatLng } from './flatmap';

interface FlatMapProps {
  textureUrl: string;
  onPick: (pos: LatLng) => void;
  marker?: LatLng | null;
  mapLines?: boolean;
}

// Graticule in image fractions, in a 360 x 180 viewBox (x = lng + 180, y = 90 - lat).
const FLAT_LINES = buildGraticule().map((g) => ({
  strong: g.strong,
  points: g.coords.map(([lng, lat]) => `${lng + 180},${90 - lat}`).join(' '),
}));
const FLAT_LABELS = buildGraticuleLabels();

/** Equirectangular fallback used when WebGL is unavailable. */
export default function FlatMap({ textureUrl, onPick, marker, mapLines = true }: FlatMapProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const update = () => setBox(fitTwoToOne(el.clientWidth, el.clientHeight));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleClick = (e: React.MouseEvent) => {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    onPick(pixelToLatLng(e.clientX - r.left, e.clientY - r.top, r.width, r.height));
  };

  useEffect(() => {
    window.__mapLines = {
      on: mapLines,
      graticuleLines: mapLines ? FLAT_LINES.length : 0,
      borderLines: 0,
      labels: mapLines ? FLAT_LABELS.length : 0,
    };
    return () => {
      delete window.__mapLines;
    };
  }, [mapLines]);

  const dot = marker ? latLngToFraction(marker.lat, marker.lng) : null;

  return (
    <div className="flat-host" ref={hostRef}>
      <div className="flat-note">3D is not available in this browser — showing a flat map.</div>
      <div
        className="flat-box"
        ref={boxRef}
        style={{ width: box.width, height: box.height }}
        onClick={handleClick}
        role="img"
        aria-label="Flat map of climate trends. Click to pick a location."
      >
        <img src={textureUrl} alt="" draggable={false} />
        {mapLines && (
          <svg
            className="flat-lines"
            viewBox="0 0 360 180"
            preserveAspectRatio="none"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
            aria-hidden="true"
          >
            {FLAT_LINES.map((l, k) => (
              <polyline
                key={k}
                points={l.points}
                fill="none"
                stroke={l.strong ? 'rgba(20,25,40,0.6)' : 'rgba(20,25,40,0.35)'}
                strokeWidth={0.25}
                vectorEffect="non-scaling-stroke"
                style={{ strokeWidth: l.strong ? 1.2 : 0.8 }}
              />
            ))}
            {FLAT_LABELS.map((l) => {
              const x = Math.min(Math.max(l.lng + 180, 4), 356);
              return (
                <text
                  key={`${l.lat},${l.lng}`}
                  x={x}
                  y={90 - l.lat - 1}
                  fontSize={3.2}
                  textAnchor={l.lng === 180 ? 'end' : 'start'}
                  fill="rgba(15,20,35,0.85)"
                >
                  {l.text}
                </text>
              );
            })}
          </svg>
        )}
        {dot && <span className="flat-dot" style={{ left: `${dot.fx * 100}%`, top: `${dot.fy * 100}%` }} />}
      </div>
    </div>
  );
}
