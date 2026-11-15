import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TOUR_STEPS, stepFinished, type TourState, type TourTarget } from './tourSteps';
import './tour.css';

declare global {
  interface Window {
    __tour?: { active: boolean; step: string | null; index: number; target: boolean };
  }
}

interface Props {
  active: boolean;
  state: TourState;
  /** "Start" was pressed: the page puts itself in the state the tour expects (whole globe, Lift, 1981-2025). */
  onBegin: () => void;
  /** The tour ended (finished or skipped). */
  onEnd: () => void;
}

/** The control a step asks for, or the Menu button when the control is inside a closed menu. */
function findTarget(target: TourTarget): { el: Element; viaMenu: boolean } | null {
  if (!target) return null;
  const optWithText = (text: string) =>
    [...document.querySelectorAll('.menu .menu-opt')].find((b) => (b.textContent ?? '').trim() === text) ?? null;
  const visible = (el: Element | null) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none' ? el : null;
  };
  let el: Element | null = null;
  if (target === 'country-back') el = document.querySelector('.co-back');
  else if (target === 'group-water') el = optWithText('Water');
  else if (target === 'click-point') el = optWithText('Point');
  else if (target === 'panel-close') el = document.querySelector('.panel-close');
  else if (target === 'detective-pill') el = document.querySelector('.dt-pill');
  else if (target === 'detective-input') el = document.querySelector('.dt-input');
  const found = visible(el);
  if (found) return { el: found, viaMenu: false };
  if (target === 'group-water' || target === 'click-point') {
    const toggle = visible(document.querySelector('.menu-toggle'));
    if (toggle) return { el: toggle, viaMenu: true };
  }
  return null;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The guided tour (tourSteps.ts): a card that says what to click, and a ring around the control. The card never covers
 * the page: clicks go to the real controls, and each one moves the tour on.
 */
export default function Tour({ active, state, onBegin, onEnd }: Props) {
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [viaMenu, setViaMenu] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  /** The control that was last scrolled into view (a control low in the menu is outside its visible part on a phone). */
  const scrolled = useRef<Element | null>(null);
  const [cardPos, setCardPos] = useState<{ left: number; top: number } | null>(null);
  const step = active ? TOUR_STEPS[index] : null;

  // A new run starts at the first step.
  useEffect(() => {
    if (active) setIndex(0);
  }, [active]);

  // The visitor did what the step asks: move on.
  useEffect(() => {
    if (!step || !stepFinished(step, state)) return;
    if (index + 1 < TOUR_STEPS.length) setIndex(index + 1);
    else onEnd();
  }, [step, state, index, onEnd]);

  // Follow the control on the page: it moves when panels open, the window is resized or the menu scrolls.
  useEffect(() => {
    if (!step) return;
    const measure = () => {
      const t = findTarget(step.target);
      if (!t) {
        setBox(null);
        setViaMenu(false);
        return;
      }
      if (!t.viaMenu && scrolled.current !== t.el) {
        scrolled.current = t.el;
        t.el.scrollIntoView({ block: 'center', inline: 'nearest' });
      }
      const r = t.el.getBoundingClientRect();
      setViaMenu(t.viaMenu);
      setBox((old) =>
        old && Math.abs(old.left - r.left) < 0.5 && Math.abs(old.top - r.top) < 0.5 && Math.abs(old.width - r.width) < 0.5 && Math.abs(old.height - r.height) < 0.5
          ? old
          : { left: r.left, top: r.top, width: r.width, height: r.height },
      );
    };
    measure();
    const id = window.setInterval(measure, 200);
    window.addEventListener('resize', measure);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('resize', measure);
    };
  }, [step]);

  // Place the card next to the control (below it, or above when there is no room), inside the window; with no control
  // (a click on the globe) at the top centre, clear of the globe's middle.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!step || !card) return;
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 12;
    const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
    if (!box) {
      setCardPos({ left: clamp((vw - cw) / 2, 8, vw - cw - 8), top: clamp(64, 8, vh - ch - 8) });
      return;
    }
    const beside = box.left + box.width + gap;
    if (step.side === 'right' && beside + cw <= vw - 8) {
      setCardPos({ left: beside, top: clamp(box.top, 8, vh - ch - 8) });
      return;
    }
    const below = box.top + box.height + gap;
    const above = box.top - gap - ch;
    let top = below + ch <= vh - 8 ? below : above >= 8 ? above : clamp(vh - ch - 8, 8, vh - ch - 8);
    let left = clamp(box.left + box.width / 2 - cw / 2, 8, vw - cw - 8);
    // Neither below nor above fits (a tall control): put the card beside it.
    if (!(below + ch <= vh - 8) && !(above >= 8)) {
      const right = box.left + box.width + gap;
      left = right + cw <= vw - 8 ? right : clamp(box.left - gap - cw, 8, vw - cw - 8);
      top = clamp(box.top, 8, vh - ch - 8);
    }
    setCardPos({ left, top });
  }, [step, box, index]);

  useEffect(() => {
    window.__tour = { active, step: step ? step.key : null, index: active ? index : -1, target: !!box };
    return () => {
      delete window.__tour;
    };
  }, [active, step, index, box]);

  if (!step) return null;
  const last = index === TOUR_STEPS.length - 1;
  const press = () => {
    if (index === 0) onBegin();
    if (last) onEnd();
    else setIndex(index + 1);
  };
  return (
    <div className="tour" aria-live="polite">
      {box && (
        <div
          className="tour-ring"
          style={{ left: box.left - 5, top: box.top - 5, width: box.width + 10, height: box.height + 10 }}
          aria-hidden="true"
        />
      )}
      <div
        ref={cardRef}
        className="tour-card"
        role="dialog"
        aria-label="Guided tour"
        style={cardPos ? { left: cardPos.left, top: cardPos.top } : { left: 8, top: 64, visibility: 'hidden' }}
      >
        <div className="tour-count">
          Tour · step {index + 1} of {TOUR_STEPS.length}
        </div>
        <h2 className="tour-title">{step.title}</h2>
        <p className="tour-text">
          {viaMenu ? 'Open the Menu first (the ringed button), then: ' : ''}
          {step.text}
        </p>
        <div className="tour-actions">
          {step.button && (
            <button type="button" className="tour-btn tour-primary" onClick={press}>
              {step.button}
            </button>
          )}
          {!last && (
            <button type="button" className="tour-btn" onClick={onEnd}>
              Skip the tour
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
