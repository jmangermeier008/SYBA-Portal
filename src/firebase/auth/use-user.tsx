'use client';

import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, User, getAuth } from 'firebase/auth';
import { doc, onSnapshot, setDoc, updateDoc, Firestore } from 'firebase/firestore';
import { useAuth, useFirestore } from '../provider';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import type { NotificationPrefs, Sport, SportRole } from '@/types/scheduling';

export interface UserProfile {
  id: string;
  email: string | null;
  displayName: string | null;
  isSiteAdmin?: boolean;  // Authoritative cross-sport superuser flag
  // Legacy fields — read-only for backward compat; new writes go to sportRoles / isSiteAdmin
  role?: 'Parent' | 'Coach' | 'Admin';
  roles?: ('Parent' | 'Coach' | 'Board Member' | 'Admin' | 'Site Admin')[];
  // Federated sport roles: { baseball: ['Board Member'], football: ['Coach'] }
  sportRoles?: Record<string, SportRole[]>;
  phoneNumber?: string | null;
  shareContactInfo?: boolean;
  enrolledPlayerIds?: string[];
  teamIds?: string[];
  divisionIds?: string[];  // Football coach division assignments
  preferredSport?: Sport;
  notificationPrefs?: NotificationPrefs;
  complianceStatus?: 'pending' | 'approved' | 'action_required';
  manualComplianceOverride?: boolean;
  createdAt: string;
}

export async function updatePreferredSport(db: Firestore, userId: string, sport: Sport): Promise<void> {
  await updateDoc(doc(db, 'userProfiles', userId), { preferredSport: sport });
}

export function useUser() {
  const auth = useAuth();
  const db = useFirestore();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const healedProfileFor = useRef<string | null>(null);

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (authUser) => {
      setUser(authUser);
      if (!authUser) {
        setProfile(null);
        setLoading(false);
      }
    });

    return unsubscribeAuth;
  }, [auth]);

  useEffect(() => {
    if (!user) return;

    // Standardized on 'userProfiles' collection
    const userRef = doc(db, 'userProfiles', user.uid);
    const unsubscribeProfile = onSnapshot(userRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setProfile({ ...data, id: snapshot.id } as UserProfile);
      } else {
        // Self-heal: a signup that created the Auth user but failed to write the
        // profile doc would otherwise lock the account out forever (can't log in,
        // can't re-sign up). Recreate a minimal Parent profile once per session.
        // Accounts created in the last minute are skipped — their signup flow is
        // still writing the real profile and must not be raced.
        const createdAt = new Date(user.metadata.creationTime ?? 0).getTime();
        const isFreshAccount = Date.now() - createdAt < 60_000;
        if (!user.isAnonymous && !isFreshAccount && healedProfileFor.current !== user.uid) {
          healedProfileFor.current = user.uid;
          setDoc(userRef, {
            id: user.uid,
            email: user.email,
            displayName: user.displayName ?? user.email ?? '',
            roles: ['Parent'],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }).catch((err) =>
            console.error('[useUser] Failed to self-heal missing profile:', err)
          );
        }
        setProfile(null);
      }
      setLoading(false);
    }, async (error) => {
      // Check if user is still logged in before emitting error
      const currentAuth = getAuth();
      if (!currentAuth.currentUser) {
        setLoading(false);
        return;
      }

      // Emit contextual error for security rules debugging
      const permissionError = new FirestorePermissionError({
        path: userRef.path,
        operation: 'get',
      });
      errorEmitter.emit('permission-error', permissionError);
      setLoading(false);
    });

    return unsubscribeProfile;
  }, [user, db]);

  // isSiteAdmin: reads dedicated field with legacy fallback for users not yet migrated
  const isSiteAdmin =
    profile?.isSiteAdmin === true ||
    profile?.roles?.includes('Site Admin') === true;

  return {
    user,
    profile,
    loading,
    isSiteAdmin,
    preferredSport: profile?.preferredSport,
    sportRoles: profile?.sportRoles,
  };
}
