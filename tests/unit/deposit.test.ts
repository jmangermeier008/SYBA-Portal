import { describe, it, expect } from 'vitest';
import { deleteField } from 'firebase/firestore';
import { buildDepositUpdate, depositLabel, isDepositMissing } from '@/lib/deposit';

const ACTOR = { uid: 'admin-1', name: 'Jane Admin' };

/** deleteField() returns a fresh sentinel each call, so compare by identity of kind. */
const isDelete = (value: unknown) => deleteField().isEqual(value as any);

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

describe('buildDepositUpdate', () => {
  it('stamps who received the check and when', () => {
    const update = buildDepositUpdate('held', ACTOR);
    expect(update.volunteerDepositStatus).toBe('held');
    expect(update.volunteerDepositReceivedBy).toBe('admin-1');
    expect(update.volunteerDepositReceivedByName).toBe('Jane Admin');
    expect(update.volunteerDepositReceivedAt).toBe(update.updatedAt);
  });

  it('clears the old return stamps when a check is received again after a return', () => {
    const update = buildDepositUpdate('held', ACTOR);
    expect(isDelete(update.volunteerDepositReturnedAt)).toBe(true);
    expect(isDelete(update.volunteerDepositReturnedBy)).toBe(true);
    expect(isDelete(update.volunteerDepositReturnedByName)).toBe(true);
  });

  it('records a return without touching the received stamps', () => {
    const update = buildDepositUpdate('returned', ACTOR);
    expect(update.volunteerDepositStatus).toBe('returned');
    expect(update.volunteerDepositReturnedBy).toBe('admin-1');
    expect(update.volunteerDepositReturnedByName).toBe('Jane Admin');
    expect(update).not.toHaveProperty('volunteerDepositReceivedBy');
    expect(update).not.toHaveProperty('volunteerDepositReceivedAt');
  });

  it('deletes all seven fields when cleared, so the doc reads as "never received"', () => {
    const update = buildDepositUpdate(null, ACTOR);
    for (const field of [
      'volunteerDepositStatus',
      'volunteerDepositReceivedAt', 'volunteerDepositReceivedBy', 'volunteerDepositReceivedByName',
      'volunteerDepositReturnedAt', 'volunteerDepositReturnedBy', 'volunteerDepositReturnedByName',
    ]) {
      expect(isDelete(update[field])).toBe(true);
    }
  });

  it('always bumps updatedAt', () => {
    for (const next of ['held', 'returned', null] as const) {
      expect(typeof buildDepositUpdate(next, ACTOR).updatedAt).toBe('string');
    }
  });
});
