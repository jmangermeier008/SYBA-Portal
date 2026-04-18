'use client';

import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useRouter, usePathname } from 'next/navigation';
import { useUser } from './auth/use-user';
import { SPORT_CONFIG, HUB_LOGO_URL } from '@/config/sports';
import type { Sport } from '@/types/scheduling';

interface SportContextState {
  // null before auth/profile loads or before localStorage is read on mount
  activeSport: Sport | null;
  // Sport is locked for the session — switching requires logging out and reselecting on home page.
  // Sport-aware role flags — derived from profile.sportRoles[activeSport] with Site Admin bypass
  isAdmin: boolean;
  isSiteAdmin: boolean;
  isBoardMember: boolean;
  isCoach: boolean;
  isParent: boolean;
  // Football coaches — divisions they are assigned to (empty for baseball / non-coaches)
  coachDivisionIds: string[];
  // Branding — derived from SPORT_CONFIG; safe to destructure in any component
  logoUrl: string;      // resolves to SPORT_CONFIG[activeSport].logoUrl, falls back to HUB_LOGO_URL
  leagueName: string;   // full org name, e.g. "Sharpsville Youth Baseball Association"
}

const SportContext = createContext<SportContextState>({
  activeSport: null,
  isAdmin: false,
  isSiteAdmin: false,
  isBoardMember: false,
  isCoach: false,
  isParent: false,
  coachDivisionIds: [],
  logoUrl: HUB_LOGO_URL,
  leagueName: 'Athletics Hub',
});

export function useSport(): SportContextState {
  return useContext(SportContext);
}

/** Shown while redirecting a logged-in user who has no sport in localStorage back to home page. */
function RedirectToHome() {
  const router = useRouter();
  useEffect(() => {
    router.push('/');
  }, [router]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-10 w-10 animate-spin text-primary" />
    </div>
  );
}

export function SportProvider({ children }: { children: ReactNode }) {
  const { user, profile, loading, roles } = useUser();
  const pathname = usePathname();
  const [activeSport, setActiveSportState] = useState<Sport | null>(null);
  // Tracks whether the localStorage read has completed (always synchronous, but effect is async).
  // We must not show the gate until we've checked — otherwise a brief null activeSport
  // would flash the redirect for users who DO have a sport stored.
  const [sportLoaded, setSportLoaded] = useState(false);

  // Read sport from localStorage whenever the logged-in user changes (login/logout/switch).
  // Depends on both user?.uid AND loading so we don't clear localStorage during the initial
  // render before auth has resolved — that would wipe a stored sport before we can read it.
  useEffect(() => {
    if (!user?.uid) {
      if (!loading) {
        // Auth has fully resolved with no user — genuine logout, clear stored sport.
        // Exception: on the enrollment path, anonymous sign-in is still pending.
        // Clearing localStorage here would wipe the sport the user just selected on
        // the home page before the anonymous user is established.
        if (!pathname.startsWith('/parent/enroll')) {
          localStorage.removeItem('syba_active_sport');
          setActiveSportState(null);
        }
        setSportLoaded(true);
      }
      // Still resolving — don't touch localStorage yet; wait for the next effect run
      return;
    }
    const stored = localStorage.getItem('syba_active_sport');
    if (stored === 'baseball' || stored === 'football') {
      setActiveSportState(stored);
    } else {
      setActiveSportState(null);
    }
    setSportLoaded(true);
  }, [user?.uid, loading]);

  // When the homepage writes a sport to localStorage (via setActiveSport from use-active-sport),
  // it dispatches 'syba:sport-changed' so we can update the context state reactively.
  // This allows the homepage's redirect to fire as soon as the user picks a sport.
  useEffect(() => {
    if (!user?.uid) return;
    const handleSportChange = () => {
      const stored = localStorage.getItem('syba_active_sport');
      if (stored === 'baseball' || stored === 'football') {
        setActiveSportState(stored as Sport);
      }
    };
    window.addEventListener('syba:sport-changed', handleSportChange);
    return () => window.removeEventListener('syba:sport-changed', handleSportChange);
  }, [user?.uid]);

  // ── Sport-aware role derivation ───────────────────────────────────────────
  // Site Admin / Admin in legacy roles[] = cross-sport superuser bypass
  const isSiteAdmin = roles.includes('Site Admin') || roles.includes('Admin');

  // For all other roles, check sportRoles[activeSport] if available
  const sportRoleList: string[] = (activeSport && profile?.sportRoles?.[activeSport]) ?? [];

  const isAdmin = isSiteAdmin || sportRoleList.includes('Admin');
  const isBoardMember = isSiteAdmin || sportRoleList.includes('Board Member') || sportRoleList.includes('Admin');
  const isCoach = isSiteAdmin || sportRoleList.includes('Coach');
  // Parents are not sport-specific — fall back to legacy roles for parent check
  const isParent = sportRoleList.includes('Parent') || roles.includes('Parent');

  const coachDivisionIds: string[] = (activeSport === 'football' ? profile?.divisionIds : undefined) ?? [];

  // Branding — derived from SPORT_CONFIG for the active sport
  const logoUrl = activeSport ? SPORT_CONFIG[activeSport].logoUrl : HUB_LOGO_URL;
  const leagueName = activeSport ? SPORT_CONFIG[activeSport].leagueName : 'Athletics Hub';

  const contextValue = useMemo(
    () => ({ activeSport, isAdmin, isSiteAdmin, isBoardMember, isCoach, isParent, coachDivisionIds, logoUrl, leagueName }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeSport, isAdmin, isSiteAdmin, isBoardMember, isCoach, isParent, coachDivisionIds, logoUrl, leagueName]
  );

  // Always render the provider so useSport() never throws regardless of tree position.
  return (
    <SportContext.Provider value={contextValue}>
      {loading || !sportLoaded ? (
        // Wait for both auth AND localStorage read before evaluating the gate.
        // sportLoaded prevents flashing the redirect for users who have a stored sport.
        <div className="flex min-h-screen items-center justify-center bg-background">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      ) : !user ? (
        // Not logged in — pass through; auth pages and home page handle their own flow
        children
      ) : !activeSport && pathname !== '/' && !pathname.startsWith('/parent/enroll') ? (
        // Logged in, no sport, not on home page — redirect to home page to select sport.
        // Guard excludes '/' (infinite-loop prevention) and '/parent/enroll' (guest
        // registration: anonymous sign-in is in flight and sport is still being resolved).
        <RedirectToHome />
      ) : (
        children
      )}
    </SportContext.Provider>
  );
}
