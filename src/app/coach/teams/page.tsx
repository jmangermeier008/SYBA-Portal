"use client";

import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Users, UserPlus, Mail, ChevronRight } from 'lucide-react';
import Link from 'next/link';

export default function CoachTeamsPage() {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar role="coach" />
      <main className="flex-1 ml-64 p-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold font-headline">My Teams</h1>
          <p className="text-muted-foreground">Manage your assigned rosters and contact information.</p>
        </header>

        <div className="grid gap-6">
          <Card className="border-none shadow-lg overflow-hidden">
            <CardHeader className="bg-primary text-primary-foreground">
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="text-2xl font-headline">Blue Jays</CardTitle>
                  <CardDescription className="text-primary-foreground/80">T-Ball Division • Spring 2024</CardDescription>
                </div>
                <Button variant="secondary" size="sm" className="rounded-full">
                  <Mail className="mr-2 h-4 w-4" /> Email All Parents
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="p-6 border-b bg-secondary/10 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex -space-x-2">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className="w-8 h-8 rounded-full border-2 border-white bg-accent flex items-center justify-center text-[10px] text-white font-bold">
                        P{i}
                      </div>
                    ))}
                    <div className="w-8 h-8 rounded-full border-2 border-white bg-muted flex items-center justify-center text-[10px] text-muted-foreground font-bold">
                      +8
                    </div>
                  </div>
                  <p className="text-sm font-medium">12 Players Registered</p>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/coach/teams/blue-jays">
                    Manage Roster <ChevronRight className="ml-1 h-4 w-4" />
                  </Link>
                </Button>
              </div>
              <div className="p-6">
                <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4">Team Coaches</h4>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                    CS
                  </div>
                  <div>
                    <p className="font-semibold text-sm">Coach Smith (Head Coach)</p>
                    <p className="text-xs text-muted-foreground">coach.smith@example.com • 555-0123</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
