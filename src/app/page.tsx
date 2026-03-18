"use client";

import { useUser } from '@/firebase';
import { useRouter } from 'next/navigation';
import { useEffect, use } from 'react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Trophy, Users, Calendar, MessageSquare, ArrowRight } from 'lucide-react';

export default function Home({
  params,
  searchParams,
}: {
  params: Promise<any>;
  searchParams: Promise<any>;
}) {
  // Unwrap dynamic props in Client Component using React.use()
  use(params);
  use(searchParams);

  const { user, profile, loading } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user && profile) {
      router.push(`/${profile.role.toLowerCase()}/dashboard`);
    }
  }, [user, profile, loading, router]);

  if (loading) return null;

  return (
    <div className="flex flex-col min-h-screen">
      <header className="px-4 lg:px-6 h-16 flex items-center border-b bg-white/50 backdrop-blur-md sticky top-0 z-50">
        <Link className="flex items-center justify-center gap-2" href="/">
          <Trophy className="h-6 w-6 text-primary" />
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
                    Sign Up for 2024 <ArrowRight className="ml-2 h-5 w-5" />
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
                <div className="p-4 bg-accent/10 rounded-2xl group-hover:bg-accent/20 transition-all duration-300">
                  <Calendar className="h-10 w-10 text-accent-foreground" />
                </div>
                <h3 className="text-xl font-bold font-headline">Game Schedules</h3>
                <p className="text-muted-foreground">Real-time access to practice times, game locations, and league-wide events for all divisions.</p>
              </div>
              <div className="flex flex-col items-center space-y-4 text-center group">
                <div className="p-4 bg-secondary rounded-2xl group-hover:bg-secondary/80 transition-all duration-300">
                  <MessageSquare className="h-10 w-10 text-primary" />
                </div>
                <h3 className="text-xl font-bold font-headline">Team Communication</h3>
                <p className="text-muted-foreground">Stay connected with coaches and other parents through built-in team chats and rainout alerts.</p>
              </div>
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
          <p className="text-xs text-muted-foreground">© 2024 SYBA. All rights reserved. Sharpsville, PA.</p>
          <nav className="flex gap-4 sm:gap-6">
            <Link className="text-xs hover:underline underline-offset-4" href="#">Terms</Link>
            <Link className="text-xs hover:underline underline-offset-4" href="#">Privacy</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
