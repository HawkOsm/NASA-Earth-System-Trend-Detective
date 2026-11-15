import { describe, expect, it } from 'vitest';
import { TOUR_STEPS, shouldAutoStart, stepFinished, stepNeedsMenu, type TourState } from './tourSteps';

const base: TourState = { overlayOpen: false, variable: 'T2M', lift: true, panelOpen: false, detectiveOpen: false };
const step = (key: string) => TOUR_STEPS.find((s) => s.key === key)!;

describe('guided tour', () => {
  it('every step is finished either by a click on the page or by its own button', () => {
    for (const s of TOUR_STEPS) expect(!!s.done || !!s.button).toBe(true);
    for (const s of TOUR_STEPS.slice(1, -1)) expect([s.key, !!s.done, !!s.button]).toEqual([s.key, true, false]);
    expect(TOUR_STEPS[0].button).toBe('Start');
    expect(TOUR_STEPS[TOUR_STEPS.length - 1].button).toBe('Finish');
  });

  it('a step is not finished before the visitor acts, and is afterwards', () => {
    // the page as it is when each step starts, and after the click the step asks for
    const walk: [string, TourState, TourState][] = [
      ['lift', base, { ...base, overlayOpen: true }],
      ['inside', { ...base, overlayOpen: true }, base],
      ['variable', base, { ...base, variable: 'PRECTOTCORR' }],
      ['point', { ...base, variable: 'PRECTOTCORR' }, { ...base, variable: 'PRECTOTCORR', lift: false }],
      ['place', { ...base, lift: false }, { ...base, lift: false, panelOpen: true }],
      ['panel', { ...base, lift: false, panelOpen: true }, { ...base, lift: false }],
      ['detective', { ...base, lift: false }, { ...base, lift: false, detectiveOpen: true }],
    ];
    for (const [key, before, after] of walk) {
      expect([key, stepFinished(step(key), before)]).toEqual([key, false]);
      expect([key, stepFinished(step(key), after)]).toEqual([key, true]);
    }
  });

  it('any variable of the Water group finishes the variable step, others do not', () => {
    for (const v of ['PRECTOTCORR', 'GWETROOT', 'EVLAND', 'RH2M']) expect(stepFinished(step('variable'), { ...base, variable: v })).toBe(true);
    for (const v of ['T2M', 'T2M_MAX', 'FRSNO', 'TO3']) expect(stepFinished(step('variable'), { ...base, variable: v })).toBe(false);
  });

  it('the welcome step waits for its button; the last step also ends when a question opens a view', () => {
    expect(stepFinished(step('welcome'), { ...base, overlayOpen: true, panelOpen: true })).toBe(false);
    expect(stepFinished(step('ask'), { ...base, detectiveOpen: true })).toBe(false);
    expect(stepFinished(step('ask'), { ...base, detectiveOpen: true, overlayOpen: true })).toBe(true);
  });

  it('starts by itself for a first visit only, unless the address says otherwise', () => {
    expect(shouldAutoStart('', false)).toBe(true);
    expect(shouldAutoStart('', true)).toBe(false);
    expect(shouldAutoStart('?tour=0', false)).toBe(false);
    expect(shouldAutoStart('?tour=1', true)).toBe(true);
    expect(shouldAutoStart('?flat=1', false)).toBe(true);
  });

  it('opens the menu only for the steps that point into it, so the globe is free for the others', () => {
    expect(TOUR_STEPS.filter((s) => stepNeedsMenu(s)).map((s) => s.key)).toEqual(['variable', 'point']);
    expect(stepNeedsMenu(step('lift'))).toBe(false);
    expect(stepNeedsMenu(step('place'))).toBe(false);
    expect(stepNeedsMenu(null)).toBe(false);
  });
});
