/**
 * Volunteer deposit check — football. A family writes a check that the league
 * holds until their volunteer shifts are met, then returns it. Admin-ticked on
 * /admin/registration and surfaced read-only on the equipment pages, where "no
 * check received" is the signal not to hand gear out.
 *
 * Shared so the registration and equipment surfaces can't drift on wording.
 * The status field lives on the enrollment doc
 * (`userProfiles/{parentUserId}/enrollments/{id}.volunteerDepositStatus`);
 * an ABSENT status means no check has ever been received.
 */

export type DepositStatus = 'held' | 'returned';

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
