import type { Sport } from '@/types/scheduling';
import { useSport } from '@/firebase/sport-context';

export const HUB_LOGO_URL = '/logo-hub.png';

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
  },
};

/** Returns the config for the currently active sport. Falls back to baseball if no sport is selected. */
export function useSportConfig(): SportConfig {
  const { activeSport } = useSport();
  return SPORT_CONFIG[activeSport ?? 'baseball'];
}
