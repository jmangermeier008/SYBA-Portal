"use client";

import { Sidebar } from '@/components/navigation/sidebar';
import { CalendarDays } from 'lucide-react';
import { AdminLeagueCalendar } from '@/components/calendar/AdminLeagueCalendar';

/** League Calendar page — a shell around AdminLeagueCalendar, the single
 *  shared admin calendar (also rendered on the Games page and the Dashboard
 *  calendar tab, always with identical data and actions). */
export default function AdminCalendarPage() {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6 min-w-0 overflow-x-auto">
        <header className="mb-4 md:mb-6">
          <h1 className="text-xl md:text-2xl font-bold font-headline flex items-center gap-3">
            <CalendarDays className="h-7 w-7 text-primary" />
            League Calendar
          </h1>
          <p className="text-sm text-muted-foreground">
            Full view of all games, practices, concession shifts, closures, and events.
          </p>
        </header>

        <AdminLeagueCalendar />
      </main>
    </div>
  );
}
