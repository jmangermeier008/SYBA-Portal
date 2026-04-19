"use client";

import { useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useUser, useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import { useSport } from '@/firebase/sport-context';
import { collection, query, orderBy, doc, addDoc, deleteDoc, getDocs, writeBatch, where, Timestamp } from 'firebase/firestore';
import { Megaphone, Plus, Trash2, Loader2, Lock, Clock, Pin } from 'lucide-react';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import type { Announcement } from '@/types/scheduling';

export default function AdminAnnouncementsPage() {
  const { profile, loading: loadingUser } = useUser();
  const { activeSport, isAdmin, isBoardMember } = useSport();
  const db = useFirestore();
  const { toast } = useToast();

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ title: '', body: '', pinned: false, isGlobal: false });
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null);
  const [deleting, setDeleting] = useState(false);

  const announcementsQuery = useMemoFirebase(() => {
    if (!db || !activeSport) return null;
    return query(collection(db, 'announcements'), where('sport', '==', activeSport), orderBy('publishedAt', 'desc'));
  }, [db, activeSport]);

  const { data: announcements, isLoading } = useCollection<Announcement>(announcementsQuery);

  const handleAdd = async () => {
    if (!form.title.trim() || !form.body.trim() || !db) return;
    setSaving(true);
    try {
      const newDocRef = await addDoc(collection(db, 'announcements'), {
        title: form.title.trim(),
        body: form.body.trim(),
        pinned: form.pinned,
        isGlobal: form.isGlobal,
        ...(form.isGlobal ? {} : { sport: activeSport }),
        publishedAt: new Date().toISOString(),
        publishedBy: profile?.displayName || 'Admin',
      });

      // Fan-out: create a notification for every coach and parent
      const usersSnap = await getDocs(
        query(collection(db, 'userProfiles'), where('roles', 'array-contains-any', ['Coach', 'Parent']))
      );
      if (!usersSnap.empty) {
        const notifBatch = writeBatch(db);
        const bodyPreview = form.body.length > 120 ? form.body.slice(0, 120) + '…' : form.body;
        usersSnap.forEach(userDoc => {
          notifBatch.set(doc(db, 'notifications', crypto.randomUUID()), {
            userId: userDoc.id,
            type: 'announcement',
            title: form.title.trim(),
            body: bodyPreview,
            relatedDocId: newDocRef.id,
            relatedDocType: 'announcement',
            read: false,
            createdAt: Timestamp.now(),
            isGlobal: form.isGlobal,
            ...(form.isGlobal ? {} : { sport: activeSport }),
          });
        });
        await notifBatch.commit();
      }

      toast({ title: 'Announcement Published' });
      setAddOpen(false);
      setForm({ title: '', body: '', pinned: false, isGlobal: false });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget || !db) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'announcements', deleteTarget.id));
      toast({ title: 'Announcement Removed' });
      setDeleteTarget(null);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  if (loadingUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAdmin && !isBoardMember) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 md:ml-64 p-3 pt-16 flex items-center justify-center">
          <Card className="max-w-md text-center border-none shadow-xl">
            <CardHeader>
              <Lock className="h-12 w-12 text-destructive mx-auto mb-4" />
              <CardTitle>Access Denied</CardTitle>
            </CardHeader>
          </Card>
        </main>
      </div>
    );
  }

  const sorted = announcements
    ? [...announcements].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
    : [];

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6 max-w-4xl">
        <header className="mb-4 md:mb-6 flex justify-between items-start">
          <div>
            <h1 className="text-xl md:text-2xl font-bold font-headline">League Announcements</h1>
            <p className="text-sm text-muted-foreground">Publish league-wide notices visible to all parents and coaches.</p>
          </div>
          <Button onClick={() => setAddOpen(true)} className="rounded-full shadow-lg">
            <Plus className="mr-2 h-4 w-4" /> New Announcement
          </Button>
        </header>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          </div>
        ) : sorted.length === 0 ? (
          <Card className="border-none shadow-md">
            <CardContent className="flex flex-col items-center justify-center py-10 text-center">
              <Megaphone className="h-12 w-12 text-muted-foreground/40 mb-4" />
              <p className="text-muted-foreground font-medium">No announcements yet</p>
              <p className="text-sm text-muted-foreground mb-4">Publish your first league-wide announcement.</p>
              <Button onClick={() => setAddOpen(true)} className="rounded-full">
                <Plus className="mr-2 h-4 w-4" /> New Announcement
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {sorted.map((ann) => (
              <Card key={ann.id} className={`border-none shadow-md ${ann.pinned ? 'border-l-4 border-l-primary' : ''}`}>
                <CardContent className="p-3">
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {ann.pinned && (
                          <Badge variant="default" className="text-[10px] px-1.5 py-0 rounded-full">
                            <Pin className="h-2.5 w-2.5 mr-1" /> Pinned
                          </Badge>
                        )}
                        <h3 className="font-bold font-headline text-lg leading-tight">{ann.title}</h3>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{ann.body}</p>
                      <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {ann.publishedAt ? format(new Date(ann.publishedAt), 'MMM d, yyyy · h:mm a') : ''}
                        <span>· {ann.publishedBy}</span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => setDeleteTarget(ann)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      {/* Add Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New Announcement</DialogTitle>
            <DialogDescription>This will be visible to all parents and coaches on the portal.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="ann-title">Title *</Label>
              <Input
                id="ann-title"
                placeholder="e.g. Opening Day Details"
                value={form.title}
                onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ann-body">Message *</Label>
              <Textarea
                id="ann-body"
                placeholder="Write the announcement content..."
                rows={4}
                value={form.body}
                onChange={(e) => setForm(f => ({ ...f, body: e.target.value }))}
                className="resize-none rounded-xl"
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="pinned"
                checked={form.pinned}
                onCheckedChange={(v) => setForm(f => ({ ...f, pinned: v }))}
              />
              <Label htmlFor="pinned" className="cursor-pointer">
                Pin to top of announcements
              </Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="isGlobal"
                checked={form.isGlobal}
                onCheckedChange={(v) => setForm(f => ({ ...f, isGlobal: v }))}
              />
              <div>
                <Label htmlFor="isGlobal" className="cursor-pointer">
                  Association-Wide Alert
                </Label>
                <p className="text-xs text-muted-foreground">Show this notification in all sport workspaces (Baseball &amp; Football).</p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleAdd} disabled={saving || !form.title.trim() || !form.body.trim()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !deleting && !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove Announcement</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove <strong>{deleteTarget?.title}</strong>? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
