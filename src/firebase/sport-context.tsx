'use client';

import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useUser } from './auth/use-user';
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
}

const SportContext = createContext<SportContextState>({
  activeSport: null,
  isAdmin: false,
  isSiteAdmin: false,
  isBoardMember: false,
  isCoach: false,
  isParent: false,
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
  const [activeSport, setActiveSportState] = useState<Sport | null>(null);
  // Tracks whether the localStorage read has completed (always synchronous, but effect is async).
  // We must not show the gate until we've checked — otherwise a brief null activeSport
  // would flash the redirect for users who DO have a sport stored.
  const [sportLoaded, setSportLoaded] = useState(false);

  // Read sport from localStorage whenever the logged-in user changes (login/logout/switch).
  // Depends on both user?.uid and loading so we don't clear localStorage during the initial
  // render before auth has resolved — that would wipe a stored sport before we can read it.
  useEffect(() => {
    if (!user?.uid) {
      if (!loading) {
        // Auth has fully resolved and there is no user — genuine logout, clear stored sport
        localStorage.removeItem('syba_active_sport');
        setActiveSportState(null);
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

  const contextValue = useMemo(
    () => ({ activeSport, isAdmin, isSiteAdmin, isBoardMember, isCoach, isParent }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeSport, isAdmin, isSiteAdmin, isBoardMember, isCoach, isParent]
  );

  // Always render the provider so useSport() never throws regardless of tree position.
  // Only redirect when we've confirmed: logged-in user + localStorage read complete + no sport chosen.
  // All other states (loading, unauthenticated, sport set) pass children through immediately so
  // public pages and route-level layouts manage their own loading/auth states.
  return (
    <SportContext.Provider value={contextValue}>
      {user && sportLoaded && !activeSport ? (
        // Logged in but no sport in localStorage — redirect to home page to select sport
        <RedirectToHome />
      ) : (
        children
      )}
    </SportContext.Provider>
  );
}
