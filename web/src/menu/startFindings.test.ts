import { describe, expect, it } from 'vitest';
import { VARIABLE_GROUPS, VARIABLES } from '../data/demos';
import { REFERENCE_VARIABLES } from '../evaluation/reference';
import { START_FINDINGS, rateText, recordText } from './startFindings';

describe('start card findings', () => {
  it('are three, with unique keys, at valid coordinates', () => {
    expect(START_FINDINGS).toHaveLength(3);
    expect(new Set(START_FINDINGS.map((f) => f.key)).size).toBe(3);
    for (const f of START_FINDINGS) {
      expect(f.lat).toBeGreaterThanOrEqual(-90);
      expect(f.lat).toBeLessThanOrEqual(90);
      expect(f.lng).toBeGreaterThanOrEqual(-180);
      expect(f.lng).toBeLessThanOrEqual(180);
    }
  });

  it('only use variables that have an independent record, so each can be confirmed', () => {
    for (const f of START_FINDINGS) {
      expect(VARIABLES as readonly string[]).toContain(f.variable);
      expect(REFERENCE_VARIABLES as readonly string[]).toContain(f.variable);
      expect(VARIABLE_GROUPS.some((g) => (g.variables as readonly string[]).includes(f.variable))).toBe(true);
    }
  });

  it('the independent record points the same way as the finding', () => {
    for (const f of START_FINDINGS) {
      expect(f.rate).not.toBe(0);
      expect(Math.sign(f.recordRate)).toBe(Math.sign(f.rate));
    }
  });

  it('cover a rise and a fall, so the card does not tell a one-sided story', () => {
    expect(START_FINDINGS.some((f) => f.rate > 0)).toBe(true);
    expect(START_FINDINGS.some((f) => f.rate < 0)).toBe(true);
  });

  it('format the rate and the record with a sign and two decimals', () => {
    const [a, , c] = START_FINDINGS;
    expect(rateText(a)).toBe('+0.54 °C per decade');
    expect(recordText(a)).toBe('NASA GISTEMP agrees: +0.55');
    expect(rateText(c)).toBe('−0.67 mm/day per decade');
    expect(recordText(c)).toBe('GPCP agrees: −0.36');
  });
});
