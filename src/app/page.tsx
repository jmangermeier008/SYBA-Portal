"use client";

import { useUser } from '@/firebase';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import Image from 'next/image';
import { Trophy, Users, Calendar, ArrowRight, User as UserIcon } from 'lucide-react';
import { OFFICERS, COORDINATORS } from '@/data/officers';

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
    <div className="flex flex-col min-h-screen">
      <header className="px-4 lg:px-6 h-16 flex items-center border-b bg-white/50 backdrop-blur-md sticky top-0 z-50">
        <Link className="flex items-center justify-center gap-2" href="/">
          <Image
            src="/contentrotator637479479383661633.png"
            alt="SYBA Logo"
            width={40}
            height={40}
            className="object-contain"
            onError={(e) => {
              // Fallback to icon if logo not found
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
          <span className="text-xl font-bold font-headline tracking-tight text-primary">SYBA Portal</span>
        </Link>
        <nav className="ml-auto flex gap-4 sm:gap-6 items-center">
          <Link className="text-sm font-medium hover:text-primary transition-colors" href="/login">
            Login
          </Link>
          <Button asChild className="rounded-full px-6 shadow-md">
            <Link href="/signup">Register Player</Link>
          </Button>
        </nav>
      </header>
      <main className="flex-1">
        <section className="w-full py-12 md:py-24 lg:py-32 xl:py-48 bg-gradient-to-b from-blue-50 to-white">
          <div className="container px-4 md:px-6 mx-auto">
            <div className="flex flex-col items-center space-y-4 text-center">
              <div className="mb-4">
                <Image
                  src="/contentrotator637479479383661633.png"
                  alt="Sharpsville Youth Baseball Association"
                  width={120}
                  height={120}
                  className="object-contain mx-auto"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              </div>
              <div className="space-y-2 max-w-3xl">
                <div className="inline-block rounded-lg bg-primary/10 px-3 py-1 text-sm font-semibold text-primary mb-4">
                  Official Home of Sharpsville Youth Baseball
                </div>
                <h1 className="text-4xl font-bold tracking-tighter sm:text-5xl md:text-6xl lg:text-7xl font-headline">
                  Sharpsville Youth <br />
                  <span className="text-primary italic">Baseball Association</span>
                </h1>
                <p className="mx-auto max-w-[700px] text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed mt-6">
                  Join the tradition. SYBA provides a safe, fun, and competitive environment for the youth of Sharpsville to learn and play the great game of baseball.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-4 mt-8">
                <Button size="lg" className="rounded-full px-8 h-12 text-lg shadow-lg shadow-primary/20" asChild>
                  <Link href="/signup">
                    Register for Spring 2026 <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
                <Button variant="outline" size="lg" className="rounded-full px-8 h-12 text-lg" asChild>
                  <Link href="/login">Parent Dashboard</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section className="w-full py-12 md:py-24 lg:py-32 bg-white">
          <div className="container px-4 md:px-6 mx-auto">
            <div className="grid gap-12 lg:grid-cols-3">
              <div className="flex flex-col items-center space-y-4 text-center group">
                <div className="p-4 bg-primary/10 rounded-2xl group-hover:bg-primary/20 transition-all duration-300">
                  <Users className="h-10 w-10 text-primary" />
                </div>
                <h3 className="text-xl font-bold font-headline">Roster Management</h3>
                <p className="text-muted-foreground">Manage multiple players under one family account. Upload clearances and birth certificates securely.</p>
              </div>
              <div className="flex flex-col items-center space-y-4 text-center group">
                <div className="p-4 bg-primary/10 rounded-2xl group-hover:bg-primary/20 transition-all duration-300">
                  <Calendar className="h-10 w-10 text-primary" />
                </div>
                <h3 className="text-xl font-bold font-headline">Game Schedules</h3>
                <p className="text-muted-foreground">Real-time access to practice times, game locations, and league-wide events for all divisions.</p>
              </div>
            </div>
          </div>
        </section>
        {/* Our Leadership */}
        <section className="w-full py-12 md:py-20 bg-gradient-to-b from-white to-blue-50">
          <div className="container px-4 md:px-6 mx-auto">
            <div className="text-center mb-10">
              <div className="inline-block rounded-lg bg-primary/10 px-3 py-1 text-sm font-semibold text-primary mb-3">
                Our Leadership
              </div>
              <h2 className="text-3xl font-bold font-headline tracking-tight">Meet the Board</h2>
              <p className="text-muted-foreground mt-2 max-w-xl mx-auto">
                SYBA is run by dedicated volunteers from the Sharpsville community.
              </p>
            </div>

            {/* Named Officers */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
              {OFFICERS.map((officer) => (
                <div key={officer.title} className="flex flex-col items-center text-center p-5 bg-white rounded-2xl shadow-sm border border-primary/10">
                  <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xl mb-3">
                    {officer.name ? officer.name[0] : <UserIcon className="h-6 w-6" />}
                  </div>
                  <p className="font-bold text-sm">{officer.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{officer.title}</p>
                </div>
              ))}
            </div>

            {/* Coordinators */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {COORDINATORS.map((coord) => (
                <div key={coord.title} className="flex items-center gap-3 px-4 py-3 bg-white rounded-xl border border-slate-100 shadow-sm">
                  <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                    {coord.name ? (
                      <span className="text-sm font-bold text-slate-500">{coord.name[0]}</span>
                    ) : (
                      <UserIcon className="h-4 w-4 text-slate-400" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-700 truncate">{coord.title}</p>
                    <p className={`text-xs truncate ${coord.name ? 'text-slate-600' : 'text-slate-400 italic'}`}>
                      {coord.name ?? 'TBA'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
      <footer className="w-full py-6 border-t bg-slate-50">
        <div className="container px-4 md:px-6 mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-primary" />
            <p className="text-xs font-semibold text-muted-foreground">Sharpsville Youth Baseball Association</p>
          </div>
          <p className="text-xs text-muted-foreground">© 2026 SYBA. All rights reserved. Sharpsville, PA.</p>
          <nav className="flex gap-4 sm:gap-6">
            <Link className="text-xs hover:underline underline-offset-4" href="#">Terms</Link>
            <Link className="text-xs hover:underline underline-offset-4" href="#">Privacy</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
