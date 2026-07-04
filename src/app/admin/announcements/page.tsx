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
import { collection, query, orderBy, doc, addDoc, updateDoc, deleteDoc, deleteField, getDocs, writeBatch, where, Timestamp } from 'firebase/firestore';
import { Megaphone, Plus, Trash2, Loader2, Lock, Clock, Pin, AlertTriangle, Pencil, CalendarClock } from 'lucide-react';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import type { Announcement } from '@/types/scheduling';

const EMPTY_FORM = { title: '', body: '', pinned: false, isGlobal: false, isUrgent: false, expiresAt: '', notify: true };

export default function AdminAnnouncementsPage() {
  const { profile, loading: loadingUser } = useUser();
  const { activeSport, isAdmin, isBoardMember } = useSport();
  const db = useFirestore();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Announcement | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null);
  const [deleting, setDeleting] = useState(false);

  const announcementsQuery = useMemoFirebase(() => {
    if (!db || !activeSport) return null;
    return query(collection(db, 'announcements'), where('sport', '==', activeSport), orderBy('publishedAt', 'desc'));
  }, [db, activeSport]);

  const { data: announcements, isLoading } = useCollection<Announcement>(announcementsQuery);

  const openAdd = () => {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (ann: Announcement) => {
    setEditTarget(ann);
    setForm({
      title: ann.title,
      body: ann.body,
      pinned: ann.pinned ?? false,
      isGlobal: ann.isGlobal ?? false,
      isUrgent: ann.isUrgent ?? false,
      expiresAt: ann.expiresAt ?? '',
      notify: false, // editing is silent unless the admin opts in
    });
    setDialogOpen(true);
  };

  // Fan-out: create an in-app notification for every user. Every authenticated
  // user is a baseline parent, so all profiles are notified — the notification
  // inbox scopes display by sport via the notification's own sport field.
  const fanOutNotifications = async (announcementId: string, title: string, body: string, isGlobal: boolean) => {
    if (!db) return;
    const usersSnap = await getDocs(collection(db, 'userProfiles'));
    if (usersSnap.empty) return;
    const notifBatch = writeBatch(db);
    const bodyPreview = body.length > 120 ? body.slice(0, 120) + '…' : body;
    usersSnap.forEach(userDoc => {
      notifBatch.set(doc(db, 'notifications', crypto.randomUUID()), {
        userId: userDoc.id,
        type: 'announcement',
        title,
        body: bodyPreview,
        relatedDocId: announcementId,
        relatedDocType: 'announcement',
        read: false,
        createdAt: Timestamp.now(),
        isGlobal,
        ...(isGlobal ? {} : { sport: activeSport }),
      });
    });
    await notifBatch.commit();
  };

  const handleSave = async () => {
    if (!form.title.trim() || !form.body.trim() || !db) return;
    setSaving(true);
    const title = form.title.trim();
    const body = form.body.trim();
    try {
      if (editTarget) {
        await updateDoc(doc(db, 'announcements', editTarget.id), {
          title,
          body,
          pinned: form.pinned,
          isGlobal: form.isGlobal,
          isUrgent: form.isUrgent,
          ...(form.isGlobal ? { sport: deleteField() } : { sport: activeSport }),
          ...(form.expiresAt ? { expiresAt: form.expiresAt } : { expiresAt: deleteField() }),
          updatedAt: new Date().toISOString(),
        });
        if (form.notify) await fanOutNotifications(editTarget.id, title, body, form.isGlobal);
        toast({ title: form.notify ? 'Announcement Updated & Everyone Re-Notified' : 'Announcement Updated' });
      } else {
        const newDocRef = await addDoc(collection(db, 'announcements'), {
          title,
          body,
          pinned: form.pinned,
          isGlobal: form.isGlobal,
          isUrgent: form.isUrgent,
          ...(form.isGlobal ? {} : { sport: activeSport }),
          ...(form.expiresAt ? { expiresAt: form.expiresAt } : {}),
          publishedAt: new Date().toISOString(),
          publishedBy: profile?.displayName || 'Admin',
        });
        if (form.notify) await fanOutNotifications(newDocRef.id, title, body, form.isGlobal);
        toast({ title: form.notify ? 'Announcement Published' : 'Announcement Published Quietly' });
      }
      setDialogOpen(false);
      setEditTarget(null);
      setForm(EMPTY_FORM);
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

  const todayISO = format(new Date(), 'yyyy-MM-dd');
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
          <Button onClick={openAdd} className="rounded-full shadow-lg">
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
              <Button onClick={openAdd} className="rounded-full">
                <Plus className="mr-2 h-4 w-4" /> New Announcement
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {sorted.map((ann) => {
              const expired = !!ann.expiresAt && ann.expiresAt < todayISO;
              return (
              <Card key={ann.id} className={`border-none shadow-md ${expired ? 'opacity-60' : ''} ${ann.isUrgent ? 'border-l-4 border-l-destructive' : ann.pinned ? 'border-l-4 border-l-primary' : ''}`}>
                <CardContent className="p-3">
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        {ann.isUrgent && (
                          <Badge variant="destructive" className="text-[10px] px-1.5 py-0 rounded-full">
                            <AlertTriangle className="h-2.5 w-2.5 mr-1" /> Urgent
                          </Badge>
                        )}
                        {ann.pinned && (
                          <Badge variant="default" className="text-[10px] px-1.5 py-0 rounded-full">
                            <Pin className="h-2.5 w-2.5 mr-1" /> Pinned
                          </Badge>
                        )}
                        {expired && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 rounded-full">
                            <CalendarClock className="h-2.5 w-2.5 mr-1" /> Expired
                          </Badge>
                        )}
                        <h3 className="font-bold font-headline text-lg leading-tight">{ann.title}</h3>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{ann.body}</p>
                      <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground flex-wrap">
                        <Clock className="h-3 w-3" />
                        {ann.publishedAt ? format(new Date(ann.publishedAt), 'MMM d, yyyy · h:mm a') : ''}
                        <span>· {ann.publishedBy}</span>
                        {ann.updatedAt && <span>· edited {format(new Date(ann.updatedAt), 'MMM d, h:mm a')}</span>}
                        {ann.expiresAt && !expired && (
                          <span>· shows until {format(new Date(ann.expiresAt + 'T00:00:00'), 'MMM d, yyyy')}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-primary"
                        onClick={() => openEdit(ann)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteTarget(ann)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
              );
            })}
          </div>
        )}
      </main>

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!saving) setDialogOpen(open); }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editTarget ? 'Edit Announcement' : 'New Announcement'}</DialogTitle>
            <DialogDescription>
              {editTarget
                ? 'Changes appear everywhere immediately. Notifications are only sent if you choose to re-notify below.'
                : 'This will be visible to all parents and coaches on the portal.'}
            </DialogDescription>
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
            <div className="flex items-center gap-3">
              <Switch
                id="isUrgent"
                checked={form.isUrgent}
                onCheckedChange={(v) => setForm(f => ({ ...f, isUrgent: v }))}
              />
              <div>
                <Label htmlFor="isUrgent" className="cursor-pointer">
                  Mark as urgent
                </Label>
                <p className="text-xs text-muted-foreground">Shows as an attention-grabbing banner on parent dashboards until dismissed.</p>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ann-expires">Show until <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                id="ann-expires"
                type="date"
                value={form.expiresAt}
                onChange={(e) => setForm(f => ({ ...f, expiresAt: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">After this date the announcement automatically stops showing to families. Leave blank to show indefinitely.</p>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="notify"
                checked={form.notify}
                onCheckedChange={(v) => setForm(f => ({ ...f, notify: v }))}
              />
              <div>
                <Label htmlFor="notify" className="cursor-pointer">
                  {editTarget ? 'Notify everyone again' : 'Send notification to everyone'}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {editTarget
                    ? 'Off by default — small fixes shouldn’t ping every family. Turn on for substantive changes.'
                    : 'Turn off to publish quietly (e.g. while testing) — the announcement still appears on the portal.'}
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.title.trim() || !form.body.trim()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {editTarget ? 'Save Changes' : 'Publish'}
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
