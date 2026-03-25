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
  'Umpire Coordinator',
  'Tee Ball Coordinator',
  'Coach Pitch Coordinator',
  'Kid Pitch Coordinator',
  'Senior Division Coordinator',
] as const;

export type OfficerTitle = typeof OFFICER_TITLES[number];

export interface OfficerEntry {
  title: OfficerTitle;
  name: string | null;
}

export const OFFICERS: OfficerEntry[] = [
  { title: 'President', name: 'John Heutsche' },
  { title: 'Vice President', name: 'Tom Roskos' },
  { title: 'Treasurer', name: 'Don Nelson' },
  { title: 'Secretary', name: 'Russ Adkins' },
];

export const COORDINATORS: OfficerEntry[] = [
  { title: 'Building/Grounds Committee Chair', name: null },
  { title: 'Competition Committee Chair', name: null },
  { title: 'Finance Committee Chair', name: null },
  { title: 'Equipment Coordinator', name: null },
  { title: 'Umpire Coordinator', name: null },
  { title: 'Tee Ball Coordinator', name: null },
  { title: 'Coach Pitch Coordinator', name: null },
  { title: 'Kid Pitch Coordinator', name: null },
  { title: 'Senior Division Coordinator', name: null },
];
