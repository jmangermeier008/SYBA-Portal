
"use client";

import { useUser } from '@/firebase';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Trophy, Users, Calendar, MessageSquare, ArrowRight } from 'lucide-react';

export default function Home() {
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
          <span className="text-xl font-bold font-headline tracking-tight text-primary">Home Run Hub</span>
        </Link>
        <nav className="ml-auto flex gap-4 sm:gap-6 items-center">
          <Link className="text-sm font-medium hover:text-primary transition-colors" href="/login">
            Login
          </Link>
          <Button asChild className="rounded-full px-6">
            <Link href="/signup">Get Started</Link>
          </Button>
        </nav>
      </header>
      <main className="flex-1">
        <section className="w-full py-12 md:py-24 lg:py-32 xl:py-48 bg-gradient-to-b from-white to-background">
          <div className="container px-4 md:px-6 mx-auto">
            <div className="flex flex-col items-center space-y-4 text-center">
              <div className="space-y-2 max-w-3xl">
                <h1 className="text-4xl font-bold tracking-tighter sm:text-5xl md:text-6xl lg:text-7xl font-headline">
                  The All-in-One Hub for <span className="text-primary italic">Youth Sports</span>
                </h1>
                <p className="mx-auto max-w-[700px] text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
                  Streamline team management, registration, and communication. Built for parents, coaches, and administrators who love the game.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-4">
                <Button size="lg" className="rounded-full px-8 h-12 text-lg shadow-lg shadow-primary/20" asChild>
                  <Link href="/signup">
                    Sign Up Now <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
                <Button variant="outline" size="lg" className="rounded-full px-8 h-12 text-lg" asChild>
                  <Link href="/login">Parent Login</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section className="w-full py-12 md:py-24 lg:py-32 bg-white">
          <div className="container px-4 md:px-6 mx-auto">
            <div className="grid gap-12 lg:grid-cols-3">
              <div className="flex flex-col items-center space-y-4 text-center group">
                <div className="p-4 bg-primary/10 rounded-2xl group-hover:bg-primary/20 transition-colors">
                  <span className="h-10 w-10 text-primary flex items-center justify-center">
                    <Users className="h-10 w-10" />
                  </span>
                </div>
                <h3 className="text-xl font-bold font-headline">Family Management</h3>
                <p className="text-muted-foreground">Easily manage your children's profiles, documents, and enrollments in one secure dashboard.</p>
              </div>
              <div className="flex flex-col items-center space-y-4 text-center group">
                <div className="p-4 bg-accent/10 rounded-2xl group-hover:bg-accent/20 transition-colors">
                  <span className="h-10 w-10 text-accent-foreground flex items-center justify-center">
                    <Calendar className="h-10 w-10" />
                  </span>
                </div>
                <h3 className="text-xl font-bold font-headline">Team Scheduling</h3>
                <p className="text-muted-foreground">Real-time schedules with RSVP tracking. Know who's coming to the game instantly.</p>
              </div>
              <div className="flex flex-col items-center space-y-4 text-center group">
                <div className="p-4 bg-secondary rounded-2xl group-hover:bg-secondary/80 transition-colors">
                  <span className="h-10 w-10 text-primary flex items-center justify-center">
                    <MessageSquare className="h-10 w-10" />
                  </span>
                </div>
                <h3 className="text-xl font-bold font-headline">Team Chat</h3>
                <p className="text-muted-foreground">Secure team communication with instant broadcast notifications for urgent updates.</p>
              </div>
            </div>
          </div>
        </section>
      </main>
      <footer className="w-full py-6 border-t bg-white">
        <div className="container px-4 md:px-6 mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">© 2024 Home Run Hub. All rights reserved.</p>
          <nav className="flex gap-4 sm:gap-6">
            <Link className="text-xs hover:underline underline-offset-4" href="#">Terms of Service</Link>
            <Link className="text-xs hover:underline underline-offset-4" href="#">Privacy Policy</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
