import { describe, it, expect } from 'vitest';
import { getDatesForWeekday, expandRecurrence, MAX_RECURRENCE_DATES } from '@/lib/recurrence';
import { buildFootballPracticeSeriesDocs } from '@/lib/game-write';

describe('getDatesForWeekday', () => {
  // 2026-08-03 is a Monday, 2026-08-31 is a Monday.
  it('returns every matching weekday in the range, inclusive of both ends', () => {
    expect(getDatesForWeekday('2026-08-03', '2026-08-31', 1)).toEqual([
      '2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31',
    ]);
  });

  it('excludes weekday occurrences outside the range boundaries', () => {
    // Range starts Tue 08-04, so Mon 08-03 must not appear.
    expect(getDatesForWeekday('2026-08-04', '2026-08-30', 1)).toEqual([
      '2026-08-10', '2026-08-17', '2026-08-24',
    ]);
  });

  it('returns empty for a missing or inverted range', () => {
    expect(getDatesForWeekday('', '2026-08-31', 1)).toEqual([]);
    expect(getDatesForWeekday('2026-08-03', '', 1)).toEqual([]);
    expect(getDatesForWeekday('2026-08-31', '2026-08-03', 1)).toEqual([]);
  });

  it('handles a single-day range matching the weekday', () => {
    expect(getDatesForWeekday('2026-08-03', '2026-08-03', 1)).toEqual(['2026-08-03']);
    expect(getDatesForWeekday('2026-08-03', '2026-08-03', 2)).toEqual([]);
  });
});

describe('expandRecurrence', () => {
  it('unions multiple weekdays sorted ascending', () => {
    // Mon + Wed across two weeks starting Mon 2026-08-03.
    expect(expandRecurrence([3, 1], '2026-08-03', '2026-08-14')).toEqual([
      '2026-08-03', '2026-08-05', '2026-08-10', '2026-08-12',
    ]);
  });

  it('dedupes repeated weekdays and returns empty for no weekdays', () => {
    expect(expandRecurrence([1, 1], '2026-08-03', '2026-08-09')).toEqual(['2026-08-03']);
    expect(expandRecurrence([], '2026-08-03', '2026-08-31')).toEqual([]);
  });

  it('exposes a sane series cap', () => {
    expect(MAX_RECURRENCE_DATES).toBeGreaterThan(0);
  });
});

describe('buildFootballPracticeSeriesDocs', () => {
  const input = {
    seasonId: 's1',
    teamId: 't1',
    teamName: 'Pee Wees',
    time: '18:00',
    endTime: '19:30',
    fieldId: 'f1',
    fieldName: 'Main Field',
    createdByUid: 'coach1',
  };

  it('creates one doc pair per date with a unique shared id and one series recurrenceId', () => {
    const docs = buildFootballPracticeSeriesDocs(input, ['2026-08-03', '2026-08-05']);
    expect(docs).toHaveLength(2);
    const [a, b] = docs;
    expect(a.gameId).not.toEqual(b.gameId);
    expect((a.topLevel as any).recurrenceId).toEqual((b.topLevel as any).recurrenceId);
    expect((a.mirror as any).recurrenceId).toEqual((a.topLevel as any).recurrenceId);
    expect((a.topLevel as any).isRecurring).toBe(true);
    expect((a.mirror as any).isRecurring).toBe(true);
    expect(a.mirror.id).toEqual(a.gameId);
  });

  it('carries date, naive-local dateTime, and endTime into both shapes', () => {
    const [d] = buildFootballPracticeSeriesDocs(input, ['2026-08-03']);
    expect(d.topLevel.date).toBe('2026-08-03');
    expect(d.topLevel.time).toBe('18:00');
    expect((d.topLevel as any).endTime).toBe('19:30');
    expect(d.mirror.dateTime).toBe('2026-08-03T18:00:00');
    expect((d.mirror as any).endTime).toBe('19:30');
  });

  it('omits endTime entirely when not provided', () => {
    const { endTime: _endTime, ...noEnd } = input;
    const [d] = buildFootballPracticeSeriesDocs(noEnd, ['2026-08-03']);
    expect('endTime' in d.topLevel).toBe(false);
    expect('endTime' in d.mirror).toBe(false);
  });
});
