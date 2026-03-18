"use client";

import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useAuth } from '@/lib/firebase/auth-context';
import { Users, Calendar, Trophy, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default function ParentDashboard() {
  const { profile } = useAuth();

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar role="parent" />
      <main className="flex-1 ml-64 p-8">
        <header className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold font-headline">Welcome back, {profile?.displayName?.split(' ')[0]}</h1>
            <p className="text-muted-foreground">Here's what's happening with your family's baseball activities.</p>
          </div>
          <Button asChild className="rounded-full">
            <Link href="/parent/family">Add New Player</Link>
          </Button>
        </header>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-8">
          <Card className="border-none shadow-md">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Players</CardTitle>
              <Users className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">2</div>
              <p className="text-xs text-muted-foreground">Active in Spring 2024</p>
            </CardContent>
          </Card>
          <Card className="border-none shadow-md">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Next Game</CardTitle>
              <Calendar className="h-4 w-4 text-accent-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">Saturday</div>
              <p className="text-xs text-muted-foreground">10:00 AM @ Field 3</p>
            </CardContent>
          </Card>
          <Card className="border-none shadow-md">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Team Rank</CardTitle>
              <Trophy className="h-4 w-4 text-yellow-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">2nd</div>
              <p className="text-xs text-muted-foreground">Division: Minor League</p>
            </CardContent>
          </Card>
          <Card className="border-none shadow-md">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">RSVP Needed</CardTitle>
              <AlertCircle className="h-4 w-4 text-destructive" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">1</div>
              <p className="text-xs text-muted-foreground">Practice on Thursday</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card className="border-none shadow-md">
            <CardHeader>
              <CardTitle className="font-headline">Recent Activity</CardTitle>
              <CardDescription>Stay updated with your teams</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-start gap-4 p-3 rounded-lg bg-secondary/30">
                    <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary">
                      <MessageSquare className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">Coach Smith posted in Team Chat</p>
                      <p className="text-xs text-muted-foreground">"Great game today everyone! Don't forget next practice is..."</p>
                      <p className="text-[10px] text-muted-foreground mt-1">2 hours ago</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-md">
            <CardHeader>
              <CardTitle className="font-headline">Season Enrollment</CardTitle>
              <CardDescription>Register for upcoming seasons</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center justify-center py-8 text-center">
              <Trophy className="h-12 w-12 text-muted mb-4" />
              <h3 className="font-semibold mb-2">Summer 2024 Enrollment Open</h3>
              <p className="text-sm text-muted-foreground mb-6">Register your players for the upcoming Summer All-Star season.</p>
              <Button asChild variant="outline" className="rounded-full px-8">
                <Link href="/parent/enroll">Enroll Now</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}