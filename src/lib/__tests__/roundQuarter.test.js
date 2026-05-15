import { describe, it, expect } from 'vitest';
import { roundQuarter } from '../submissions.js';

describe('roundQuarter', () => {
  it('passes through exact quarter values unchanged', () => {
    expect(roundQuarter(0)).toBe(0);
    expect(roundQuarter(0.25)).toBe(0.25);
    expect(roundQuarter(0.5)).toBe(0.5);
    expect(roundQuarter(0.75)).toBe(0.75);
    expect(roundQuarter(1)).toBe(1);
    expect(roundQuarter(3.25)).toBe(3.25);
    expect(roundQuarter(3.75)).toBe(3.75);
  });

  it('rounds to the nearest quarter (toward 0.25 increments)', () => {
    // The motivating case: tech types 3.3, should save 3.25
    expect(roundQuarter(3.3)).toBe(3.25);
    // The other motivating case: tech types 3.8, should save 3.75
    expect(roundQuarter(3.8)).toBe(3.75);
    // Other near-quarter values
    expect(roundQuarter(2.1)).toBe(2);
    expect(roundQuarter(2.2)).toBe(2.25);
    expect(roundQuarter(2.4)).toBe(2.5);
    expect(roundQuarter(2.6)).toBe(2.5);
    expect(roundQuarter(2.7)).toBe(2.75);
    expect(roundQuarter(2.9)).toBe(3);
  });

  it('rounds half-quarter values away from zero (standard rounding)', () => {
    // Exactly on the midpoint between two quarters
    expect(roundQuarter(0.125)).toBe(0.25);
    expect(roundQuarter(0.375)).toBe(0.5);
    expect(roundQuarter(0.625)).toBe(0.75);
    expect(roundQuarter(0.875)).toBe(1);
  });

  it('accepts numeric strings (form inputs come in as strings)', () => {
    expect(roundQuarter('3.3')).toBe(3.25);
    expect(roundQuarter('3.75')).toBe(3.75);
    expect(roundQuarter('0')).toBe(0);
  });

  it('returns 0 for empty / null / undefined / non-numeric input', () => {
    expect(roundQuarter('')).toBe(0);
    expect(roundQuarter(null)).toBe(0);
    expect(roundQuarter(undefined)).toBe(0);
    expect(roundQuarter('abc')).toBe(0);
    expect(roundQuarter(NaN)).toBe(0);
    expect(roundQuarter(Infinity)).toBe(0);
  });

  it('handles negative values without crashing (should never happen in practice)', () => {
    expect(roundQuarter(-3.3)).toBe(-3.25);
  });

  it('handles larger values cleanly', () => {
    expect(roundQuarter(12.3)).toBe(12.25);
    expect(roundQuarter(40.7)).toBe(40.75);
    expect(roundQuarter(100)).toBe(100);
  });
});
