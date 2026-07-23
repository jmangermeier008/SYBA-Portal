/**
 * Shared weekly-recurrence date expansion, used by admin games (recurring
 * practices), admin practice slots, and the coach Schedule Practice dialog.
 * Extracted so all three flows generate identical date lists.
 */
import { format, parseISO, startOfDay, eachWeekOfInterval, addDays, isBefore, isAfter } from 'date-fns';

/** Safety cap on how many events one recurring series may create. */
export const MAX_RECURRENCE_DATES = 60;

/** Returns all dates between startDate and endDate (inclusive) that fall on the given weekday (0=Sun). */
export function getDatesForWeekday(startDate: string, endDate: string, weekday: number): string[] {
  if (!startDate || !endDate) return [];
  const start = startOfDay(parseISO(startDate));
  const end = startOfDay(parseISO(endDate));
  if (isAfter(start, end)) return [];
  const weeks = eachWeekOfInterval({ start, end }, { weekStartsOn: 0 });
  return weeks
    .map(weekStart => addDays(weekStart, weekday))
    .filter(d => !isBefore(d, start) && !isAfter(d, end))
    .map(d => format(d, 'yyyy-MM-dd'));
}

/** All dates in [startDate, endDate] falling on any of the given weekdays, deduped + sorted ascending. */
export function expandRecurrence(weekdays: number[], startDate: string, endDate: string): string[] {
  const all = new Set<string>();
  for (const wd of weekdays) {
    for (const d of getDatesForWeekday(startDate, endDate, wd)) all.add(d);
  }
  return Array.from(all).sort();
}
