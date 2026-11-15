/**
 * The guided tour: a first-time visitor is asked to click the real controls, one at a time, and each click moves the
 * tour on. Pure data and rules; Tour.tsx draws it. A step is finished either by what the page shows afterwards (`done`)
 * or, for the first and last step, by its own button.
 */
import { VARIABLE_GROUPS } from '../data/demos';

/** What the tour watches on the page. */
export interface TourState {
  /** A country or sea is lifted out of the map. */
  overlayOpen: boolean;
  variable: string;
  /** The Click row is on "Lift" (a click lifts a country) rather than Point or a box. */
  lift: boolean;
  /** The panel of one place is open. */
  panelOpen: boolean;
  detectiveOpen: boolean;
}

export type TourTarget = 'country-back' | 'group-water' | 'click-point' | 'panel-close' | 'detective-pill' | 'detective-input' | null;

export interface TourStep {
  key: string;
  title: string;
  text: string;
  /** The control to click, ringed on the page; null when the click goes on the globe itself. */
  target: TourTarget;
  /** True once the visitor has done what the step asks. The first step has only a button; the last has both. */
  done?: (s: TourState) => boolean;
  /** The step is finished with its own button instead of a click on the page. */
  button?: string;
  /** Put the card to the right of the control when there is room (default: below or above it). */
  side?: 'right';
}

const WATER: readonly string[] = VARIABLE_GROUPS.find((g) => g.name === 'Water')?.variables ?? [];

export const TOUR_STEPS: TourStep[] = [
  {
    key: 'welcome',
    title: 'A one-minute tour',
    text: 'The globe is coloured by how fast air temperature has changed since 1981: red is warming, blue is cooling, plain means no clear trend. A few clicks show you everything. You can stop at any time.',
    target: null,
    button: 'Start',
  },
  {
    key: 'lift',
    title: 'Click any country on the globe',
    text: 'It lifts out of the map so you can look inside it. Drag the globe to turn it first if you like.',
    target: null,
    done: (s) => s.overlayOpen,
  },
  {
    key: 'inside',
    title: 'This is the country, lifted out',
    text: 'Left: its trend and how far it can be trusted. Middle: every grid cell, with provinces and cities. Now click “Back to the globe”.',
    target: 'country-back',
    side: 'right',
    done: (s) => !s.overlayOpen,
  },
  {
    key: 'variable',
    title: 'Ten variables in four groups',
    text: 'Click “Water” in the menu to switch from temperature to rainfall, soil moisture, evaporation and humidity.',
    target: 'group-water',
    done: (s) => WATER.includes(s.variable),
  },
  {
    key: 'point',
    title: 'One exact place',
    text: 'A click can also open a single place instead of a whole country. Click “Point” in the Click row of the menu.',
    target: 'click-point',
    done: (s) => !s.lift,
  },
  {
    key: 'place',
    title: 'Now click any place on the globe',
    text: 'A panel opens with its yearly values, the trend, a grade, and what independent records say.',
    target: null,
    done: (s) => s.panelOpen,
  },
  {
    key: 'panel',
    title: 'One place in detail',
    text: 'The chart shows every year, the line is the trend, and the grade says how far to trust it. Close the panel with ×.',
    target: 'panel-close',
    done: (s) => !s.panelOpen,
  },
  {
    key: 'detective',
    title: 'Ask in words',
    text: 'Click “Detective”. You can type a place or a whole question there.',
    target: 'detective-pill',
    done: (s) => s.detectiveOpen,
  },
  {
    key: 'ask',
    title: 'Type a question and press Enter',
    text: 'Try “Turkey since 2000” or “what is changing in Europe?”. The Detective finds the place, sets the years you name, turns the globe and opens the view. That is the tour: explore freely from here.',
    target: 'detective-input',
    button: 'Finish',
    // Asking a question opens a country view: the tour is over, the visitor is on their way.
    done: (s) => s.overlayOpen,
  },
];

/** The step to show: from `index`, skip forward over steps the page has already satisfied is NOT done; a step waits for
 *  its own action. This only says whether the current step is finished. */
export function stepFinished(step: TourStep, s: TourState): boolean {
  return step.done ? step.done(s) : false;
}

export const TOUR_SEEN_KEY = 'trend-detective:tour-seen';

/** A first-time visitor gets the tour once; `?tour=0` turns it off and `?tour=1` forces it. */
export function shouldAutoStart(search: string, seen: boolean): boolean {
  const q = new URLSearchParams(search).get('tour');
  if (q === '0') return false;
  if (q === '1') return true;
  return !seen;
}
