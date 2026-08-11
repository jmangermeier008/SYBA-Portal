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

export type ClearanceState = 'missing' | 'rejected' | 'pending' | 'approved';

/**
 * Resolves a clearance record to the state the UI should render.
 *
 * Status only, deliberately. The expiration date is a fact a reviewer records
 * off the document — it never computes a verdict on its own. An earlier version
 * ranked expiry above status, which made approving an expired document change
 * nothing on screen and left admins with no way to correct a date.
 */
export function clearanceState(c: Pick<Clearance, 'status'> | undefined): ClearanceState {
  if (!c) return 'missing';
  if (c.status === 'Rejected') return 'rejected';
  if (c.status !== 'Approved') return 'pending';
  return 'approved';
}

/** Short text for the expiration line under a status icon — plain information. */
export function clearanceExpiryText(c: Pick<Clearance, 'expirationDate'> | undefined): string {
  if (!c) return '—';
  return c.expirationDate || 'no date';
}

/**
 * Guards the date every writer stores. `<input type="date">` will happily emit
 * a two-digit year as `0027-06-30`, or a six-digit one as `20257-06-30`, and
 * nothing downstream would flag either as nonsense.
 */
export function isValidExpirationDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  if (year < 1900 || year > 2200) return false;
  // Rejects impossible days like 2027-02-31, which Date silently rolls over.
  const [y, m, d] = value.split('-').map(Number);
  const parsed = new Date(y, m - 1, d);
  return parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d;
}
