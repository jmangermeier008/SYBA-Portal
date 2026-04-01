"use client";

import { Sidebar } from '@/components/navigation/sidebar';
import { NotificationsInbox } from '@/components/notifications/notifications-inbox';
import { Bell } from 'lucide-react';

export default function CoachNotificationsPage() {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6">
        <header className="mb-4 md:mb-6">
          <h1 className="text-xl md:text-2xl font-bold font-headline flex items-center gap-3">
            <Bell className="h-7 w-7 text-primary" />
            Notifications
          </h1>
          <p className="text-sm text-muted-foreground">Practice slot changes and other updates from the board.</p>
        </header>
        <NotificationsInbox />
      </main>
    </div>
  );
}
