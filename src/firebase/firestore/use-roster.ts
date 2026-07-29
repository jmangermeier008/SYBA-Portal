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

/** A roster row whose player doc resolved — the shape roll calls and rosters render. */
export type PlayerRosterRow = RosterRow & { player: Player & { id: string } };

interface UseRosterDataOptions {
  /** When set, scopes enrollments to a single team. Otherwise scopes to the active sport. */
  teamId?: string;
  /**
   * Multiple teams at once — a baseball game has two rosters RSVPing into one
   * game id, so its roll call spans both. Takes precedence over `teamId`.
   */
  teamIds?: string[];
  /** Gate the subscription (e.g. only run for admins). Defaults to true. */
  enabled?: boolean;
  /**
   * Whether to pull every parent profile. Defaults to true for the roster pages
   * that render guardian contact info; pass false from event-level views (roll
   * calls in popovers and dialogs) so opening one doesn't read all userProfiles.
   */
  includeParents?: boolean;
}

/**
 * Shared roster join used by the master roster, per-team views, and per-event
 * roll calls. Pulls enrollments (scoped by team(s) or sport), all players, and
 * optionally all parent profiles, then joins them client-side — the same
 * pattern these pages used to duplicate inline.
 *
 * Team membership lives on the ENROLLMENT (`enrollment.teamId`), never on the
 * player doc, which is why a roster is always a join and never one query.
 */
export function useRosterData({ teamId, teamIds, enabled = true, includeParents = true }: UseRosterDataOptions = {}) {
  const db = useFirestore();
  const { activeSport } = useSport();
  const teamIdsKey = teamIds?.join(',') ?? '';

  const enrollmentsQuery = useMemoFirebase(() => {
    if (!db || !enabled) return null;
    if (teamIds && teamIds.length > 0) {
      // Firestore caps `in` at 30 values; a single event never spans more teams.
      return query(collectionGroup(db, 'enrollments'), where('teamId', 'in', teamIds.slice(0, 30)));
    }
    if (teamIds) return null; // explicitly scoped to no teams — subscribe to nothing
    if (teamId) {
      return query(collectionGroup(db, 'enrollments'), where('teamId', '==', teamId));
    }
    if (!activeSport) return null;
    return query(collectionGroup(db, 'enrollments'), where('sport', '==', activeSport));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, enabled, teamId, teamIdsKey, !!teamIds, activeSport]);

  const playersQuery = useMemoFirebase(() => {
    if (!db || !enabled) return null;
    // Unfiltered on purpose: there is no team field on a player doc, and
    // firestore.rules grants coaches and board members blanket player reads.
    return collectionGroup(db, 'players');
  }, [db, enabled]);

  const parentsQuery = useMemoFirebase(() => {
    if (!db || !enabled || !includeParents) return null;
    return collection(db, 'userProfiles');
  }, [db, enabled, includeParents]);

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
    isLoading: loadingEnrollments || loadingPlayers || (includeParents && loadingParents),
  };
}

/**
 * Rows that actually have a player doc, alphabetical by last name — the order
 * a coach reads names off a list in. Kept out of useRosterData so the existing
 * roster pages keep their current ordering.
 */
export function sortedPlayerRows(rows: RosterRow[]): PlayerRosterRow[] {
  return rows
    .filter((r): r is PlayerRosterRow => !!r.player)
    .sort((a, b) => (a.player.lastName ?? '').localeCompare(b.player.lastName ?? ''));
}

/** Display name for a roster row, never empty. */
export function playerDisplayName(player: Pick<Player, 'firstName' | 'lastName'>): string {
  return `${player.firstName ?? ''} ${player.lastName ?? ''}`.trim() || 'Unnamed player';
}
