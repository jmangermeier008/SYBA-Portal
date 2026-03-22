"use client";

import { Sidebar } from '@/components/navigation/sidebar';
import { NotificationsInbox } from '@/components/notifications/notifications-inbox';
import { Bell } from 'lucide-react';

export default function ParentNotificationsPage() {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold font-headline flex items-center gap-3">
            <Bell className="h-7 w-7 text-primary" />
            Notifications
          </h1>
          <p className="text-muted-foreground">Shift changes, cancellations, and other updates from the league.</p>
        </header>
        <NotificationsInbox />
      </main>
    </div>
  );
}
