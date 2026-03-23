"use client";

import { useUser, useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import Image from 'next/image';
import { Loader2 } from 'lucide-react';
import { collection, query, where, limit } from 'firebase/firestore';

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
}

// Add your sponsor image files to public/sponsors/
// Supported filenames: sponsor1.png, sponsor2.png, sponsor3.png (etc.)
// Images will be hidden automatically if the file doesn't exist yet.
const SPONSOR_IMAGES = [
  '/sponsors/sponsor1.png',
  '/sponsors/sponsor2.png',
  '/sponsors/sponsor3.png',
];

interface ActiveSeason {
  id: string;
  name: string;
  registrationOpen: string;
  registrationClose: string;
  isActive?: boolean;
}

export default function Home() {
  const { user, profile, loading, isAdmin, isBoardMember, isCoach } = useUser();
  const router = useRouter();
  const db = useFirestore();

  const activeSeasonQuery = useMemoFirebase(() => {
    if (!db) return null;
    return query(collection(db, 'seasons'), where('status', '==', 'active'), limit(1));
  }, [db]);

  const { data: activeSeasons } = useCollection<ActiveSeason>(activeSeasonQuery);
  const activeSeason = activeSeasons?.[0] ?? null;

  const registrationBanner = useMemo(() => {
    if (!activeSeason) return null;
    const today = new Date().toISOString().slice(0, 10);
    if (today < activeSeason.registrationOpen) {
      return `Registration opens ${formatDate(activeSeason.registrationOpen)} for ${activeSeason.name}`;
    }
    if (today <= activeSeason.registrationClose) {
      return `Registration open for ${activeSeason.name} — closes ${formatDate(activeSeason.registrationClose)}`;
    }
    return null;
  }, [activeSeason]);

  useEffect(() => {
    if (!loading && user && profile) {
      if (isAdmin || isBoardMember) {
        router.push('/admin/dashboard');
      } else if (isCoach) {
        router.push('/coach/dashboard');
      } else {
        router.push('/parent/dashboard');
      }
    }
  }, [user, profile, loading, router, isAdmin, isBoardMember, isCoach]);

  if (loading) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-blue-50 to-white px-4">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
  if (user && profile) return null; // redirect is in flight — suppress flash

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-blue-50 to-white px-4">
      <div className="flex flex-col items-center text-center space-y-6 max-w-sm w-full">
        {/* Logo */}
        <Image
          src="/contentrotator637479479383661633.png"
          alt="Sharpsville Youth Baseball Association"
          width={120}
          height={120}
          className="object-contain"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />

        {/* League name */}
        <div className="space-y-1">
          <h1 className="text-2xl font-bold font-headline tracking-tight text-primary">
            Sharpsville Youth Baseball Association
          </h1>
          <p className="text-muted-foreground text-sm">The online home for Sharpsville Youth Baseball</p>
        </div>

        {/* CTA buttons */}
        <div className="flex gap-3 w-full justify-center">
          <Button size="lg" className="rounded-full px-8 shadow-md shadow-primary/20" asChild>
            <Link href="/login">Sign In</Link>
          </Button>
          <Button variant="outline" size="lg" className="rounded-full px-8" asChild>
            <Link href="/signup">Register Player</Link>
          </Button>
        </div>

        {/* Contact link */}
        <p className="text-sm text-muted-foreground">
          Have a question?{' '}
          <Link href="/contact" className="text-primary hover:underline font-medium">
            Contact us
          </Link>
        </p>

        {/* Registration banner */}
        {registrationBanner && (
          <div className="w-full rounded-xl bg-primary/10 border border-primary/20 px-4 py-2.5 text-sm text-primary font-medium text-center">
            {registrationBanner}
          </div>
        )}
      </div>

      {/* Sponsors */}
      {SPONSOR_IMAGES.length > 0 && (
        <div className="mt-16 flex flex-col items-center gap-4 w-full max-w-2xl">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Our Sponsors</p>
          <div className="flex flex-wrap items-center justify-center gap-8">
            {SPONSOR_IMAGES.map((src, i) => (
              <Image
                key={i}
                src={src}
                alt={`Sponsor ${i + 1}`}
                width={240}
                height={80}
                className="h-20 w-auto object-contain grayscale hover:grayscale-0 transition-all duration-300"
                style={{ width: 'auto' }}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="mt-12 text-xs text-muted-foreground text-center">
        © {new Date().getFullYear()} SYBA. All rights reserved. Sharpsville, PA.
      </footer>
    </div>
  );
}
