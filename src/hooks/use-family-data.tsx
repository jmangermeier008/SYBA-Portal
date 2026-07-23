"use client";

/**
 * Family-wide data hooks that see BOTH sides of a co-parent link.
 *
 * Enrollments carry `parentUserId` (the registering parent) plus
 * `additionalParentUids` (linked co-parents — see src/lib/family-links.ts).
 * Players live under the primary parent's subcollection with
 * `secondaryParentId` pointing at the linked co-parent.
 *
 * Every parent-facing surface must resolve "my players / my enrollments"
 * through these hooks — a bare `where('parentUserId','==',uid)` query shows
 * a linked co-parent an empty app.
 */
import { useMemo } from 'react';
import { collection, collectionGroup, query, where, type Firestore } from 'firebase/firestore';
import { useCollection, useMemoFirebase } from '@/firebase';

function mergeById<T extends { id: string }>(a: T[] | null, b: T[] | null): T[] | null {
  if (!a && !b) return null;
  const map = new Map<string, T>();
  for (const item of a ?? []) map.set(item.id, item);
  for (const item of b ?? []) if (!map.has(item.id)) map.set(item.id, item);
  return [...map.values()];
}

/** Enrollments where the user is the registering parent OR a linked co-parent. */
export function useFamilyEnrollments<T extends { id: string }>(
  db: Firestore | null,
  uid: string | undefined,
): { data: T[] | null; isLoading: boolean } {
  const primaryQuery = useMemoFirebase(() => {
    if (!db || !uid) return null;
    return query(collectionGroup(db, 'enrollments'), where('parentUserId', '==', uid));
  }, [db, uid]);
  const linkedQuery = useMemoFirebase(() => {
    if (!db || !uid) return null;
    return query(collectionGroup(db, 'enrollments'), where('additionalParentUids', 'array-contains', uid));
  }, [db, uid]);
  const { data: primary, isLoading: loadingPrimary } = useCollection<T>(primaryQuery);
  const { data: linked, isLoading: loadingLinked } = useCollection<T>(linkedQuery);
  const data = useMemo(() => mergeById(primary, linked), [primary, linked]);
  return { data, isLoading: loadingPrimary || loadingLinked };
}

/** The user's own players plus players shared with them as a linked co-parent. */
export function useFamilyPlayers<T extends { id: string }>(
  db: Firestore | null,
  uid: string | undefined,
): { data: T[] | null; isLoading: boolean } {
  const ownQuery = useMemoFirebase(() => {
    if (!db || !uid) return null;
    return collection(db, 'userProfiles', uid, 'players');
  }, [db, uid]);
  const sharedQuery = useMemoFirebase(() => {
    if (!db || !uid) return null;
    return query(collectionGroup(db, 'players'), where('secondaryParentId', '==', uid));
  }, [db, uid]);
  const { data: own, isLoading: loadingOwn } = useCollection<T>(ownQuery);
  const { data: shared, isLoading: loadingShared } = useCollection<T>(sharedQuery);
  const data = useMemo(() => mergeById(own, shared), [own, shared]);
  return { data, isLoading: loadingOwn || loadingShared };
}
