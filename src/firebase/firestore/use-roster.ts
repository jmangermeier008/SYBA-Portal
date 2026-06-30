'use client';

import { useMemo } from 'react';
import { collection, collectionGroup, query, where } from 'firebase/firestore';
import { useFirestore, useMemoFirebase } from '../provider';
import { useCollection } from './use-collection';
import { useSport } from '../sport-context';
import type { Enrollment, Player, UserProfile } from '@/types/scheduling';

/** One enrollment joined to its player and the parent who owns the profile. */
export interface RosterRow {
  enrollment: Enrollment & { id: string };
  player?: (Player & { id: string });
  parent?: (UserProfile & { id: string });
}

interface UseRosterDataOptions {
  /** When set, scopes enrollments to a single team. Otherwise scopes to the active sport. */
  teamId?: string;
  /** Gate the subscription (e.g. only run for admins). Defaults to true. */
  enabled?: boolean;
}

/**
 * Shared roster join used by the master roster and per-team views. Pulls enrollments
 * (scoped by team or sport), all players, and all parent profiles, then joins them
 * client-side — the same pattern both pages used to duplicate inline.
 */
export function useRosterData({ teamId, enabled = true }: UseRosterDataOptions = {}) {
  const db = useFirestore();
  const { activeSport } = useSport();

  const enrollmentsQuery = useMemoFirebase(() => {
    if (!db || !enabled) return null;
    if (teamId) {
      return query(collectionGroup(db, 'enrollments'), where('teamId', '==', teamId));
    }
    if (!activeSport) return null;
    return query(collectionGroup(db, 'enrollments'), where('sport', '==', activeSport));
  }, [db, enabled, teamId, activeSport]);

  const playersQuery = useMemoFirebase(() => {
    if (!db || !enabled) return null;
    return collectionGroup(db, 'players');
  }, [db, enabled]);

  const parentsQuery = useMemoFirebase(() => {
    if (!db || !enabled) return null;
    return collection(db, 'userProfiles');
  }, [db, enabled]);

  const { data: enrollments, isLoading: loadingEnrollments } = useCollection<Enrollment>(enrollmentsQuery);
  const { data: players, isLoading: loadingPlayers } = useCollection<Player>(playersQuery);
  const { data: parents, isLoading: loadingParents } = useCollection<UserProfile>(parentsQuery);

  const rows = useMemo<RosterRow[]>(() => {
    if (!enrollments) return [];
    return enrollments.map((enrollment) => ({
      enrollment,
      player: players?.find((p) => p.id === enrollment.playerId),
      parent: parents?.find((u) => u.id === enrollment.parentUserId),
    }));
  }, [enrollments, players, parents]);

  return {
    rows,
    enrollments,
    players,
    parents,
    isLoading: loadingEnrollments || loadingPlayers || loadingParents,
  };
}
