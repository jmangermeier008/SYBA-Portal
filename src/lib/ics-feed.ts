/**
 * Multi-event iCalendar feed generation for the subscribable calendar route.
 * Single-event browser downloads live in src/lib/ics.ts — this module is
 * server-only and emits a full VCALENDAR with TZID-anchored local times.
 */

export interface FeedEvent {
  teamId: string;
  gameId: string;
  teamName: string;
  type: 'Game' | 'Practice';
  /** Naive Eastern-local datetime, e.g. "2026-05-01T18:00:00" — never UTC. */
  dateTime: string;
  /** HH:MM local end time on the same day; absent → 2-hour default duration. */
  endTime?: string;
  opponentName?: string;
  location?: string;
  cancelled?: boolean;
  cancellationReason?: string;
}

const TZID = 'America/New_York';

// EST/EDT transition rules are stable (2nd Sunday March / 1st Sunday November),
// so a static VTIMEZONE block is correct indefinitely.
const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  `TZID:${TZID}`,
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0500',
  'TZOFFSETTO:-0400',
  'TZNAME:EDT',
  'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0400',
  'TZOFFSETTO:-0500',
  'TZNAME:EST',
  'DTSTART:19701101T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

/** Escapes text per RFC 5545 §3.3.11 (backslash, semicolon, comma, newline). */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Folds a content line at 74 octets with CRLF + space continuation (RFC 5545 §3.1). */
function foldLine(line: string): string {
  if (line.length <= 74) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 74));
  rest = rest.slice(74);
  while (rest.length > 0) {
    parts.push(' ' + rest.slice(0, 73));
    rest = rest.slice(73);
  }
  return parts.join('\r\n');
}

/** "2026-05-01T18:00:00" → "20260501T180000" (keeps local wall time). */
function toIcsLocal(naive: string): string {
  return naive.slice(0, 19).replace(/[-:]/g, '');
}

/** Adds hours to a naive local datetime string without timezone conversion. */
function addHoursNaive(naive: string, hours: number): string {
  const [datePart, timePart = '00:00:00'] = naive.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm, ss = 0] = timePart.split(':').map(Number);
  // Date is used purely for component arithmetic; the zone never leaks out
  // because we read the components straight back.
  const dt = new Date(y, m - 1, d, hh + hours, mm, ss);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
}

function buildEvent(ev: FeedEvent, dtstamp: string): string[] {
  const summaryBase = ev.type === 'Game'
    ? `${ev.teamName} vs ${ev.opponentName || 'TBD'}`
    : `${ev.teamName} Practice`;
  const summary = ev.cancelled ? `[CANCELLED] ${summaryBase}` : summaryBase;
  const end = ev.endTime
    ? `${ev.dateTime.slice(0, 10)}T${ev.endTime}:00`
    : addHoursNaive(ev.dateTime, 2);
  const lines = [
    'BEGIN:VEVENT',
    `UID:${ev.teamId}-${ev.gameId}@sybaportal`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;TZID=${TZID}:${toIcsLocal(ev.dateTime)}`,
    `DTEND;TZID=${TZID}:${toIcsLocal(end)}`,
    `SUMMARY:${escapeText(summary)}`,
  ];
  if (ev.location) lines.push(`LOCATION:${escapeText(ev.location)}`);
  if (ev.cancelled && ev.cancellationReason) {
    lines.push(`DESCRIPTION:${escapeText(`Cancelled: ${ev.cancellationReason}`)}`);
  }
  lines.push(`STATUS:${ev.cancelled ? 'CANCELLED' : 'CONFIRMED'}`);
  lines.push('END:VEVENT');
  return lines;
}

/**
 * Builds a complete VCALENDAR feed. Events must carry naive Eastern-local
 * dateTime strings (the team-subcollection format); they are emitted with
 * TZID so subscribers in any timezone see the correct wall-clock time.
 */
export function buildCalendarFeed(events: FeedEvent[], calendarName: string): string {
  const dtstamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SYBA Portal//Calendar Feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    `X-WR-TIMEZONE:${TZID}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    ...VTIMEZONE,
  ];
  for (const ev of events) {
    if (!ev.dateTime || ev.dateTime.length < 16) continue;
    lines.push(...buildEvent(ev, dtstamp));
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
