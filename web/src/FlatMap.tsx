import { useEffect, useRef, useState } from 'react';
import type { LatLng } from './Globe';
import { fitTwoToOne, latLngToFraction, pixelToLatLng } from './flatmap';

interface FlatMapProps {
  textureUrl: string;
  onPick: (pos: LatLng) => void;
  marker?: LatLng | null;
}

/** Equirectangular fallback used when WebGL is unavailable. */
export default function FlatMap({ textureUrl, onPick, marker }: FlatMapProps) {
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
        {dot && <span className="flat-dot" style={{ left: `${dot.fx * 100}%`, top: `${dot.fy * 100}%` }} />}
      </div>
    </div>
  );
}
