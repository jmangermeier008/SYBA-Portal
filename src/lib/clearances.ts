import type { Clearance } from '@/types/scheduling';

/**
 * The volunteer compliance documents SYBA tracks. This is the single source of
 * truth — the coach upload page, the admin audit table, and the bulk document
 * packet route all read from here.
 *
 * `required: true` marks the two PA Act 153 clearances that gate coach portal
 * access via userProfiles.complianceStatus. USA Football certification is
 * tracked but never blocks access.
 *
 * `aliases` covers document IDs written before the type names were normalized;
 * always look records up with findClearance() rather than a bare === match.
 */
export const CLEARANCE_TYPES = [
  {
    type: 'ChildAbuse',
    label: 'PA Child Abuse History Clearance',
    short: 'Child Abuse',
    description: 'Mandatory state background check.',
    required: true,
    aliases: ['child_abuse', 'childabuse'],
    filename: 'child-abuse-clearances.pdf',
  },
  {
    type: 'CriminalRecord',
    label: 'PA State Police Criminal Record Check',
    short: 'Criminal',
    description: 'State police criminal history report.',
    required: true,
    aliases: ['criminal', 'criminal_record', 'criminalrecord'],
    filename: 'criminal-record-checks.pdf',
  },
  {
    type: 'USAFootball',
    label: 'USA Football Coach Certification',
    short: 'USA Football',
    description: 'Annual USA Football coaching certification (football coaches).',
    required: false,
    aliases: ['usa_football', 'usafootball'],
    filename: 'usa-football-certs.pdf',
  },
] as const;

export type ClearanceType = (typeof CLEARANCE_TYPES)[number]['type'];

/** The two docs that gate coach portal access. */
export const REQUIRED_CLEARANCE_TYPES = CLEARANCE_TYPES.filter(c => c.required);

export function clearanceLabel(type: string): string {
  return CLEARANCE_TYPES.find(c => c.type === type)?.label ?? type;
}

export function isClearanceType(value: unknown): value is ClearanceType {
  return CLEARANCE_TYPES.some(c => c.type === value);
}

/** Alias-tolerant lookup of one volunteer's record for a given clearance type. */
export function findClearance<T extends { type?: string }>(
  records: T[] | undefined,
  type: ClearanceType
): T | undefined {
  const slot = CLEARANCE_TYPES.find(c => c.type === type);
  if (!slot) return undefined;
  const accepted = [slot.type.toLowerCase(), ...slot.aliases.map(a => a.toLowerCase())];
  return records?.find(r => accepted.includes((r.type ?? '').toLowerCase()));
}

export type ClearanceState =
  | 'missing'
  | 'rejected'
  | 'expired'
  | 'pending'
  | 'expiring'
  | 'approved';

/** Days before expiration that a clearance starts reading as "expiring soon". */
export const EXPIRING_SOON_DAYS = 60;

/**
 * Today as a naive local YYYY-MM-DD string, matching how expirationDate is
 * stored. Never derive this from toISOString() — that is UTC and lands on the
 * wrong day for evening use in US Eastern.
 */
export function todayLocalISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The same naive local date, offset by a number of days. */
export function addDaysLocalISO(days: number, now: Date = new Date()): string {
  const shifted = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return todayLocalISO(shifted);
}

/**
 * Resolves a clearance record to the single state the UI should render.
 *
 * Expiry outranks an Approved status: a document whose date has passed is
 * `expired` even though nobody revoked the approval. That is display-only —
 * complianceStatus and coach portal access are deliberately left alone, so an
 * expired volunteer is flagged for chasing rather than locked out mid-season.
 *
 * Both dates are compared as YYYY-MM-DD strings, which sorts correctly and
 * sidesteps timezone drift.
 */
export function clearanceState(
  c: Pick<Clearance, 'status' | 'expirationDate'> | undefined,
  today: string = todayLocalISO(),
  soonCutoff: string = addDaysLocalISO(EXPIRING_SOON_DAYS)
): ClearanceState {
  if (!c) return 'missing';
  if (c.status === 'Rejected') return 'rejected';
  if (c.expirationDate && c.expirationDate < today) return 'expired';
  if (c.status !== 'Approved') return 'pending';
  if (c.expirationDate && c.expirationDate < soonCutoff) return 'expiring';
  return 'approved';
}

/** True when the state still counts as good standing for the CLEARED badge. */
export function isClearanceOk(state: ClearanceState): boolean {
  return state === 'approved' || state === 'expiring';
}

/** Short text for the expiration line under a status icon. */
export function clearanceExpiryText(
  c: Pick<Clearance, 'expirationDate'> | undefined,
  state: ClearanceState
): string {
  if (state === 'missing') return '—';
  if (state === 'expired') return 'EXPIRED';
  return c?.expirationDate || 'no date';
}
