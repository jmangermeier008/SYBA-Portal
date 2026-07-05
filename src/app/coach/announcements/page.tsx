"use client";

import { useState, useEffect, useMemo } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useFirestore, useMemoFirebase, useCollection, useUser } from '@/firebase';
import { collection, query, orderBy, where, doc, deleteDoc } from 'firebase/firestore';
import { Megaphone, Loader2, Clock, Pin, Search, Users, Pencil, Trash2, Plus } from 'lucide-react';
import { format } from 'date-fns';
import { isAnnouncementActive, type Announcement } from '@/types/scheduling';
import { useSport } from '@/firebase/sport-context';
import { useToast } from '@/hooks/use-toast';
import { TeamAnnouncementDialog } from '@/components/coach/TeamAnnouncementDialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface Team {
  id: string;
  name: string;
}

export default function CoachAnnouncementsPage() {
  const db = useFirestore();
  const { user, profile } = useUser();
  const { activeSport } = useSport();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Announcement | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem('syba_coach_announcements_last_read', Date.now().toString());
    } catch {
      // Silently ignore if localStorage is unavailable
    }
  }, []);

  const teamsQuery = useMemoFirebase(() => {
    if (!db || !user || !activeSport) return null;
    return query(collection(db, 'teams'), where('coachIds', 'array-contains', user.uid), where('sport', '==', activeSport));
  }, [db, user?.uid, activeSport]);
  const { data: teams } = useCollection<Team>(teamsQuery);
  const coachTeamIds = useMemo(() => (teams ?? []).map(t => t.id), [teams]);

  const announcementsQuery = useMemoFirebase(() => {
    if (!db || !activeSport) return null;
    return query(collection(db, 'announcements'), where('sport', '==', activeSport), orderBy('publishedAt', 'desc'));
  }, [db, activeSport]);

  const { data: announcements, isLoading } = useCollection<Announcement>(announcementsQuery);

  const todayISO = format(new Date(), 'yyyy-MM-dd');
  const sorted = announcements
    ? [...announcements]
        // League posts plus this coach's own teams' posts — other teams' posts stay hidden
        .filter(a => !a.teamId || coachTeamIds.includes(a.teamId))
        .filter(a => isAnnouncementActive(a, todayISO))
        .sort((a, b) => {
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

  const handleDelete = async () => {
    if (!db || !deleteTarget) return;
    try {
      await deleteDoc(doc(db, 'announcements', deleteTarget.id));
      toast({ title: 'Announcement deleted' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Could not delete', description: err.message });
    } finally {
      setDeleteTarget(null);
    }
  };

  const canCompose = (teams?.length ?? 0) > 0;

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6 max-w-3xl">
        <header className="mb-4 md:mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl md:text-2xl font-bold font-headline">Announcements</h1>
            <p className="text-sm text-muted-foreground">League news plus updates you post to your team.</p>
          </div>
          {canCompose && (
            <Button size="sm" onClick={() => { setEditTarget(null); setComposeOpen(true); }}>
              <Plus className="h-4 w-4 mr-1" />
              New Team Announcement
            </Button>
          )}
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
            {filtered.map((ann) => {
              const isOwnTeamPost = !!ann.teamId && ann.createdByUid === user?.uid;
              return (
                <Card key={ann.id} className={`border-none shadow-md ${ann.pinned ? 'border-l-4 border-l-primary' : ''}`}>
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        {ann.pinned && (
                          <Badge variant="default" className="text-[10px] px-1.5 py-0 rounded-full">
                            <Pin className="h-2.5 w-2.5 mr-1" /> Pinned
                          </Badge>
                        )}
                        {ann.teamId && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 rounded-full">
                            <Users className="h-2.5 w-2.5 mr-1" /> {ann.teamName ?? 'Team'}
                          </Badge>
                        )}
                        <h3 className="font-bold font-headline text-lg leading-tight">{ann.title}</h3>
                      </div>
                      {isOwnTeamPost && (
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => { setEditTarget(ann); setComposeOpen(true); }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            onClick={() => setDeleteTarget(ann)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                    <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">{ann.body}</p>
                    <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {ann.publishedAt ? format(new Date(ann.publishedAt), 'MMM d, yyyy · h:mm a') : ''}
                      {ann.publishedBy && <span>· {ann.publishedBy}</span>}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <TeamAnnouncementDialog
          open={composeOpen}
          onOpenChange={setComposeOpen}
          db={db}
          sport={activeSport}
          teams={(teams ?? []).map(t => ({ id: t.id, name: t.name }))}
          creator={{ uid: user?.uid ?? '', name: profile?.displayName ?? undefined }}
          editTarget={editTarget}
        />

        <AlertDialog open={!!deleteTarget} onOpenChange={(next) => !next && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this announcement?</AlertDialogTitle>
              <AlertDialogDescription>
                "{deleteTarget?.title}" will be removed for your team's families. This can't be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </main>
    </div>
  );
}
