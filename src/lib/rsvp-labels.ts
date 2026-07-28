/**
 * The single source of truth for RSVP wording — mirroring how src/lib/rsvp.ts
 * is the single writer for RSVP docs.
 *
 * Before this existed the app had thirteen vocabularies for three states
 * ("in/out", "going/no", "Yes/No", "I'll be there", "confirmed"...), sometimes
 * two of them on one screen. Every user-visible RSVP string must come from
 * here so parents and coaches read the same words.
 *
 * Stored values stay 'Attending' | 'Maybe' | 'Not Attending' (src/lib/rsvp.ts)
 * — this module only controls how they're displayed.
 */
import type { RsvpStatus } from '@/lib/rsvp';
import type { RsvpTally } from '@/hooks/use-rsvp-tallies';

/** The order options are always offered and counts are always listed in. */
export const RSVP_ORDER: RsvpStatus[] = ['Attending', 'Maybe', 'Not Attending'];

/** Button and badge label for a stored status. */
export const RSVP_LABEL: Record<RsvpStatus, string> = {
  'Attending': 'Going',
  'Maybe': 'Maybe',
  'Not Attending': "Can't make it",
};

/** Lowercase noun used inside count rows: "8 going · 1 maybe · 2 can't". */
export const RSVP_COUNT_NOUN: Record<RsvpStatus, string> = {
  'Attending': 'going',
  'Maybe': 'maybe',
  'Not Attending': "can't",
};

export const NO_REPLY_LABEL = 'No reply';

/**
 * The one count string.
 *
 * Never returns empty — "nobody has replied yet" is the most actionable state
 * a coach can be in, and hiding it (the old behavior) was backwards.
 *
 * With a roster:    "0 of 12 replied" · "8 going · 1 maybe · 3 no reply"
 * Without a roster: "8 going · 1 maybe · 2 can't" (custom events have no
 *                   invitee list, so there is no "no reply" to report)
 */
export function formatTally(tally: RsvpTally, rosterCount?: number): string {
  const hasRoster = rosterCount != null && rosterCount > 0;
  const noReply = hasRoster ? Math.max(0, rosterCount - tally.responded) : 0;

  if (tally.responded === 0) {
    return hasRoster ? `0 of ${rosterCount} replied` : 'No replies yet';
  }

  const parts: string[] = [];
  if (tally.attending > 0) parts.push(`${tally.attending} ${RSVP_COUNT_NOUN['Attending']}`);
  if (tally.maybe > 0) parts.push(`${tally.maybe} ${RSVP_COUNT_NOUN['Maybe']}`);
  if (tally.notAttending > 0) parts.push(`${tally.notAttending} ${RSVP_COUNT_NOUN['Not Attending']}`);
  if (noReply > 0) parts.push(`${noReply} no reply`);

  // Everyone replied — lead with that so the coach knows the count is complete.
  if (hasRoster && noReply === 0) {
    return `${rosterCount} of ${rosterCount} replied · ${parts.join(' · ')}`;
  }
  return parts.join(' · ');
}

/** Short "8 of 12 replied" summary for tight spots (admin game rows). */
export function formatRepliedRatio(tally: RsvpTally, rosterCount?: number): string {
  if (rosterCount == null || rosterCount === 0) return `${tally.responded} replied`;
  return `${tally.responded} of ${rosterCount} replied`;
}

/**
 * True when an upcoming event needs chasing — fewer than half the roster has
 * replied. Drives the calendar tile dot.
 */
export function needsAttention(tally: RsvpTally | undefined, rosterCount: number | undefined): boolean {
  if (rosterCount == null || rosterCount === 0) return false;
  return (tally?.responded ?? 0) * 2 < rosterCount;
}
