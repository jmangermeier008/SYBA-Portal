import { describe, it, expect } from 'vitest';
import { generateICS } from '@/lib/ics';

describe('generateICS', () => {
  const start = new Date('2026-05-01T18:00:00Z');

  it('produces a valid VCALENDAR with start, summary, and location', () => {
    const ics = generateICS({
      title: 'Tigers vs. Bears',
      start,
      location: 'Field 1',
      description: 'Bring water',
    });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics).toContain('DTSTART:20260501T180000Z');
    expect(ics).toContain('SUMMARY:Tigers vs. Bears');
    expect(ics).toContain('LOCATION:Field 1');
    expect(ics).toContain('DESCRIPTION:Bring water');
  });

  it('defaults the end time to two hours after the start', () => {
    const ics = generateICS({ title: 'Practice', start });
    expect(ics).toContain('DTEND:20260501T200000Z');
  });

  it('omits LOCATION and DESCRIPTION lines when not provided', () => {
    const ics = generateICS({ title: 'Practice', start });
    expect(ics).not.toContain('LOCATION:');
    expect(ics).not.toContain('DESCRIPTION:');
  });
});
