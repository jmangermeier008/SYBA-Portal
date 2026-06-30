import { format } from 'date-fns';
import type {
  CalendarEvent,
  CustomEvent,
  VolunteerShiftType,
} from '@/types/scheduling';

/**
 * Minimal structural shape buildConcessionEvents needs. Kept independent of the canonical
 * ConcessionSlot so callers with a narrower local slot type (e.g. parent/volunteers) work too.
 */
export interface ConcessionSlotLike {
  id: string;
  type?: VolunteerShiftType;
  gameId?: string;
  eventId?: string;
  gameDate: string;
  startTime: string;
  endTime: string;
  capacity: number;
  signups?: { parentUserId: string }[];
}

// ─── Volunteer / concession shifts ──────────────────────────────────────────

// Display labels for volunteer shift types. Missing type = legacy concession shift.
export const TYPE_LABELS: Record<VolunteerShiftType, string> = {
  concessions: 'Concessions',
  tagging: 'Tagging',
  fundraiser: 'Fundraiser',
  chains: 'Chains',
  maintenance: 'Maintenance',
};

export function fmtTime(t: string): string {
  return format(new Date(`1970-01-01T${t}`), 'h:mm a');
}

/**
 * Combine volunteer slots into one calendar entry per (event, shift-type). Shifts that
 * belong to the same game/auto-generated event (shared gameId/eventId) collapse into a
 * single pill spanning the full time range; genuinely separate standalone shifts each
 * keep their own pill so the calendar stays readable. A single shift shows just the type
 * label; multiple shifts show the label plus the combined span.
 *
 * `userId` is optional — when provided, `isSigned` reflects whether that user is signed up
 * to any shift in the group (parent-facing views); admin views can omit it.
 */
export function buildConcessionEvents(slots: ConcessionSlotLike[], userId?: string): CalendarEvent[] {
  const groups = new Map<string, ConcessionSlotLike[]>();
  for (const s of slots) {
    const type = s.type ?? 'concessions';
    // Group by event only — standalone shifts (no gameId/eventId) stay separate.
    const groupId = s.gameId || s.eventId || `standalone-${s.id}`;
    const key = `${groupId}__${type}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(s);
    else groups.set(key, [s]);
  }

  const events: CalendarEvent[] = [];
  for (const bucket of groups.values()) {
    const sorted = [...bucket].sort((a, b) => a.startTime.localeCompare(b.startTime));
    const first = sorted[0];
    const typeLabel = TYPE_LABELS[first.type ?? 'concessions'];
    const startTime = sorted[0].startTime;
    const endTime = sorted.reduce((max, s) => (s.endTime > max ? s.endTime : max), sorted[0].endTime);
    const title =
      sorted.length > 1 ? `${typeLabel} · ${fmtTime(startTime)} – ${fmtTime(endTime)}` : typeLabel;

    events.push({
      id: first.id,
      eventType: 'concession',
      date: first.gameDate,
      startTime,
      endTime,
      title,
      status: 'active',
      sourceType: 'concession-slot',
      sourceId: first.id,
      capacity: bucket.reduce((sum, s) => sum + (s.capacity ?? 0), 0),
      claimedCount: bucket.reduce((sum, s) => sum + (s.signups?.length ?? 0), 0),
      isSigned: userId
        ? bucket.some(s => s.signups?.some(su => su.parentUserId === userId))
        : undefined,
    });
  }
  return events;
}

// ─── Generic custom events ──────────────────────────────────────────────────

export function normalizeCustomEvent(e: CustomEvent): CalendarEvent {
  return {
    id: e.id,
    eventType: 'event',
    date: e.date,
    startTime: e.startTime || '00:00',
    endTime: e.endTime,
    title: e.title,
    status: e.status === 'cancelled' ? 'cancelled' : 'scheduled',
    fieldName: e.location,
    notes: e.notes,
    sourceType: 'custom-event',
    sourceId: e.id,
    teamId: e.teamId,
    teamName: e.teamName,
    createdByUid: e.createdByUid,
  };
}

/**
 * Restrict custom events to what a viewer should see. Admins (including coach+admin) see
 * everything; everyone else sees league-wide events plus team-scoped events for any of
 * their teams (coach's assigned teams, or a parent's enrolled players' teams).
 */
export function visibleCustomEvents(
  events: CustomEvent[],
  { isAdmin, teamIds }: { isAdmin: boolean; teamIds: string[] },
): CustomEvent[] {
  if (isAdmin) return events;
  return events.filter(
    e => e.visibility === 'all' || (!!e.teamId && teamIds.includes(e.teamId)),
  );
}
