
"use client";

import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useUser } from '@/firebase';
import { Dumbbell, Users, Calendar, Star, Send, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export default function CoachDashboard() {
  const { profile } = useUser();

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar role="coach" />
      <main className="flex-1 ml-64 p-8">
        <header className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold font-headline">Coach Dashboard</h1>
            <p className="text-muted-foreground">Manage your teams and plan your next practice.</p>
          </div>
          <div className="flex gap-4">
            <Button variant="outline" asChild className="rounded-full">
              <Link href="/coach/drills">
                <Dumbbell className="mr-2 h-4 w-4" /> AI Practice Generator
              </Link>
            </Button>
            <Button className="rounded-full" asChild>
              <Link href="/coach/chat">
                <Send className="mr-2 h-4 w-4" /> Send Broadcast
              </Link>
            </Button>
          </div>
        </header>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-8">
          <Card className="border-none shadow-md">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">My Teams</CardTitle>
              <Users className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">1</div>
              <p className="text-xs text-muted-foreground">T-Ball: Blue Jays</p>
            </CardContent>
          </Card>
          <Card className="border-none shadow-md">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Players</CardTitle>
              <Star className="h-4 w-4 text-accent-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">12</div>
              <p className="text-xs text-muted-foreground">Roster Size</p>
            </CardContent>
          </Card>
          <Card className="border-none shadow-md">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Next Event</CardTitle>
              <Calendar className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">Practice</div>
              <p className="text-xs text-muted-foreground">Thursday @ 5:30 PM</p>
            </CardContent>
          </Card>
          <Card className="border-none shadow-md">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Headcount</CardTitle>
              <Users className="h-4 w-4 text-accent-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">9 / 12</div>
              <p className="text-xs text-muted-foreground">RSVPs for next event</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <Card className="md:col-span-2 border-none shadow-md">
            <CardHeader>
              <CardTitle className="font-headline">Team Schedule</CardTitle>
              <CardDescription>Upcoming games and practices for the Blue Jays</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[
                  { type: 'Practice', date: 'Thu, Mar 14', time: '5:30 PM', rsvp: '9 confirmed' },
                  { type: 'Game vs Tigers', date: 'Sat, Mar 16', time: '10:00 AM', rsvp: '11 confirmed' },
                  { type: 'Practice', date: 'Tue, Mar 19', time: '5:30 PM', rsvp: '0 confirmed' },
                ].map((item, i) => (
                  <div key={i} className="flex items-center justify-between p-4 rounded-lg bg-secondary/20">
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-12 h-12 rounded-xl flex items-center justify-center font-bold text-white shadow-sm",
                        item.type.includes('Game') ? "bg-primary" : "bg-accent"
                      )}>
                        {item.type[0]}
                      </div>
                      <div>
                        <p className="font-semibold">{item.type}</p>
                        <p className="text-xs text-muted-foreground">{item.date} • {item.time}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-primary">{item.rsvp}</p>
                      <Button variant="ghost" size="sm" className="h-8 text-xs" asChild>
                        <Link href="/coach/schedules">Manage</Link>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-md">
            <CardHeader>
              <CardTitle className="font-headline">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button className="w-full justify-start rounded-xl py-6 h-auto" variant="outline" asChild>
                <Link href="/coach/drills">
                  <div className="text-left">
                    <p className="font-semibold flex items-center gap-2"><Dumbbell className="h-4 w-4" /> AI Practice Builder</p>
                    <p className="text-xs text-muted-foreground">Generate drills for today's session</p>
                  </div>
                </Link>
              </Button>
              <Button className="w-full justify-start rounded-xl py-6 h-auto" variant="outline" asChild>
                <Link href="/coach/teams">
                  <div className="text-left">
                    <p className="font-semibold flex items-center gap-2"><Users className="h-4 w-4" /> Roster Management</p>
                    <p className="text-xs text-muted-foreground">View player details and contacts</p>
                  </div>
                </Link>
              </Button>
              <Button className="w-full justify-start rounded-xl py-6 h-auto" variant="outline" asChild>
                <Link href="/coach/chat">
                  <div className="text-left">
                    <p className="font-semibold flex items-center gap-2"><MessageSquare className="h-4 w-4" /> Team Communication</p>
                    <p className="text-xs text-muted-foreground">Message parents and staff</p>
                  </div>
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
