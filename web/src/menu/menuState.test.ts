import { describe, expect, it } from 'vitest';
import { SEGMENTS, defaultMenuState, parseMenuState, toggleSegment } from './menuState';

describe('menu state', () => {
  it('starts with the variable and scale down on a wide window, and all folded on a phone', () => {
    expect(defaultMenuState(false)).toEqual({ on: ['data', 'scale'] });
    expect(defaultMenuState(true)).toEqual({ on: [] });
  });

  it('reads a stored choice, in segment order, without unknown segments', () => {
    expect(parseMenuState('{"on":["scale","nope","data"]}', false)).toEqual({ on: ['data', 'scale'] });
    expect(parseMenuState('{"on":[]}', false)).toEqual({ on: [] });
  });

  it('falls back to the default for nothing or rubbish', () => {
    expect(parseMenuState(null, false)).toEqual(defaultMenuState(false));
    expect(parseMenuState('not json', true)).toEqual(defaultMenuState(true));
    expect(parseMenuState('{"on":"data"}', false)).toEqual(defaultMenuState(false));
    expect(parseMenuState('null', false)).toEqual(defaultMenuState(false));
  });

  it('switches a segment on and off, keeping the order', () => {
    expect(toggleSegment(['scale'], 'data')).toEqual(['data', 'scale']);
    expect(toggleSegment(['data', 'scale'], 'data')).toEqual(['scale']);
    expect(toggleSegment([], 'layers')).toEqual(['layers']);
    expect(SEGMENTS.map((s) => s.key)).toEqual(['data', 'period', 'scale', 'click', 'layers']);
  });
});
