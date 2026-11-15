import { describe, expect, it } from 'vitest';
import {
  CONFIRMED_DISABLED_TEXT,
  chooseTexture,
  confirmedEnabled,
  confirmedSentence,
  effectiveMode,
} from './confirmedMap';

describe('confirmed-only view', () => {
  it('is enabled only for temperature and rainfall at the full period', () => {
    expect(confirmedEnabled('T2M', true)).toBe(true);
    expect(confirmedEnabled('PRECTOTCORR', true)).toBe(true);
    expect(confirmedEnabled('GWETROOT', true)).toBe(false);
    expect(confirmedEnabled('T2M_MAX', true)).toBe(false);
    expect(confirmedEnabled('T2M', false)).toBe(false);
    expect(confirmedEnabled('T2M', true, true)).toBe(false);
  });
  it('a disabled row always shows all significant trends', () => {
    expect(effectiveMode(true, true)).toBe('confirmed');
    expect(effectiveMode(true, false)).toBe('all');
    expect(effectiveMode(false, true)).toBe('all');
  });
  it('says what the row is for when disabled', () => {
    expect(CONFIRMED_DISABLED_TEXT).toBe('Confirmed-only view exists for air temperature and rainfall, for 1981–2025.');
  });
  it('writes the share sentence with whole-number percentages', () => {
    expect(confirmedSentence('GPCP', { significant: 0.2121, confirmed: 0.0512, notConfirmed: 0.1302, uncheckable: 0.0308 })).toBe(
      'Showing only trends confirmed by GPCP: 5% of the globe. Hidden: 13% not confirmed, 3% where the record cannot check.',
    );
  });
  it('with several records: names them and the partly share', () => {
    expect(
      confirmedSentence('GPCP', { significant: 0.2121, confirmed: 0.1019, partly: 0.0203, notConfirmed: 0.0591, uncheckable: 0.0308 }, ['GPCP', 'CMAP', 'GPCC', 'PREC/L']),
    ).toBe(
      'Showing only trends confirmed by most of the 4 independent records (GPCP, CMAP, GPCC and PREC/L): 10% of the globe. Hidden: 2% partly confirmed, 6% not confirmed, 3% where the records cannot check.',
    );
  });
  it('chooses the confirmed texture only in confirmed mode for a variable that has one', () => {
    expect(chooseTexture('confirmed', 'PRECTOTCORR', 'trend.png')).toContain('PRECTOTCORR_confirmed.png');
    expect(chooseTexture('confirmed', 'T2M', 'trend.png')).toContain('T2M_confirmed.png');
    expect(chooseTexture('all', 'PRECTOTCORR', 'trend.png')).toBe('trend.png');
    expect(chooseTexture('confirmed', 'WS2M', 'trend.png')).toBe('trend.png');
  });
});
