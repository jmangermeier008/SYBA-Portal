import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getLeagueAge,
  getSuggestedDivisions,
  calculateCartPricing,
} from '@/lib/registration-logic';
import type { Division } from '@/types/scheduling';

describe('getLeagueAge', () => {
  it('calculates age as of the season cutoff date', () => {
    // Born March 2016, cutoff May 1 2026 → already turned 10
    expect(getLeagueAge('2016-03-10', '2026-05-01')).toBe(10);
  });

  it('uses the age before a birthday that falls after the cutoff', () => {
    // Born June 2016, cutoff May 1 2026 → still 9 on cutoff day
    expect(getLeagueAge('2016-06-01', '2026-05-01')).toBe(9);
  });

  it('counts a birthday on the cutoff day itself', () => {
    expect(getLeagueAge('2016-05-01', '2026-05-01')).toBe(10);
  });

  it('returns N/A for an empty date of birth', () => {
    expect(getLeagueAge('', '2026-05-01')).toBe('N/A');
  });

  it('returns N/A for an unparseable date of birth', () => {
    expect(getLeagueAge('not-a-date', '2026-05-01')).toBe('N/A');
  });

  describe('without a cutoff date (defaults to May 1 of current year)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-09T12:00:00'));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('falls back to May 1 of the current year', () => {
      expect(getLeagueAge('2016-03-10')).toBe(10);
      expect(getLeagueAge('2016-06-01')).toBe(9);
    });
  });
});

describe('getSuggestedDivisions', () => {
  const div = (id: string, minAge?: number, maxAge?: number): Division =>
    ({ id, name: id, minAge, maxAge } as unknown as Division);

  const divisions = [
    div('majors', 11, 12),
    div('minors', 9, 10),
    div('tball', undefined, 6),
    div('teeners', 13, undefined),
    div('open'), // no age restriction
  ];

  it('returns all divisions when age is N/A', () => {
    expect(getSuggestedDivisions('N/A', divisions)).toEqual(divisions);
  });

  it('returns empty array unchanged for no divisions', () => {
    expect(getSuggestedDivisions(10, [])).toEqual([]);
  });

  it('matches min/max range divisions and unrestricted divisions', () => {
    const result = getSuggestedDivisions(10, divisions);
    expect(result.map(d => d.id)).toContain('minors');
    expect(result.map(d => d.id)).toContain('open');
    expect(result.map(d => d.id)).not.toContain('majors');
    expect(result.map(d => d.id)).not.toContain('tball');
  });

  it('matches max-only divisions for young players', () => {
    const result = getSuggestedDivisions(5, divisions);
    expect(result.map(d => d.id)).toContain('tball');
    expect(result.map(d => d.id)).not.toContain('minors');
  });

  it('matches min-only divisions for older players', () => {
    const result = getSuggestedDivisions(14, divisions);
    expect(result.map(d => d.id)).toContain('teeners');
    expect(result.map(d => d.id)).not.toContain('majors');
  });

  it('sorts matches by minAge ascending', () => {
    const result = getSuggestedDivisions(12, [div('a', 11, 13), div('b', 9, 13), div('c')]);
    expect(result.map(d => d.id)).toEqual(['c', 'b', 'a']);
  });

  it('falls back to all divisions when nothing matches', () => {
    const onlyTeens = [div('teeners', 13, 15)];
    expect(getSuggestedDivisions(7, onlyTeens)).toEqual(onlyTeens);
  });
});

describe('calculateCartPricing (sibling discount)', () => {
  it('charges $125 for the first player in a family', () => {
    expect(calculateCartPricing(0, 1)).toEqual([12500]);
  });

  it('charges $50 for each sibling after the first in one cart', () => {
    expect(calculateCartPricing(0, 3)).toEqual([12500, 5000, 5000]);
  });

  it('charges $50 when the family already paid for a player this season', () => {
    expect(calculateCartPricing(1, 1)).toEqual([5000]);
    expect(calculateCartPricing(2, 2)).toEqual([5000, 5000]);
  });

  it('returns an empty array for an empty cart', () => {
    expect(calculateCartPricing(0, 0)).toEqual([]);
  });
});
