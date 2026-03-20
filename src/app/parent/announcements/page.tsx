"use client";

import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import { collection, query, orderBy } from 'firebase/firestore';
import { Megaphone, Loader2, Clock, Pin } from 'lucide-react';
import { format } from 'date-fns';

interface Announcement {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  publishedAt: string;
  publishedBy: string;
}

export default function ParentAnnouncementsPage() {
  const db = useFirestore();

  const announcementsQuery = useMemoFirebase(() => {
    if (!db) return null;
    return query(collection(db, 'announcements'), orderBy('publishedAt', 'desc'));
  }, [db]);

  const { data: announcements, isLoading } = useCollection<Announcement>(announcementsQuery);

  const sorted = announcements
    ? [...announcements].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
    : [];

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar role="parent" />
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8 max-w-3xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold font-headline">League Announcements</h1>
          <p className="text-muted-foreground">Stay up to date with the latest news from SYBA.</p>
        </header>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          </div>
        ) : sorted.length === 0 ? (
          <Card className="border-none shadow-md">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Megaphone className="h-12 w-12 text-muted-foreground/40 mb-4" />
              <p className="text-muted-foreground font-medium">No announcements yet</p>
              <p className="text-sm text-muted-foreground">Check back soon for league updates.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {sorted.map((ann) => (
              <Card key={ann.id} className={`border-none shadow-md ${ann.pinned ? 'border-l-4 border-l-primary' : ''}`}>
                <CardContent className="p-5">
                  <div className="flex items-center gap-2 mb-1">
                    {ann.pinned && (
                      <Badge variant="default" className="text-[10px] px-1.5 py-0 rounded-full">
                        <Pin className="h-2.5 w-2.5 mr-1" /> Pinned
                      </Badge>
                    )}
                    <h3 className="font-bold font-headline text-lg leading-tight">{ann.title}</h3>
                  </div>
                  <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">{ann.body}</p>
                  <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {ann.publishedAt ? format(new Date(ann.publishedAt), 'MMM d, yyyy · h:mm a') : ''}
                    <span>· {ann.publishedBy}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
