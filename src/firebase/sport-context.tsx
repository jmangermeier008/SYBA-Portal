'use client';

import React, { createContext, useContext, useState, useEffect, useMemo, useRef, ReactNode } from 'react';
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

  // Read sport from localStorage on mount — this is the sole source of truth for the active sport.
  // Sport is set pre-login on the home page and locked for the session.
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('syba_active_sport');
      if (stored === 'baseball' || stored === 'football') {
        setActiveSportState(stored);
      }
    }
  }, []);

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
  return (
    <SportContext.Provider value={contextValue}>
      {loading ? (
        // Wait for auth + profile before deciding gate state
        <div className="flex min-h-screen items-center justify-center bg-background">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      ) : !user ? (
        // Not logged in — pass through; auth pages and home page handle their own flow
        children
      ) : !activeSport ? (
        // Logged in but no sport in localStorage — redirect to home page to select sport
        <RedirectToHome />
      ) : (
        children
      )}
    </SportContext.Provider>
  );
}
