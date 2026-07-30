/**
 * Volunteer deposit check — football. A family writes a check that the league
 * holds until their volunteer shifts are met, then returns it. Admin-ticked on
 * /admin/registration and on /admin/equipment, where the check usually changes
 * hands: "no check received" is the signal not to hand gear out.
 *
 * Shared so those two surfaces can't drift on wording or on which fields a
 * transition writes. The status field lives on the enrollment doc
 * (`userProfiles/{parentUserId}/enrollments/{id}.volunteerDepositStatus`);
 * an ABSENT status means no check has ever been received.
 */

import { deleteField } from 'firebase/firestore';

export type DepositStatus = 'held' | 'returned';

/** All seven deposit fields, in the order they're documented on Enrollment. */
const DEPOSIT_FIELDS = [
  'volunteerDepositStatus',
  'volunteerDepositReceivedAt',
  'volunteerDepositReceivedBy',
  'volunteerDepositReceivedByName',
  'volunteerDepositReturnedAt',
  'volunteerDepositReturnedBy',
  'volunteerDepositReturnedByName',
] as const;

/**
 * Firestore update map for moving an enrollment to `next`. Pass `null` to clear
 * a deposit ticked by mistake — that removes the fields entirely so the doc
 * looks exactly like one that never had a deposit, per the type's
 * "absent = not received" contract.
 */
export function buildDepositUpdate(
  next: DepositStatus | null,
  actor: { uid: string; name: string }
): Record<string, unknown> {
  const now = new Date().toISOString();
  const update: Record<string, unknown> = { updatedAt: now };

  if (next === 'held') {
    update.volunteerDepositStatus = 'held';
    update.volunteerDepositReceivedAt = now;
    update.volunteerDepositReceivedBy = actor.uid;
    update.volunteerDepositReceivedByName = actor.name;
    // Re-receiving after a return starts a fresh cycle
    update.volunteerDepositReturnedAt = deleteField();
    update.volunteerDepositReturnedBy = deleteField();
    update.volunteerDepositReturnedByName = deleteField();
  } else if (next === 'returned') {
    update.volunteerDepositStatus = 'returned';
    update.volunteerDepositReturnedAt = now;
    update.volunteerDepositReturnedBy = actor.uid;
    update.volunteerDepositReturnedByName = actor.name;
  } else {
    for (const field of DEPOSIT_FIELDS) update[field] = deleteField();
  }

  return update;
}

/** Toast copy for a completed transition — identical on every surface. */
export function depositToastCopy(next: DepositStatus | null): { title: string; description: string } {
  if (next === 'held') {
    return { title: 'Deposit Recorded', description: 'The check is marked as held by the league.' };
  }
  if (next === 'returned') {
    return { title: 'Deposit Returned', description: 'The check is marked as returned to the family.' };
  }
  return { title: 'Deposit Cleared', description: 'No deposit is on file for this registration.' };
}

/** Display label for a deposit state. Absent status → "No deposit". */
export function depositLabel(status?: DepositStatus): string {
  if (status === 'held') return 'Deposit held';
  if (status === 'returned') return 'Deposit returned';
  return 'No deposit';
}

/** True when the league never received a check for this enrollment.
 *  Note `'returned'` is NOT missing — the family did pay; the check was
 *  handed back once their volunteer obligation was met. */
export function isDepositMissing(status?: DepositStatus): boolean {
  return !status;
}
