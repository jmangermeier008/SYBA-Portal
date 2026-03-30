'use client';

import { useState, useEffect } from 'react';
import type { Sport } from '@/types/scheduling';

const KEY = 'syba_active_sport';

/** Write the selected sport to localStorage (for pre-login home page use only). */
export function setActiveSport(sport: Sport) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(KEY, sport);
  }
}

/** Remove the sport from localStorage (e.g. when user clicks "Change" on home page). */
export function clearActiveSport() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(KEY);
  }
}

/**
 * Read-only hook that returns the sport stored in localStorage.
 * Returns null on first render (SSR-safe) then resolves on mount.
 * For authenticated pages, prefer useSport() from sport-context instead.
 */
export function useActiveSport(): Sport | null {
  const [sport, setSport] = useState<Sport | null>(null);
  useEffect(() => {
    const stored = localStorage.getItem(KEY);
    if (stored === 'baseball' || stored === 'football') {
      setSport(stored);
    }
  }, []);
  return sport;
}
