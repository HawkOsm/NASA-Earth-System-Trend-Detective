import { useState } from 'react';
import { START_FINDINGS, rateText, recordText, type StartFinding } from './startFindings';
import './startCard.css';

const SEEN_KEY = 'trend-detective:start-card-closed';

function alreadyClosed(): boolean {
  try {
    return window.sessionStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false; // storage blocked: just show the card
  }
}

interface Props {
  /** Something else is in front (side panel, country piece, Detective): the card steps aside but is not dismissed. */
  covered: boolean;
  onOpen: (finding: StartFinding) => void;
}

/**
 * A strip across the top of the globe for a first-time visitor: one line saying what a click does, and three findings
 * that open the ordinary point panel. It closes for the rest of the visit when the visitor closes it or opens a finding.
 */
export default function StartCard({ covered, onOpen }: Props) {
  const [closed, setClosed] = useState(alreadyClosed);
  const close = () => {
    setClosed(true);
    try {
      window.sessionStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* nothing to remember it in */
    }
  };
  if (closed || covered) return null;
  return (
    <section className="start" aria-label="Where to start">
      <div className="start-top">
        <p className="start-lead">
          <strong>New here?</strong> Click anywhere on the globe, or open a finding that an independent record confirms:
        </p>
        <button type="button" className="start-close" onClick={close} aria-label="Close the start card">
          Got it
        </button>
      </div>
      <ul className="start-list">
        {START_FINDINGS.map((f) => (
          <li key={f.key}>
            <button
              type="button"
              className="start-item"
              onClick={() => {
                close();
                onOpen(f);
              }}
            >
              <span className="start-headline">{f.headline}</span>
              <span className="start-rate">
                {f.variableLabel}: {rateText(f)}
              </span>
              <span className="start-record">{recordText(f)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
