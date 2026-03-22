/**
 * Generates an ICS (iCalendar) string for a single calendar event.
 * Defaults end time to 2 hours after start if not provided.
 * @param event - title, start Date, optional end Date, location, description
 * @returns ICS file content as a string (VCALENDAR format)
 */
export function generateICS(event: {
  title: string;
  start: Date;
  end?: Date;
  location?: string;
  description?: string;
}): string {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const end = event.end ?? new Date(event.start.getTime() + 2 * 60 * 60 * 1000);
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SYBA Portal//EN',
    'BEGIN:VEVENT',
    `DTSTART:${fmt(event.start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${event.title}`,
    event.location ? `LOCATION:${event.location}` : '',
    event.description ? `DESCRIPTION:${event.description}` : '',
    `UID:${crypto.randomUUID()}@syba`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
}

/**
 * Triggers a browser download of an ICS calendar file.
 * @param ics - ICS file content string from generateICS()
 * @param filename - Download filename (default: 'event.ics')
 */
export function downloadICS(ics: string, filename = 'event.ics') {
  const blob = new Blob([ics], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
