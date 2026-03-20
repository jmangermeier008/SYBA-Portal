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
import { collection, query, orderBy, doc, addDoc, deleteDoc } from 'firebase/firestore';
import { Megaphone, Plus, Trash2, Loader2, Lock, Clock, Pin } from 'lucide-react';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';

interface Announcement {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  publishedAt: string;
  publishedBy: string;
}

export default function AdminAnnouncementsPage() {
  const { isAdmin, isBoardMember, profile, loading: loadingUser } = useUser();
  const db = useFirestore();
  const { toast } = useToast();

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ title: '', body: '', pinned: false });
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null);
  const [deleting, setDeleting] = useState(false);

  const announcementsQuery = useMemoFirebase(() => {
    if (!db) return null;
    return query(collection(db, 'announcements'), orderBy('publishedAt', 'desc'));
  }, [db]);

  const { data: announcements, isLoading } = useCollection<Announcement>(announcementsQuery);

  const handleAdd = async () => {
    if (!form.title.trim() || !form.body.trim() || !db) return;
    setSaving(true);
    try {
      await addDoc(collection(db, 'announcements'), {
        title: form.title.trim(),
        body: form.body.trim(),
        pinned: form.pinned,
        publishedAt: new Date().toISOString(),
        publishedBy: profile?.displayName || 'Admin',
      });
      toast({ title: 'Announcement Published' });
      setAddOpen(false);
      setForm({ title: '', body: '', pinned: false });
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
        <main className="flex-1 md:ml-64 p-8 pt-16 md:pt-8 flex items-center justify-center">
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
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8 max-w-4xl">
        <header className="mb-8 flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold font-headline">League Announcements</h1>
            <p className="text-muted-foreground">Publish league-wide notices visible to all parents and coaches.</p>
          </div>
          <Button onClick={() => setAddOpen(true)} className="rounded-full shadow-lg">
            <Plus className="mr-2 h-4 w-4" /> New Announcement
          </Button>
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
                <CardContent className="p-5">
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
