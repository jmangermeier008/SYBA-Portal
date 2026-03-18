'use client';

import { useEffect, useState } from 'react';
import { onAuthStateChanged, User, getAuth } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { useAuth, useFirestore } from '../provider';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

export interface UserProfile {
  id: string;
  email: string | null;
  displayName: string | null;
  role: 'Parent' | 'Coach' | 'Admin';
  createdAt: string;
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
      if (!currentAuth.currentUser) return;

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

  return {
    user,
    profile,
    loading,
    isAdmin: profile?.role === 'Admin',
    isCoach: profile?.role === 'Coach',
    isParent: profile?.role === 'Parent',
  };
}
