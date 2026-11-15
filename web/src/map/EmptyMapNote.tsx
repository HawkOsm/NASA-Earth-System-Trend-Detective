import { emptyMapText, isEmptyMap, type ShownMap } from './emptyMap';
import { periodText, type Period } from '../menu/period';
import './emptyMapNote.css';

interface Props {
  shown: ShownMap;
  /** The period the sliders are set to; the notice waits until the map on screen belongs to it. */
  period: Period;
  fullYears: Period;
  /** True while a panel or the lifted country covers the map. */
  covered: boolean;
  onReset: () => void;
}

/** A notice over the map when the chosen period leaves it plain (emptyMap.ts). */
export default function EmptyMapNote({ shown, period, fullYears, covered, onReset }: Props) {
  if (covered || !isEmptyMap(shown) || shown.start !== period[0] || shown.end !== period[1]) return null;
  return (
    <div className="empty-map" role="status">
      <p>{emptyMapText(shown)}</p>
      <button type="button" className="empty-map-btn" onClick={onReset}>
        Show {periodText(fullYears)}
      </button>
    </div>
  );
}
