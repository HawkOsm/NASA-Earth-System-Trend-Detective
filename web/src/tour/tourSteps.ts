/**
 * The guided tour: a first-time visitor is asked to click the real controls, one at a time, and each click moves the
 * tour on. Pure data and rules; Tour.tsx draws it. A step is finished either by what the page shows afterwards (`done`)
 * or, for the first and last step, by its own button.
 */
import { VARIABLE_GROUPS } from '../data/demos';
import type { SegmentKey } from '../menu/menuState';

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

export type TourTarget =
  | 'country-back'
  | 'group-water'
  | 'period-bar'
  | 'scale'
  | 'click-point'
  | 'layers'
  | 'panel-close'
  | 'detective-pill'
  | 'detective-input'
  | null;

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
  /** The part of the menu the step is about: the menu drops it down for this step (on a phone every part starts
   *  folded, and the open menu lies over the globe, so only the part in question is opened). */
  segment?: SegmentKey;
  /** Put the card to the right of the control when there is room (default: below or above it). */
  side?: 'right';
}

const WATER: readonly string[] = VARIABLE_GROUPS.find((g) => g.name === 'Water')?.variables ?? [];

export const TOUR_STEPS: TourStep[] = [
  {
    key: 'welcome',
    title: 'A two-minute tour',
    text: 'The globe is coloured by how fast air temperature has changed since 1981: red is warming, blue is cooling, plain means no clear trend. A few clicks show you everything, and every part of the menu. You can stop at any time.',
    target: null,
    button: 'Start',
  },
  {
    key: 'lift',
    title: 'Click any country or sea on the globe',
    text: 'It lifts out of the map so you can look inside it: a country with its provinces and cities, or a whole sea or ocean. Drag the globe to turn it first if you like.',
    target: null,
    done: (s) => s.overlayOpen,
  },
  {
    key: 'inside',
    title: 'This is the place, lifted out',
    text: 'You see its trend and how far it can be trusted, a map of every grid cell inside it, and the other variables. Scroll to see it all, then click “Back to the globe”.',
    target: 'country-back',
    side: 'right',
    done: (s) => !s.overlayOpen,
  },
  {
    key: 'variable',
    title: 'Data: ten variables in four groups',
    text: 'The menu has five parts: Data, Period, Scale, Click and Layers. A click on a name opens it or folds it away. Data is open now: click “Water” to switch from temperature to rainfall, soil moisture, evaporation and humidity.',
    target: 'group-water',
    segment: 'data',
    done: (s) => WATER.includes(s.variable),
  },
  {
    key: 'period',
    title: 'Period: choose the years',
    text: 'Drag “From” or “To” to look at a part of the record, ten years or more. The map is worked out again for those years, and “Reset” brings 1981–2025 back. Try it if you like, then press Next.',
    target: 'period-bar',
    segment: 'period',
    button: 'Next',
  },
  {
    key: 'scale',
    title: 'Scale: what the colours mean',
    text: 'The bar gives the change per decade from one end of the colours to the other. Plain map means no significant trend. For temperature and rainfall, “Confirmed only” keeps just the trends that independent records also show.',
    target: 'scale',
    segment: 'scale',
    button: 'Next',
  },
  {
    key: 'point',
    title: 'Click: one exact place',
    text: 'A click on the globe lifts a whole country. It can also open a single place, or a box of 2, 5 or 10 degrees around it. Click “Point”.',
    target: 'click-point',
    segment: 'click',
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
    key: 'layers',
    title: 'Layers: wind, borders, whole globe',
    text: '“Wind” draws the average wind as moving streaks. “Borders & labels” switches the lines and names on the globe. “Whole globe” zooms back out after you have gone close. Press Next.',
    target: 'layers',
    segment: 'layers',
    button: 'Next',
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

/** The part of the menu a step is about (null: none). The menu drops only that part down: on a phone the open menu lies
 *  over the globe, and the steps that ask for a click on the globe need it out of the way. */
export function stepSegment(step: TourStep | null): SegmentKey | null {
  return step?.segment ?? null;
}
