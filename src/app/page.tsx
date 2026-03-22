"use client";

import { useUser } from '@/firebase';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import Image from 'next/image';

// Add your sponsor image files to public/sponsors/
// Supported filenames: sponsor1.png, sponsor2.png, sponsor3.png (etc.)
// Images will be hidden automatically if the file doesn't exist yet.
const SPONSOR_IMAGES = [
  '/sponsors/sponsor1.png',
  '/sponsors/sponsor2.png',
  '/sponsors/sponsor3.png',
];

export default function Home() {
  const { user, profile, loading, isAdmin, isBoardMember, isCoach } = useUser();
  const router = useRouter();

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

  if (loading) return null;

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
          <p className="text-muted-foreground text-sm">Welcome back, SYBA families</p>
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
      </div>

      {/* Sponsors */}
      <div className="mt-16 flex flex-col items-center gap-4 w-full max-w-2xl">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Our Sponsors</p>
        <div className="flex flex-wrap items-center justify-center gap-8">
          {SPONSOR_IMAGES.map((src, i) => (
            <img
              key={i}
              src={src}
              alt={`Sponsor ${i + 1}`}
              className="h-12 w-auto object-contain grayscale hover:grayscale-0 transition-all duration-300"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ))}
        </div>
      </div>

      {/* Footer */}
      <footer className="mt-12 text-xs text-muted-foreground text-center">
        © 2026 SYBA. All rights reserved. Sharpsville, PA.
      </footer>
    </div>
  );
}
