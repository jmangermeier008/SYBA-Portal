import { describe, it, expect } from 'vitest';
import { recertYear, recertState, type ShedItem } from '@/lib/equipment';

const NOW = new Date().getFullYear();

function item(overrides: Partial<ShedItem> = {}): ShedItem {
  return {
    id: 'i1',
    tagNumber: '12',
    type: 'helmet',
    size: 'M',
    status: 'available',
    ...overrides,
  };
}

describe('recertYear', () => {
  it('reads the new "YYYY" format', () => {
    expect(recertYear('2025')).toBe(2025);
  });

  it('reads the legacy "YYYY-MM-DD" format', () => {
    expect(recertYear('2025-06-01')).toBe(2025);
  });

  it('returns null for missing or unparseable values', () => {
    expect(recertYear(undefined)).toBeNull();
    expect(recertYear('')).toBeNull();
    expect(recertYear('not-a-year')).toBeNull();
  });
});

describe('recertState', () => {
  it('returns null for types with no recert obligation', () => {
    expect(recertState(item({ type: 'game_jersey', purchaseYear: 1990 }))).toBeNull();
    expect(recertState(item({ type: 'practice_pants' }))).toBeNull();
  });

  it('applies to both helmets and shoulder pads', () => {
    expect(recertState(item({ type: 'helmet' }))).toBe('no-record');
    expect(recertState(item({ type: 'shoulder_pads' }))).toBe('no-record');
  });

  it('flags retirement past the 10-year service life, ahead of recert', () => {
    // A fresh recert does not extend service life — retirement wins.
    expect(recertState(item({ purchaseYear: NOW - 10, lastRecertDate: String(NOW) }))).toBe('retire');
    expect(recertState(item({ purchaseYear: NOW - 11 }))).toBe('retire');
  });

  it('does not retire an item still inside its service life', () => {
    expect(recertState(item({ purchaseYear: NOW - 9, lastRecertDate: String(NOW) }))).toBe('ok');
  });

  it('reports no-record when neither date is present', () => {
    expect(recertState(item())).toBe('no-record');
  });

  it('flags recert due at the 2-year boundary, measured from the last recert', () => {
    expect(recertState(item({ lastRecertDate: String(NOW - 2) }))).toBe('due');
    expect(recertState(item({ lastRecertDate: String(NOW - 1) }))).toBe('ok');
    expect(recertState(item({ lastRecertDate: String(NOW) }))).toBe('ok');
  });

  it('falls back to the purchase year when there is no recert record', () => {
    expect(recertState(item({ purchaseYear: NOW - 3 }))).toBe('due');
    expect(recertState(item({ purchaseYear: NOW - 1 }))).toBe('ok');
  });

  it('prefers the recert year over the purchase year', () => {
    // Bought 5 years ago but reconditioned this year — not due.
    expect(recertState(item({ purchaseYear: NOW - 5, lastRecertDate: String(NOW) }))).toBe('ok');
  });
});
