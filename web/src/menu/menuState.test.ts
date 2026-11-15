import { describe, expect, it } from 'vitest';
import { SEGMENTS, defaultMenuState, parseMenuState, toggleSegment } from './menuState';

describe('menu state', () => {
  it('starts open on a wide window and closed on a phone', () => {
    expect(defaultMenuState(false)).toEqual({ open: true, on: ['data', 'scale'] });
    expect(defaultMenuState(true)).toEqual({ open: false, on: [] });
  });

  it('reads a stored choice, in segment order, without unknown segments', () => {
    expect(parseMenuState('{"open":false,"on":["scale","nope","data"]}', false)).toEqual({ open: false, on: ['data', 'scale'] });
    expect(parseMenuState('{"open":true,"on":[]}', true)).toEqual({ open: true, on: [] });
  });

  it('falls back to the default for nothing or rubbish', () => {
    expect(parseMenuState(null, false)).toEqual(defaultMenuState(false));
    expect(parseMenuState('not json', true)).toEqual(defaultMenuState(true));
    expect(parseMenuState('{"open":"yes","on":["data"]}', false)).toEqual(defaultMenuState(false));
    expect(parseMenuState('null', false)).toEqual(defaultMenuState(false));
  });

  it('switches a segment on and off, keeping the order', () => {
    expect(toggleSegment(['scale'], 'data')).toEqual(['data', 'scale']);
    expect(toggleSegment(['data', 'scale'], 'data')).toEqual(['scale']);
    expect(toggleSegment([], 'layers')).toEqual(['layers']);
    expect(SEGMENTS.map((s) => s.key)).toEqual(['data', 'period', 'scale', 'click', 'layers']);
  });
});
