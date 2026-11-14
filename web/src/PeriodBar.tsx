import { useEffect, useRef } from 'react';
import { clampPeriod, isFullPeriod, type Period } from './period';

interface Props {
  period: Period;
  full: Period;
  /** Live change while dragging or stepping (updates the numbers and the side panel). */
  onChange: (p: Period) => void;
  /** Released (native "change" event): the map is recomputed. */
  onCommit: () => void;
  onReset: () => void;
  /** 0..1 while the map is being recomputed, else null. */
  recomputing: number | null;
  failed?: boolean;
  /** Sits in the normal flow (inside the country overlay) instead of floating over the globe. */
  inline?: boolean;
  /** Heading text (default "Period"); the menu shows the chosen years here. */
  title?: string;
}

function Slider({
  id,
  label,
  value,
  min,
  max,
  onInput,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onInput: (v: number) => void;
  onCommit: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = () => commitRef.current();
    el.addEventListener('change', h); // fires on release (pointer) and on each key step
    return () => el.removeEventListener('change', h);
  }, []);
  return (
    <label className="period-row" htmlFor={id}>
      <span className="period-name">{label}</span>
      <input
        ref={ref}
        id={id}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onInput(Number(e.target.value))}
        aria-valuetext={String(value)}
      />
      <span className="period-year">{value}</span>
    </label>
  );
}

export default function PeriodBar({ period, full, onChange, onCommit, onReset, recomputing, failed, inline, title }: Props) {
  const isFull = isFullPeriod(period, full);
  return (
    <div className={`period-bar${inline ? ' period-bar-inline' : ''}`} role="group" aria-label="Period">
      <div className="period-head">
        <span className="period-title">{title ?? 'Period'}</span>
        <span className="period-status" aria-live="polite">
          {recomputing !== null
            ? `Recomputing map… ${Math.round(recomputing * 100)}%`
            : failed
              ? 'Could not recompute the map.'
              : ''}
        </span>
        <button className="period-reset" onClick={onReset} disabled={isFull}>
          Reset
        </button>
      </div>
      <Slider
        id="period-from"
        label="From"
        value={period[0]}
        min={full[0]}
        max={full[1]}
        onInput={(v) => onChange(clampPeriod(v, period[1], 'start', full))}
        onCommit={onCommit}
      />
      <Slider
        id="period-to"
        label="To"
        value={period[1]}
        min={full[0]}
        max={full[1]}
        onInput={(v) => onChange(clampPeriod(period[0], v, 'end', full))}
        onCommit={onCommit}
      />
    </div>
  );
}
