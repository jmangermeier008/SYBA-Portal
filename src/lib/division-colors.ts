/**
 * Division color assignment shared by every calendar surface (admin, coach,
 * parent). One deterministic map — sorted by division name before indexing
 * into the palette — so "Pee Wees" is the same color on every page. Keyed by
 * division id.
 */

export const DIVISION_COLOR_PALETTE = [
  '#3b82f6', // blue-500
  '#a855f7', // purple-500
  '#6366f1', // indigo-500
  '#f59e0b', // amber-500
  '#10b981', // emerald-500
  '#ef4444', // red-500
  '#ec4899', // pink-500
  '#14b8a6', // teal-500
];

/** divisionId → hex color. Sorts by name so query order can't shift colors. */
export function buildDivisionColorMap(
  divisions: { id: string; name?: string }[] | null | undefined,
): Record<string, string> {
  if (!divisions || divisions.length === 0) return {};
  const sorted = [...divisions].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  return Object.fromEntries(
    sorted.map((div, i) => [div.id, DIVISION_COLOR_PALETTE[i % DIVISION_COLOR_PALETTE.length]])
  );
}
