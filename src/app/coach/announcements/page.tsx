"use client";

import { useState, useEffect } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import { collection, query, orderBy, where } from 'firebase/firestore';
import { Megaphone, Loader2, Clock, Pin, Search } from 'lucide-react';
import { format } from 'date-fns';
import type { Announcement } from '@/types/scheduling';
import { useSport } from '@/firebase/sport-context';

export default function CoachAnnouncementsPage() {
  const db = useFirestore();
  const { activeSport } = useSport();
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    try {
      localStorage.setItem('syba_coach_announcements_last_read', Date.now().toString());
    } catch {
      // Silently ignore if localStorage is unavailable
    }
  }, []);

  const announcementsQuery = useMemoFirebase(() => {
    if (!db || !activeSport) return null;
    return query(collection(db, 'announcements'), where('sport', '==', activeSport), orderBy('publishedAt', 'desc'));
  }, [db, activeSport]);

  const { data: announcements, isLoading } = useCollection<Announcement>(announcementsQuery);

  const sorted = announcements
    ? [...announcements].sort((a, b) => {
        if (b.pinned !== a.pinned) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
        return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
      })
    : [];

  const filtered = searchQuery.trim()
    ? sorted.filter(a =>
        a.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        a.body.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : sorted;

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6 max-w-3xl">
        <header className="mb-4 md:mb-6">
          <h1 className="text-xl md:text-2xl font-bold font-headline">League Announcements</h1>
          <p className="text-sm text-muted-foreground">Stay up to date with the latest news from SYBA.</p>
        </header>

        <div className="relative mb-6">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search announcements…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 rounded-xl"
          />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <Card className="border-none shadow-md">
            <CardContent className="flex flex-col items-center justify-center py-10 text-center">
              <Megaphone className="h-12 w-12 text-muted-foreground/40 mb-4" />
              <p className="text-muted-foreground font-medium">No announcements found</p>
              <p className="text-sm text-muted-foreground">
                {searchQuery ? 'Try a different search term.' : 'Check back soon for league updates.'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filtered.map((ann) => (
              <Card key={ann.id} className={`border-none shadow-md ${ann.pinned ? 'border-l-4 border-l-primary' : ''}`}>
                <CardContent className="p-3">
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
