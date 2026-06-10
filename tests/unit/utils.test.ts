import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cn, stripPhone, formatPhone, calculateLeagueAge } from '@/lib/utils';

describe('cn', () => {
  it('merges conditional classes and resolves Tailwind conflicts', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-sm', false && 'hidden', 'font-bold')).toBe('text-sm font-bold');
  });
});

describe('stripPhone', () => {
  it('removes all non-digit characters', () => {
    expect(stripPhone('(724) 555-1234')).toBe('7245551234');
  });

  it('returns empty string for null or undefined', () => {
    expect(stripPhone(null)).toBe('');
    expect(stripPhone(undefined)).toBe('');
  });
});

describe('formatPhone', () => {
  it('formats a 10-digit number as (XXX) XXX-XXXX', () => {
    expect(formatPhone('7245551234')).toBe('(724) 555-1234');
    expect(formatPhone('724-555-1234')).toBe('(724) 555-1234');
  });

  it('returns the raw value when not 10 digits', () => {
    expect(formatPhone('555-1234')).toBe('555-1234');
  });

  it('returns empty string for missing input', () => {
    expect(formatPhone(null)).toBe('');
  });
});

describe('calculateLeagueAge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-09T12:00:00'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses May 1 of the current year by default (baseball)', () => {
    expect(calculateLeagueAge('2016-03-10')).toBe(10);
    expect(calculateLeagueAge('2016-06-01')).toBe(9);
  });

  it('supports a custom cutoff month (football: August 1)', () => {
    // Born June 2016 → turns 10 before Aug 1 2026
    expect(calculateLeagueAge('2016-06-01', 7)).toBe(10);
  });

  it('returns N/A for empty input', () => {
    expect(calculateLeagueAge('')).toBe('N/A');
  });
});
