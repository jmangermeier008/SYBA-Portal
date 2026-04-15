import type { Sport } from '@/types/scheduling';
import { useSport } from '@/firebase/sport-context';

export const HUB_LOGO_URL = '/logo-hub.png';

export interface SportDivisionDefault {
  id: string;
  name: string;
  fee: number;
  capacity: number;
}

export interface SportConfig {
  label: string;
  icon: string;
  logoUrl: string;
  acronym: string;
  contactEmail: string; // public contact / reply-to address for this sport
  // Officials / Umpires
  umpireLabel: string;
  umpiresLabel: string;
  // Events
  gameLabel: string;
  gamesLabel: string;
  practiceLabel: string;
  // Scheduling
  practiceSlotsLabel: string;
  hasPracticeSlots: boolean; // Baseball uses the claim/approval slot system; Football does not
  hasTeams: boolean;          // Baseball has explicit Teams; Football uses Division-as-Team
  defaultDivisions: SportDivisionDefault[];
}

export const SPORT_CONFIG: Record<Sport, SportConfig> = {
  baseball: {
    label: 'Baseball',
    icon: '⚾',
    logoUrl: '/baseball.png',
    acronym: 'SYBA',
    contactEmail: 'info@syba.blue',
    umpireLabel: 'Umpire',
    umpiresLabel: 'Umpires',
    gameLabel: 'Game',
    gamesLabel: 'Games',
    practiceLabel: 'Practice',
    practiceSlotsLabel: 'Practice Slots',
    hasPracticeSlots: true,
    hasTeams: true,
    defaultDivisions: [
      { id: 'tball', name: 'T-Ball', fee: 5000, capacity: 20 },
      { id: 'coach-pitch', name: 'Coach Pitch', fee: 7500, capacity: 20 },
      { id: 'kid-pitch', name: 'Kid Pitch', fee: 10000, capacity: 20 },
    ],
  },
  football: {
    label: 'Football',
    icon: '🏈',
    logoUrl: '/football.png',
    acronym: 'SYFA',
    contactEmail: 'football@sharpsvillesports.com',
    umpireLabel: 'Official',
    umpiresLabel: 'Officials',
    gameLabel: 'Game',
    gamesLabel: 'Games',
    practiceLabel: 'Practice',
    practiceSlotsLabel: 'Practices',
    hasPracticeSlots: false,
    hasTeams: false,
    defaultDivisions: [
      { id: 'midgets', name: 'Midgets', fee: 0, capacity: 40 },
      { id: 'peewee', name: 'Pee Wee', fee: 0, capacity: 40 },
    ],
  },
};

/** Returns the config for the currently active sport. Falls back to baseball if no sport is selected. */
export function useSportConfig(): SportConfig {
  const { activeSport } = useSport();
  return SPORT_CONFIG[activeSport ?? 'baseball'];
}
