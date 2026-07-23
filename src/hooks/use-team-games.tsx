"use client";

/**
 * Live subscription to `teams/{teamId}/games` for a set of teams.
 *
 * Replaces the one-shot getDocs pattern the coach/parent schedule surfaces
 * used — with live snapshots, admin edits, coach-created practices, and
 * cancellations appear everywhere without manual local-state patching.
 */
import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, type Firestore } from 'firebase/firestore';
import type { TeamGame } from '@/types/scheduling';

export type TeamGameRow = TeamGame & { _teamId: string };

export function useTeamGamesLive(
  db: Firestore | null,
  teamIds: string[],
): { games: TeamGameRow[]; isLoading: boolean } {
  const teamIdsKey = teamIds.join(',');
  const [byTeam, setByTeam] = useState<Record<string, TeamGameRow[]>>({});
  const [loadedTeams, setLoadedTeams] = useState<Set<string>>(new Set());

  useEffect(() => {
    setByTeam({});
    setLoadedTeams(new Set());
    if (!db || teamIds.length === 0) return;

    const unsubs = teamIds.map(teamId =>
      onSnapshot(
        collection(db, 'teams', teamId, 'games'),
        snap => {
          const rows = snap.docs.map(d => ({ ...(d.data() as TeamGame), id: d.id, _teamId: teamId }));
          setByTeam(prev => ({ ...prev, [teamId]: rows }));
          setLoadedTeams(prev => {
            const next = new Set(prev);
            next.add(teamId);
            return next;
          });
        },
        () => {
          // Permission/network error for one team must not wedge the loading state
          setLoadedTeams(prev => {
            const next = new Set(prev);
            next.add(teamId);
            return next;
          });
        },
      )
    );
    return () => unsubs.forEach(u => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, teamIdsKey]);

  const games = useMemo(() => Object.values(byTeam).flat(), [byTeam]);
  const isLoading = teamIds.length > 0 && loadedTeams.size < teamIds.length;
  return { games, isLoading };
}
