'use client';

import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useUser, updatePreferredSport } from './auth/use-user';
import { useFirestore } from './provider';
import type { Sport } from '@/types/scheduling';

interface SportContextState {
  // null before auth/profile loads or before first selection
  activeSport: Sport | null;
  setActiveSport: (sport: Sport) => Promise<void>;
  // Sport-aware role flags — derived from profile.sportRoles[activeSport] with Site Admin bypass
  isAdmin: boolean;
  isSiteAdmin: boolean;
  isBoardMember: boolean;
  isCoach: boolean;
  isParent: boolean;
}

const SportContext = createContext<SportContextState>({
  activeSport: null,
  setActiveSport: async () => {},
  isAdmin: false,
  isSiteAdmin: false,
  isBoardMember: false,
  isCoach: false,
  isParent: false,
});

export function useSport(): SportContextState {
  return useContext(SportContext);
}

export function SportProvider({ children }: { children: ReactNode }) {
  const { user, profile, loading, roles } = useUser();
  const db = useFirestore();
  const [activeSport, setActiveSportState] = useState<Sport | null>(null);
  const [selecting, setSelecting] = useState(false);

  // Sync activeSport from profile whenever profile changes (e.g. other device update)
  useEffect(() => {
    if (profile?.preferredSport) {
      setActiveSportState(profile.preferredSport);
    }
  }, [profile?.preferredSport]);

  const setActiveSport = async (sport: Sport) => {
    if (!user) return;
    setActiveSportState(sport);
    await updatePreferredSport(db, user.uid, sport);
  };

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
    () => ({ activeSport, setActiveSport, isAdmin, isSiteAdmin, isBoardMember, isCoach, isParent }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeSport, isAdmin, isSiteAdmin, isBoardMember, isCoach, isParent]
  );

  // Always render the provider so useSport() never throws regardless of tree position.
  // The gate/spinner are rendered *instead of* children, not as a replacement of the provider.
  return (
    <SportContext.Provider value={contextValue}>
      {loading ? (
        // Wait for auth + profile before deciding gate state
        <div className="flex min-h-screen items-center justify-center bg-background">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      ) : !user ? (
        // Not logged in — pass through; auth pages handle their own flow
        children
      ) : !activeSport ? (
        // Logged in but no sport selected — block portal with selection gate
        <div className="flex min-h-screen items-center justify-center bg-background p-6">
          <div className="w-full max-w-lg text-center">
            <h1 className="text-3xl font-bold font-headline text-primary mb-2">Sharpsville Youth Athletics Hub</h1>
            <p className="text-muted-foreground mb-8">Select your sport to continue.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button
                disabled={selecting}
                onClick={async () => {
                  setSelecting(true);
                  await setActiveSport('baseball');
                  setSelecting(false);
                }}
                className="flex flex-col items-center gap-3 p-8 rounded-2xl border-2 border-border bg-card shadow-sm hover:border-primary hover:shadow-md transition-all disabled:opacity-50"
              >
                <span className="text-5xl" role="img" aria-label="Baseball">⚾</span>
                <div>
                  <p className="text-xl font-bold font-headline">Baseball</p>
                  <p className="text-sm text-muted-foreground">Youth Baseball Association</p>
                </div>
              </button>
              <button
                disabled={selecting}
                onClick={async () => {
                  setSelecting(true);
                  await setActiveSport('football');
                  setSelecting(false);
                }}
                className="flex flex-col items-center gap-3 p-8 rounded-2xl border-2 border-border bg-card shadow-sm hover:border-primary hover:shadow-md transition-all disabled:opacity-50"
              >
                <span className="text-5xl" role="img" aria-label="Football">🏈</span>
                <div>
                  <p className="text-xl font-bold font-headline">Football</p>
                  <p className="text-sm text-muted-foreground">Youth Football Association</p>
                </div>
              </button>
            </div>
            {selecting && (
              <div className="mt-6 flex justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            )}
          </div>
        </div>
      ) : (
        children
      )}
    </SportContext.Provider>
  );
}
