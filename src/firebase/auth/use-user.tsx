'use client';

import { useEffect, useState } from 'react';
import { onAuthStateChanged, User, getAuth } from 'firebase/auth';
import { doc, onSnapshot, updateDoc, Firestore } from 'firebase/firestore';
import { useAuth, useFirestore } from '../provider';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import type { Sport } from '@/types/scheduling';

export interface UserProfile {
  id: string;
  email: string | null;
  displayName: string | null;
  // Legacy single-role field — kept for backward compatibility
  role: 'Parent' | 'Coach' | 'Admin';
  // Legacy multi-role field — kept; used for Site Admin / Admin bypass
  roles?: ('Parent' | 'Coach' | 'Board Member' | 'Admin' | 'Site Admin')[];
  // Federated sport roles: { baseball: ['Board Member'], football: ['Coach'] }
  sportRoles?: Record<string, ('Parent' | 'Coach' | 'Board Member' | 'Admin' | 'Site Admin')[]>;
  phoneNumber?: string | null;
  shareContactInfo?: boolean;
  enrolledPlayerIds?: string[];
  teamIds?: string[];
  divisionIds?: string[];  // Football coach division assignments
  preferredSport?: Sport;
  complianceStatus?: 'pending' | 'approved' | 'action_required';
  manualComplianceOverride?: boolean;
  createdAt: string;
}

export async function updatePreferredSport(db: Firestore, userId: string, sport: Sport): Promise<void> {
  await updateDoc(doc(db, 'userProfiles', userId), { preferredSport: sport });
}

function deriveRoles(profile: UserProfile): string[] {
  if (profile.roles && profile.roles.length > 0) return profile.roles;
  // Backward compat: derive from old single role field
  return [profile.role];
}

export function useUser() {
  const auth = useAuth();
  const db = useFirestore();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

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

  const roles = profile ? deriveRoles(profile) : [];

  const isAdmin = roles.includes('Admin');
  const isSiteAdmin = roles.includes('Site Admin') || isAdmin;
  const isBoardMember = roles.includes('Board Member') || isAdmin || isSiteAdmin;
  const isCoach = roles.includes('Coach') || isAdmin;
  const isParent = roles.includes('Parent') || isAdmin;

  // PA Act 153 compliance — true when clearances are approved OR admin has force-approved
  const isApproved =
    profile?.complianceStatus === 'approved' || profile?.manualComplianceOverride === true;

  // Board members, admins, and site admins bypass the compliance lockout
  const hasCoachAccess = isBoardMember || isAdmin || isSiteAdmin || isApproved;

  return {
    user,
    profile,
    loading,
    roles,
    isAdmin,
    isSiteAdmin,
    isBoardMember,
    isCoach,
    isParent,
    isApproved,
    hasCoachAccess,
    preferredSport: profile?.preferredSport,
    sportRoles: profile?.sportRoles,
  };
}
