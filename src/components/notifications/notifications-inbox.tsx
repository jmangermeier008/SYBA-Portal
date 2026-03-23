"use client";

import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc, query, orderBy, where, updateDoc, writeBatch } from 'firebase/firestore';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Bell, Loader2, CheckCheck, ShoppingCart, Dumbbell, CalendarDays, Megaphone } from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { Notification, NotificationType, NotificationRelatedDocType } from '@/types/scheduling';

// ─── Icon map per notification type ───────────────────────────────────────────

function NotifIcon({ type }: { type: NotificationType }) {
  const base = 'h-5 w-5 shrink-0';
  if (type === 'shiftMoved' || type === 'shiftCancelled' ||
      type === 'concessionSignupConfirmed' || type === 'concessionSignupCancelled') {
    return <ShoppingCart className={cn(base, 'text-amber-500')} />;
  }
  if (type === 'practiceSlotCancelled' || type === 'practiceSlotChanged') {
    return <Dumbbell className={cn(base, 'text-blue-500')} />;
  }
  if (type === 'announcement') {
    return <Megaphone className={cn(base, 'text-primary')} />;
  }
  return <CalendarDays className={cn(base, 'text-primary')} />;
}

// ─── Navigation routing ────────────────────────────────────────────────────────

function getNotifRoute(relatedDocType: NotificationRelatedDocType | undefined, isCoach: boolean): string | null {
  if (relatedDocType === 'concessionSlot') return '/parent/concessions';
  if (relatedDocType === 'practiceSlot') return isCoach ? '/coach/practice-slots' : '/parent/schedules';
  if (relatedDocType === 'game') return isCoach ? '/coach/schedules' : '/parent/schedules';
  if (relatedDocType === 'announcement') return isCoach ? '/coach/announcements' : '/parent/announcements';
  return null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function NotificationsInbox() {
  const db = useFirestore();
  const { user, isCoach } = useUser();
  const router = useRouter();

  const notifQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return query(
      collection(db, 'notifications'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );
  }, [db, user?.uid]);

  const { data: notifications, isLoading } = useCollection<Notification>(notifQuery);

  const unreadCount = (notifications ?? []).filter(n => !n.read).length;

  const formattedTimes = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of notifications ?? []) {
      if (!n.createdAt) continue;
      const date = typeof n.createdAt === 'string'
        ? parseISO(n.createdAt)
        : (n.createdAt as unknown as { toDate(): Date }).toDate();
      map.set(n.id, formatDistanceToNow(date, { addSuffix: true }));
    }
    return map;
  }, [notifications]);

  const handleMarkRead = async (notif: Notification) => {
    if (!db) return;
    if (!notif.read) {
      await updateDoc(doc(db, 'notifications', notif.id), { read: true });
    }
    const route = getNotifRoute(notif.relatedDocType, isCoach);
    if (route) router.push(route);
  };

  const handleMarkAllRead = async () => {
    if (!db || !notifications) return;
    const unread = notifications.filter(n => !n.read);
    if (unread.length === 0) return;
    const batch = writeBatch(db);
    unread.forEach(n => batch.update(doc(db, 'notifications', n.id), { read: true }));
    await batch.commit();
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!notifications || notifications.length === 0) {
    return (
      <Card className="border-none shadow-md">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Bell className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <p className="text-muted-foreground font-medium">No notifications yet</p>
          <p className="text-sm text-muted-foreground">You'll be notified here about games, concession shifts, practice slots, and other league updates.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {unreadCount > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{unreadCount}</span> unread
          </p>
          <Button variant="ghost" size="sm" onClick={handleMarkAllRead} className="text-xs text-muted-foreground">
            <CheckCheck className="h-3.5 w-3.5 mr-1" /> Mark all as read
          </Button>
        </div>
      )}

      <div className="space-y-2">
        {notifications.map(notif => {
          const createdAt = formattedTimes.get(notif.id) ?? '';

          return (
            <button
              key={notif.id}
              onClick={() => handleMarkRead(notif)}
              className={cn(
                'w-full text-left flex items-start gap-3 p-4 rounded-xl border transition-colors',
                notif.read
                  ? 'bg-background border-border hover:bg-secondary/30'
                  : 'bg-blue-50 border-blue-100 hover:bg-blue-100/70'
              )}
            >
              <div className={cn(
                'mt-0.5 p-1.5 rounded-lg shrink-0',
                notif.read ? 'bg-secondary' : 'bg-white'
              )}>
                <NotifIcon type={notif.type} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className={cn('text-sm', notif.read ? 'text-foreground' : 'font-semibold text-foreground')}>
                    {notif.title}
                  </p>
                  {!notif.read && (
                    <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0 mt-1.5" />
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-0.5 leading-snug">{notif.body}</p>
                {createdAt && (
                  <p className="text-xs text-muted-foreground/70 mt-1">{createdAt}</p>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
