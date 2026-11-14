import { FINDINGS, type Finding } from './findings';
import './firstRun.css';

const KEY = 'trend-detective.first-run-closed';

/** Whether the visitor closed the card earlier in this browser tab. Storage can be unavailable; then it is not closed. */
export function firstRunClosed(): boolean {
  try {
    return window.sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function rememberFirstRunClosed(): void {
  try {
    window.sessionStorage.setItem(KEY, '1');
  } catch {
    // Nothing to do: the card simply comes back on the next load.
  }
}

/** The card a first-time visitor sees over the globe: what to do, and three findings to open with one click. */
export default function FirstRun({
  ready,
  onFinding,
  onClose,
}: {
  /** False until the variable metadata has loaded; the findings cannot open before that. */
  ready: boolean;
  onFinding: (f: Finding) => void;
  onClose: () => void;
}) {
  return (
    <section className="fr" aria-label="Where to start">
      <div className="fr-head">
        <h2 className="fr-title">Start here</h2>
        <button type="button" className="fr-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <p className="fr-text">
        Click any place on the globe to see how it has changed since 1981, or open one of these findings:
      </p>
      <ul className="fr-list">
        {FINDINGS.map((f) => (
          <li key={f.id}>
            <button type="button" className="fr-item" disabled={!ready} onClick={() => onFinding(f)}>
              <span className="fr-item-title">{f.title}</span>
              <span className="fr-item-detail">{f.detail}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="fr-note">All three are statistically significant (p &lt; 0.001), 1981–2025.</p>
    </section>
  );
}
