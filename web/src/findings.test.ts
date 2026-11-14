import { describe, expect, it } from 'vitest';
import { VARIABLES } from './demos';
import { FINDINGS } from './findings';

describe('first-run findings', () => {
  it('offers three findings with distinct ids', () => {
    expect(FINDINGS).toHaveLength(3);
    expect(new Set(FINDINGS.map((f) => f.id)).size).toBe(3);
  });

  it('each names a variable of the site and a real place', () => {
    for (const f of FINDINGS) {
      expect(VARIABLES as readonly string[]).toContain(f.variable);
      expect(Math.abs(f.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(f.lng)).toBeLessThanOrEqual(180);
    }
  });

  it('each states a signed rate per decade', () => {
    for (const f of FINDINGS) expect(f.detail).toMatch(/: [+-]\d+\.\d{2} .+ per decade$/);
  });
});
