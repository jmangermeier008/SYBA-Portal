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
import { Megaphone, Plus, Trash2, Loader2, Lock, Clock, Pin, AlertTriangle, Pencil, CalendarClock, Mail } from 'lucide-react';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import type { Announcement, Division } from '@/types/scheduling';

type AudienceType = 'all' | 'team' | 'division';

const EMPTY_FORM = {
  title: '', body: '', pinned: false, isGlobal: false, isUrgent: false, expiresAt: '', notify: true,
  sendEmail: false, audienceType: 'all' as AudienceType, audienceTeamId: '', audienceDivisionId: '',
};

interface TeamOption {
  id: string;
  name: string;
  seasonId: string;
}

// Everything the confirm-before-send dialog needs, captured at save time so it
// survives the form reset.
interface PendingEmail {
  title: string;
  body: string;
  isGlobal: boolean;
  audience: { type: AudienceType; teamId?: string; divisionId?: string; seasonId?: string };
  audienceLabel: string;
  audienceSize: number | null; // null while the dry-run count loads
}

export default function AdminAnnouncementsPage() {
  const { user, profile, loading: loadingUser } = useUser();
  const { activeSport, isAdmin, isBoardMember } = useSport();
  const db = useFirestore();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Announcement | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [pendingEmail, setPendingEmail] = useState<PendingEmail | null>(null);
  const [sendingEmail, setSendingEmail] = useState(false);

  const announcementsQuery = useMemoFirebase(() => {
    if (!db || !activeSport) return null;
    return query(collection(db, 'announcements'), where('sport', '==', activeSport), orderBy('publishedAt', 'desc'));
  }, [db, activeSport]);

  const { data: announcements, isLoading } = useCollection<Announcement>(announcementsQuery);

  // Audience targeting options — teams and divisions of this sport's active season
  const seasonsQuery = useMemoFirebase(() => {
    if (!db || !activeSport) return null;
    return query(collection(db, 'seasons'), where('sport', '==', activeSport));
  }, [db, activeSport]);
  const { data: seasons } = useCollection<{ id: string; isActive?: boolean; status?: string }>(seasonsQuery);
  const activeSeasonId = seasons?.find(s => s.isActive || s.status === 'active')?.id ?? null;

  const teamsQuery = useMemoFirebase(() => {
    if (!db || !activeSeasonId) return null;
    return query(collection(db, 'teams'), where('seasonId', '==', activeSeasonId));
  }, [db, activeSeasonId]);
  const { data: teams } = useCollection<TeamOption>(teamsQuery);

  const divisionsQuery = useMemoFirebase(() => {
    if (!db || !activeSeasonId) return null;
    return collection(db, 'seasons', activeSeasonId, 'divisions');
  }, [db, activeSeasonId]);
  const { data: divisions } = useCollection<Division>(divisionsQuery);

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
      sendEmail: false,
      audienceType: 'all',
      audienceTeamId: '',
      audienceDivisionId: '',
    });
    setDialogOpen(true);
  };

  // Fan-out: create an in-app notification for every user. Every authenticated
  // user is a baseline parent, so all profiles are notified — the notification
  // inbox scopes display by sport via the notification's own sport field.
  const fanOutNotifications = async (announcementId: string, title: string, body: string, isGlobal: boolean, isUrgent: boolean) => {
    if (!db) return;
    const usersSnap = await getDocs(collection(db, 'userProfiles'));
    if (usersSnap.empty) return;
    const bodyPreview = body.length > 120 ? body.slice(0, 120) + '…' : body;
    // Firestore caps a write batch at 500 ops — chunk so the fan-out keeps
    // working once the league passes 500 accounts.
    const CHUNK = 400;
    const userDocs = usersSnap.docs;
    for (let i = 0; i < userDocs.length; i += CHUNK) {
      const notifBatch = writeBatch(db);
      for (const userDoc of userDocs.slice(i, i + CHUNK)) {
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
      }
      await notifBatch.commit();
    }

    // Urgent announcements additionally buzz opted-in devices via web push.
    // Chunked to /api/push/send's 500-recipient cap (it silently truncates).
    // Fire-and-forget: a push failure never blocks the published announcement.
    if (isUrgent && user) {
      const allUserIds = userDocs.map(d => d.id);
      user
        .getIdToken()
        .then(idToken =>
          Promise.all(
            Array.from({ length: Math.ceil(allUserIds.length / 500) }, (_, i) =>
              fetch('/api/push/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
                body: JSON.stringify({
                  userIds: allUserIds.slice(i * 500, (i + 1) * 500),
                  title,
                  body: bodyPreview,
                  url: '/parent/announcements',
                }),
              })
            )
          )
        )
        .catch(() => undefined);
    }
  };

  // Step 1 of the email flow: the announcement is already published — resolve
  // the audience size (dry run, nothing sent) and open the confirm dialog.
  const prepareAnnouncementEmail = async (title: string, body: string, isGlobal: boolean) => {
    if (!user) return;
    const audience =
      form.audienceType === 'team' && form.audienceTeamId
        ? { type: 'team' as const, teamId: form.audienceTeamId }
        : form.audienceType === 'division' && form.audienceDivisionId && activeSeasonId
          ? { type: 'division' as const, divisionId: form.audienceDivisionId, seasonId: activeSeasonId }
          : { type: 'all' as const };
    const audienceLabel =
      audience.type === 'team'
        ? `Families on ${teams?.find(t => t.id === audience.teamId)?.name ?? 'the selected team'}`
        : audience.type === 'division'
          ? `Families in ${divisions?.find(d => d.id === audience.divisionId)?.name ?? 'the selected division'}`
          : isGlobal ? 'All families (both sports)' : 'All families in this sport';

    setPendingEmail({ title, body, isGlobal, audience, audienceLabel, audienceSize: null });
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/email/announcement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ title, body, sport: activeSport, isGlobal, audience, dryRun: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not resolve the email audience');
      setPendingEmail(prev => (prev ? { ...prev, audienceSize: data.audienceSize } : prev));
    } catch (err: any) {
      setPendingEmail(null);
      toast({
        title: 'Announcement published, but email preview failed',
        description: err.message,
        variant: 'destructive',
      });
    }
  };

  // Step 2: the admin confirmed — actually send. Failure here shouldn't roll
  // back the published announcement — surface a toast and let the admin retry
  // from an edit instead.
  const handleConfirmSendEmail = async () => {
    if (!user || !pendingEmail) return;
    setSendingEmail(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/email/announcement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          title: pendingEmail.title,
          body: pendingEmail.body,
          sport: activeSport,
          isGlobal: pendingEmail.isGlobal,
          audience: pendingEmail.audience,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Email send failed');
      if (data.failedChunks > 0 || data.sent < data.audienceSize) {
        toast({
          title: `Emailed ${data.sent} of ${data.audienceSize} families`,
          description: 'Some emails could not be sent (this can happen near the daily email limit). The announcement is still visible in the portal.',
          variant: 'destructive',
        });
      } else {
        toast({ title: `Emailed ${data.sent} families` });
      }
      setPendingEmail(null);
    } catch (err: any) {
      toast({
        title: 'Announcement published, but email failed',
        description: err.message,
        variant: 'destructive',
      });
      setPendingEmail(null);
    } finally {
      setSendingEmail(false);
    }
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
        if (form.notify) await fanOutNotifications(editTarget.id, title, body, form.isGlobal, form.isUrgent);
        toast({ title: form.notify ? 'Announcement Updated & Everyone Re-Notified' : 'Announcement Updated' });
        if (form.sendEmail) await prepareAnnouncementEmail(title, body, form.isGlobal);
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
        if (form.notify) await fanOutNotifications(newDocRef.id, title, body, form.isGlobal, form.isUrgent);
        toast({ title: form.notify ? 'Announcement Published' : 'Announcement Published Quietly' });
        if (form.sendEmail) await prepareAnnouncementEmail(title, body, form.isGlobal);
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
                        {ann.teamId && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 rounded-full">
                            Team · {ann.teamName ?? 'Unknown'}
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
            <div className="flex items-center gap-3">
              <Switch
                id="sendEmail"
                checked={form.sendEmail}
                onCheckedChange={(v) => setForm(f => ({ ...f, sendEmail: v }))}
              />
              <div>
                <Label htmlFor="sendEmail" className="cursor-pointer flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" /> Also send as email
                </Label>
                <p className="text-xs text-muted-foreground">
                  Emails this announcement to families that haven&apos;t turned off email updates.
                  You&apos;ll see how many recipients and a preview before anything is sent.
                </p>
              </div>
            </div>
            {form.sendEmail && (
              <div className="space-y-2 rounded-xl border bg-secondary/20 p-3">
                <Label>Email recipients</Label>
                <Select
                  value={form.audienceType}
                  onValueChange={(v) => setForm(f => ({ ...f, audienceType: v as AudienceType, audienceTeamId: '', audienceDivisionId: '' }))}
                >
                  <SelectTrigger className="bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All families</SelectItem>
                    {(teams?.length ?? 0) > 0 && <SelectItem value="team">A specific team</SelectItem>}
                    {(divisions?.length ?? 0) > 0 && <SelectItem value="division">A specific division</SelectItem>}
                  </SelectContent>
                </Select>
                {form.audienceType === 'team' && (
                  <Select value={form.audienceTeamId} onValueChange={(v) => setForm(f => ({ ...f, audienceTeamId: v }))}>
                    <SelectTrigger className="bg-white">
                      <SelectValue placeholder="Choose a team…" />
                    </SelectTrigger>
                    <SelectContent>
                      {teams?.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                {form.audienceType === 'division' && (
                  <Select value={form.audienceDivisionId} onValueChange={(v) => setForm(f => ({ ...f, audienceDivisionId: v }))}>
                    <SelectTrigger className="bg-white">
                      <SelectValue placeholder="Choose a division…" />
                    </SelectTrigger>
                    <SelectContent>
                      {divisions?.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                <p className="text-xs text-muted-foreground">
                  Email targeting only affects the email — the announcement itself and in-app
                  notifications still reach everyone on the portal.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
            <Button
              onClick={handleSave}
              disabled={
                saving || !form.title.trim() || !form.body.trim() ||
                (form.sendEmail && form.audienceType === 'team' && !form.audienceTeamId) ||
                (form.sendEmail && form.audienceType === 'division' && !form.audienceDivisionId)
              }
            >
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

      {/* Email Send Confirm — the announcement is already live; this gates only the email blast */}
      <Dialog open={!!pendingEmail} onOpenChange={(open) => {
        if (!open && !sendingEmail) {
          setPendingEmail(null);
          toast({ title: 'Announcement published without email', description: 'The email was not sent. Edit the announcement to send it later.' });
        }
      }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" /> Confirm Email
            </DialogTitle>
            <DialogDescription>
              Your announcement is published on the portal. Review the email before it goes out — this cannot be unsent.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-xl border bg-secondary/20 p-3 text-sm space-y-1">
              <p>
                <span className="text-muted-foreground">To:</span>{' '}
                <span className="font-semibold">{pendingEmail?.audienceLabel}</span>
                {' — '}
                {pendingEmail?.audienceSize === null
                  ? <Loader2 className="inline h-3.5 w-3.5 animate-spin align-middle" />
                  : <span className="font-semibold">{pendingEmail?.audienceSize} recipient{pendingEmail?.audienceSize !== 1 ? 's' : ''}</span>}
              </p>
              <p>
                <span className="text-muted-foreground">Subject:</span>{' '}
                <span className="font-semibold">
                  {pendingEmail?.isGlobal ? '' : activeSport === 'baseball' ? '[SYBA Baseball] ' : activeSport === 'football' ? '[SYFA Football] ' : ''}
                  {pendingEmail?.title}
                </span>
              </p>
            </div>
            <div className="rounded-xl border p-3 max-h-48 overflow-y-auto">
              <p className="text-sm whitespace-pre-wrap">{pendingEmail?.body}</p>
            </div>
            {pendingEmail?.audienceSize === 0 && (
              <p className="text-sm text-destructive">
                No recipients match this audience — nothing would be sent. Check the team or division selection.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={sendingEmail}
              onClick={() => {
                setPendingEmail(null);
                toast({ title: 'Announcement published without email', description: 'The email was not sent. Edit the announcement to send it later.' });
              }}
            >
              Don&apos;t Send
            </Button>
            <Button
              onClick={handleConfirmSendEmail}
              disabled={sendingEmail || pendingEmail?.audienceSize === null || pendingEmail?.audienceSize === 0}
            >
              {sendingEmail && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send to {pendingEmail?.audienceSize ?? '…'} {pendingEmail?.audienceSize === 1 ? 'Family' : 'Families'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
