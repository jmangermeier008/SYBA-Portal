import { describe, it, expect } from 'vitest';
import { depositLabel, isDepositMissing } from '@/lib/deposit';

describe('depositLabel', () => {
  it('labels each known state', () => {
    expect(depositLabel('held')).toBe('Deposit held');
    expect(depositLabel('returned')).toBe('Deposit returned');
  });

  it('labels an absent status as "No deposit"', () => {
    expect(depositLabel(undefined)).toBe('No deposit');
  });
});

describe('isDepositMissing', () => {
  it('is true only when no check was ever received', () => {
    expect(isDepositMissing(undefined)).toBe(true);
  });

  it('is false when the league holds the check', () => {
    expect(isDepositMissing('held')).toBe(false);
  });

  it('is false once the check has been handed back — the family did pay', () => {
    expect(isDepositMissing('returned')).toBe(false);
  });
});
