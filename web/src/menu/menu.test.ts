import { describe, expect, it } from 'vitest';
import { CLICK_OPTIONS, clickKey, groupOf } from './Menu';
import { VARIABLES } from '../data/demos';

describe('menu helpers', () => {
  it('lift wins over the box size', () => {
    expect(clickKey(true, 5)).toBe('lift');
    expect(clickKey(false, 5)).toBe(5);
    expect(clickKey(false, 0)).toBe(0);
    expect(CLICK_OPTIONS.map((o) => o.key)).toEqual(['lift', 0, 2, 5, 10]);
  });
  it('every variable has a group', () => {
    for (const v of VARIABLES) expect(groupOf(v)).not.toBeNull();
    expect(groupOf('WS2M')?.name).toBe('Air');
    expect(groupOf('nope')).toBeNull();
  });
});

describe('share wording', () => {
  it('says "of the globe" only for global variables', async () => {
    const { shareOfText } = await import('./Menu');
    expect(shareOfText('any')).toBe('of the globe');
    expect(shareOfText(undefined)).toBe('of the globe');
    expect(shareOfText('land')).toBe('of the area with data');
    expect(shareOfText('sea')).toBe('of the area with data');
  });
});

describe('show row', () => {
  it('has the disabled text and enabled rule from confirmedMap', async () => {
    const { confirmedEnabled, CONFIRMED_DISABLED_TEXT } = await import('../map/confirmedMap');
    expect(confirmedEnabled('PRECTOTCORR', true)).toBe(true);
    expect(confirmedEnabled('GWETROOT', true)).toBe(false);
    expect(confirmedEnabled('T2M', false)).toBe(false);
    expect(CONFIRMED_DISABLED_TEXT).toContain('air temperature and rainfall');
  });
});
