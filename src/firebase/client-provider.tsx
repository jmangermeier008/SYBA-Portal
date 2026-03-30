'use client';

import React, { useMemo, Suspense, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { FirebaseProvider } from '@/firebase/provider';
import { SportProvider } from '@/firebase/sport-context';
import { initializeFirebase } from '@/firebase';

interface FirebaseClientProviderProps {
  children: ReactNode;
}

export function FirebaseClientProvider({ children }: FirebaseClientProviderProps) {
  const firebaseServices = useMemo(() => {
    return initializeFirebase();
  }, []);

  return (
    <FirebaseProvider
      firebaseApp={firebaseServices.firebaseApp}
      auth={firebaseServices.auth}
      firestore={firebaseServices.firestore}
      storage={firebaseServices.storage}
    >
      <Suspense fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      }>
        <SportProvider>
          {children}
        </SportProvider>
      </Suspense>
    </FirebaseProvider>
  );
}
