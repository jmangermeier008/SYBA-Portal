"use client";

import { useEffect, useMemo, useState } from 'react';
import { collection, query, where } from 'firebase/firestore';
import { AlertTriangle, X } from 'lucide-react';
import { useFirestore, useMemoFirebase, useCollection, useSport } from '@/firebase';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { isAnnouncementActive, type Announcement } from '@/types/scheduling';

const DISMISSED_KEY = 'syba_urgent_dismissed';

function readDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch {
    return new Set();
  }
}

function writeDismissed(ids: Set<string>) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]));
  } catch {
    /* ignore — private mode / storage disabled */
  }
}

/**
 * Attention-grabbing, dismissible banner for urgent announcements, shown on the
 * parent dashboard directly below the sub-header. Dismissal is per-announcement,
 * persisted to localStorage (lightweight, no server write) so a dismissed alert
 * stays gone across reloads.
 */
export function UrgentAnnouncementBanner() {
  const { activeSport } = useSport();
  const db = useFirestore();

  // Single equality filter (no composite index). Sorting + sport/global scoping
  // happen client-side so global (all-sport) urgent alerts still surface.
  const urgentQuery = useMemoFirebase(() => {
    if (!db) return null;
    return query(collection(db, 'announcements'), where('isUrgent', '==', true));
  }, [db]);
  const { data: urgent } = useCollection<Announcement>(urgentQuery);

  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setDismissed(readDismissed());
    setHydrated(true);
  }, []);

  const visible = useMemo(() => {
    const d = new Date();
    const todayISO = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return (urgent ?? [])
      .filter(a => a.isGlobal || a.sport === activeSport)
      .filter(a => !dismissed.has(a.id))
      .filter(a => isAnnouncementActive(a, todayISO))
      .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
  }, [urgent, activeSport, dismissed]);

  const handleDismiss = (id: string) => {
    setDismissed(prev => {
      const next = new Set(prev).add(id);
      writeDismissed(next);
      return next;
    });
  };

  // Avoid a flash of already-dismissed banners before localStorage is read.
  if (!hydrated || visible.length === 0) return null;

  return (
    <div className="space-y-2 mb-4">
      {visible.map(a => (
        <Alert key={a.id} variant="destructive" className="pr-10 bg-destructive/5">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{a.title}</AlertTitle>
          <AlertDescription className="whitespace-pre-wrap">{a.body}</AlertDescription>
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-2 top-2 h-7 w-7 text-destructive hover:bg-destructive/10"
            onClick={() => handleDismiss(a.id)}
            aria-label="Dismiss alert"
          >
            <X className="h-4 w-4" />
          </Button>
        </Alert>
      ))}
    </div>
  );
}
