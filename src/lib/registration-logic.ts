/**
 * Registration Logic — Dynamic Age & Division Utilities
 *
 * Provides age calculation tied to a season's specific cutoff date
 * and division suggestion/validation based on that age.
 */

import { differenceInYears } from 'date-fns';
import type { Division } from '@/types/scheduling';

/**
 * Calculate a player's "league age" as of a season-specific cutoff date.
 *
 * Baseball age convention: the player's age on the cutoff date determines
 * which division they are eligible for. Pass the season's `ageCutoffDate`
 * (YYYY-MM-DD) so each season can have its own cutoff.
 *
 * Falls back to May 1 of the current year if no cutoff date is provided,
 * matching the existing `calculateLeagueAge` behavior in utils.ts.
 *
 * @param dob            Player date of birth — YYYY-MM-DD
 * @param ageCutoffDate  Season cutoff date — YYYY-MM-DD (optional)
 * @returns              League age as a number, or 'N/A' on invalid input
 */
export function getLeagueAge(dob: string, ageCutoffDate?: string): number | 'N/A' {
  if (!dob) return 'N/A';
  try {
    let cutoff: Date;
    if (ageCutoffDate) {
      // Parse cutoff date at noon to avoid timezone edge cases
      const [year, month, day] = ageCutoffDate.split('-').map(Number);
      cutoff = new Date(year, month - 1, day, 12, 0, 0);
    } else {
      // Default: May 1 of the current year (baseball convention)
      cutoff = new Date(new Date().getFullYear(), 4, 1, 12, 0, 0);
    }
    const dobDate = new Date(dob);
    if (isNaN(dobDate.getTime())) return 'N/A';
    return differenceInYears(cutoff, dobDate);
  } catch {
    return 'N/A';
  }
}

/**
 * Return the divisions that match a given league age.
 *
 * A division matches if:
 *  - Both `minAge` and `maxAge` are set → age must fall within [minAge, maxAge]
 *  - Only `minAge` is set → age must be >= minAge
 *  - Only `maxAge` is set → age must be <= maxAge
 *  - Neither is set → division has no age restriction, always included
 *
 * @param age       League age from getLeagueAge()
 * @param divisions All divisions for the selected season
 * @returns         Subset of divisions appropriate for the age, sorted by minAge
 */
export function getSuggestedDivisions(
  age: number | 'N/A',
  divisions: Division[],
): Division[] {
  if (age === 'N/A' || divisions.length === 0) return divisions;

  const matched = divisions.filter((d) => {
    const hasMin = d.minAge !== undefined && d.minAge !== null;
    const hasMax = d.maxAge !== undefined && d.maxAge !== null;
    if (!hasMin && !hasMax) return true;           // no restriction
    if (hasMin && hasMax) return age >= d.minAge! && age <= d.maxAge!;
    if (hasMin) return age >= d.minAge!;
    return age <= d.maxAge!;
  });

  // If no divisions matched age criteria, return all (graceful fallback)
  if (matched.length === 0) return divisions;

  return matched.sort((a, b) => (a.minAge ?? 0) - (b.minAge ?? 0));
}

/**
 * Returns an array of per-player registration fees (in cents) applying sibling pricing.
 * The first payable player in the season pays their division's configured fee. Each
 * subsequent player (counting prior paid/fee-waived enrollments this season) pays the
 * season's flat sibling fee — but never more than their own division fee.
 *
 * @param pastPaidEnrollmentsCount  Already-paid/fee-waived enrollments for this family in the season.
 * @param itemFees                  Division fee (cents) for each payable player, in cart order.
 * @param siblingFeeCents           Season's flat sibling fee in cents (default 5000 = $50).
 * @returns                         Array of fees in cents, aligned with itemFees order.
 */
export function calculateCartPricing(
  pastPaidEnrollmentsCount: number,
  itemFees: number[],
  siblingFeeCents: number = 5000,
): number[] {
  return itemFees.map((fee, i) => {
    const totalPrior = pastPaidEnrollmentsCount + i;
    return totalPrior === 0 ? fee : Math.min(fee, siblingFeeCents);
  });
}
