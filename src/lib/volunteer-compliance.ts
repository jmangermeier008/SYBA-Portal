/**
 * Family volunteer-compliance math for football.
 *
 * Football families must complete BOTH a concession shift AND a tagging shift
 * per enrolled player (see FOOTBALL_PER_PLAYER_REQUIREMENTS). "Worked"
 * (admin-confirmed) attendance is what ultimately counts; signed-up-but-
 * unconfirmed spots surface as "pending" so the family still gets credit toward
 * the target in progress views.
 *
 * Extracted from parent/volunteers so both that page and the parent-dashboard
 * tracker card compute compliance from one implementation.
 */
import {
  FOOTBALL_PER_PLAYER_REQUIREMENTS,
  VOLUNTEER_TYPES_COUNTING_TOWARD_REQUIREMENT,
  type VolunteerShiftType,
} from '@/types/scheduling';

/** Only these two types have per-player football requirements. */
export type CountingShiftType = 'concessions' | 'tagging';

/** Minimal structural shape of a concession/volunteer slot this math reads. */
export interface ComplianceSlotLike {
  type?: VolunteerShiftType;
  status?: 'active' | 'cancelled' | string;
  signups?: Array<{ parentUserId: string; attendance?: 'pending' | 'worked' | 'no-show' }>;
}

export interface TypeProgress {
  worked: number;
  pending: number;
  required: number;
}

export interface FamilyFootballCompliance {
  concessions: TypeProgress;
  tagging: TypeProgress;
  /** worked + pending across both counting types */
  claimedTotal: number;
  /** sum of required across both counting types */
  targetTotal: number;
  /** True when the family has met (worked) every per-type requirement. */
  isComplete: boolean;
  /** True when no active slots exist in the system yet — the "opening soon" state. */
  locked: boolean;
}

/**
 * Normalize a slot's type to one of the two counting buckets, or null if the
 * shift doesn't count toward the requirement. Absent type = legacy concessions.
 */
function countingTypeOf(type: VolunteerShiftType | undefined): CountingShiftType | null {
  const t = type ?? 'concessions';
  return (VOLUNTEER_TYPES_COUNTING_TOWARD_REQUIREMENT as VolunteerShiftType[]).includes(t)
    ? (t as CountingShiftType)
    : null;
}

/**
 * Compute a family's football volunteer compliance.
 *
 * @param slots               All concession/volunteer slots for the sport/season.
 * @param enrolledPlayerCount Number of the family's active enrolled players.
 * @param parentUserId        The signed-in parent's uid.
 */
export function computeFamilyFootballCompliance(
  slots: ComplianceSlotLike[] | null | undefined,
  enrolledPlayerCount: number,
  parentUserId: string | undefined,
): FamilyFootballCompliance {
  const all = slots ?? [];
  const requiredPer = (type: CountingShiftType) =>
    enrolledPlayerCount * (FOOTBALL_PER_PLAYER_REQUIREMENTS[type] ?? 1);

  const tally = (type: CountingShiftType): TypeProgress => {
    let worked = 0;
    let pending = 0;
    for (const s of all) {
      if (countingTypeOf(s.type) !== type) continue;
      for (const su of s.signups ?? []) {
        if (su.parentUserId !== parentUserId) continue;
        if (su.attendance === 'worked') worked++;
        else if (su.attendance !== 'no-show') pending++;
      }
    }
    return { worked, pending, required: requiredPer(type) };
  };

  const concessions = tally('concessions');
  const tagging = tally('tagging');

  const claimedTotal =
    concessions.worked + concessions.pending + tagging.worked + tagging.pending;
  const targetTotal = concessions.required + tagging.required;

  // Complete only when confirmed-worked shifts meet every per-type requirement.
  const isComplete =
    concessions.worked >= concessions.required && tagging.worked >= tagging.required;

  // Locked until the league publishes at least one active shift to claim.
  const locked = all.every(s => s.status && s.status !== 'active') || all.length === 0;

  return { concessions, tagging, claimedTotal, targetTotal, isComplete, locked };
}
