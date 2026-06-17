export const EXECUTIVE_TITLES: readonly string[] = [
  'President',
  'Vice President',
  'Treasurer',
  'Secretary',
];

export const OFFICER_TITLES = [
  'President',
  'Vice President',
  'Treasurer',
  'Secretary',
  'Building/Grounds Committee Chair',
  'Competition Committee Chair',
  'Finance Committee Chair',
  'Equipment Coordinator',
  // Baseball-specific
  'Umpire Coordinator',
  'Tee Ball Coordinator',
  'Coach Pitch Coordinator',
  'Kid Pitch Coordinator',
  'Senior Division Coordinator',
  // Football-specific
  'Referee Coordinator',
  '8U Coordinator',
  'Flag Division Coordinator',
  'Tackle Division Coordinator',
  // Shared
  'At-Large Board Member',
] as const;

// Titles are now admin-editable per sport (stored on the `officers` collection), so this
// is a free-form string. The OFFICER_TITLES / EXECUTIVE_TITLES / *_COORDINATORS lists below
// remain only as first-run seed defaults.
export type OfficerTitle = string;

export interface OfficerEntry {
  title: OfficerTitle;
  name: string | null;
  /** Which sport this title applies to. Omit for shared/executive roles. */
  sport?: 'baseball' | 'football';
}

export const OFFICERS: OfficerEntry[] = [
  { title: 'President', name: 'John Heutsche' },
  { title: 'Vice President', name: 'Tom Roskos' },
  { title: 'Treasurer', name: 'Don Nelson' },
  { title: 'Secretary', name: 'Russ Adkins' },
];

/** Shared coordinators that apply to both sports */
const SHARED_COORDINATORS: OfficerEntry[] = [
  { title: 'Building/Grounds Committee Chair', name: null },
  { title: 'Competition Committee Chair', name: null },
  { title: 'Finance Committee Chair', name: null },
  { title: 'Equipment Coordinator', name: null },
];

/** Baseball-specific coordinators */
export const BASEBALL_COORDINATORS: OfficerEntry[] = [
  ...SHARED_COORDINATORS,
  { title: 'Umpire Coordinator', name: null, sport: 'baseball' },
  { title: 'Tee Ball Coordinator', name: null, sport: 'baseball' },
  { title: 'Coach Pitch Coordinator', name: null, sport: 'baseball' },
  { title: 'Kid Pitch Coordinator', name: null, sport: 'baseball' },
  { title: 'Senior Division Coordinator', name: null, sport: 'baseball' },
];

/** Football-specific coordinators */
export const FOOTBALL_COORDINATORS: OfficerEntry[] = [
  ...SHARED_COORDINATORS,
  { title: 'Referee Coordinator', name: null, sport: 'football' },
  { title: '8U Coordinator', name: null, sport: 'football' },
  { title: 'Flag Division Coordinator', name: null, sport: 'football' },
  { title: 'Tackle Division Coordinator', name: null, sport: 'football' },
];

/**
 * Returns the coordinator list for the given sport.
 * Falls back to baseball for backward compatibility.
 */
export function getCoordinators(sport?: string): OfficerEntry[] {
  if (sport === 'football') return FOOTBALL_COORDINATORS;
  return BASEBALL_COORDINATORS;
}

/** @deprecated Use getCoordinators(sport) instead */
export const COORDINATORS: OfficerEntry[] = BASEBALL_COORDINATORS;

export const AT_LARGE_BOARD_MEMBERS: OfficerEntry[] = [
  { title: 'At-Large Board Member', name: 'Mandy Alfredo' },
  { title: 'At-Large Board Member', name: 'Andy Barabas' },
  { title: 'At-Large Board Member', name: 'Jared Grandy' },
  { title: 'At-Large Board Member', name: 'Evan LaVanish' },
  { title: 'At-Large Board Member', name: 'Evan Leary' },
  { title: 'At-Large Board Member', name: 'Ken Rodgers' },
  { title: 'At-Large Board Member', name: 'John Vasconi' },
  { title: 'At-Large Board Member', name: 'Ryan Voisey' },
  { title: 'At-Large Board Member', name: 'Mike Wilson' },
];
