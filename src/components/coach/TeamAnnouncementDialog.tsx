"use client";

import { useState, useEffect } from 'react';
import {
  addDoc,
  collection,
  doc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { notifySportAdmins, notifyTeamParents } from '@/lib/coach-notifications';
import type { Announcement, Sport } from '@/types/scheduling';

interface TeamAnnouncementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  db: Firestore | null;
  sport: Sport | null;
  /** The coach's teams for the active sport. */
  teams: { id: string; name: string }[];
  creator: { uid: string; name?: string };
  /** When set, the dialog edits this announcement instead of creating one. */
  editTarget?: Announcement | null;
}

/** Coach-facing composer for team-scoped announcements. Creates the post,
 *  pings the team's parents in-app, and notifies sport admins (guardrail).
 *  League-wide announcements remain admin-only. */
export function TeamAnnouncementDialog({ open, onOpenChange, db, sport, teams, creator, editTarget }: TeamAnnouncementDialogProps) {
  const { toast } = useToast();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [teamId, setTeamId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(editTarget?.title ?? '');
      setBody(editTarget?.body ?? '');
      setExpiresAt(editTarget?.expiresAt ?? '');
      setTeamId(editTarget?.teamId ?? (teams.length === 1 ? teams[0].id : ''));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editTarget?.id, teams.length]);

  const handleSave = async () => {
    if (!db || !sport || !title.trim() || !body.trim()) return;
    const team = teams.find(t => t.id === teamId);
    if (!team && !editTarget) {
      toast({ variant: 'destructive', title: 'Pick a team', description: 'Team announcements must be scoped to one of your teams.' });
      return;
    }
    setSaving(true);
    try {
      if (editTarget) {
        await updateDoc(doc(db, 'announcements', editTarget.id), {
          title: title.trim(),
          body: body.trim(),
          ...(expiresAt ? { expiresAt } : {}),
          updatedAt: new Date().toISOString(),
        });
        toast({ title: 'Announcement updated' });
      } else if (team) {
        const docRef = await addDoc(collection(db, 'announcements'), {
          title: title.trim(),
          body: body.trim(),
          publishedAt: new Date().toISOString(),
          ...(creator.name ? { publishedBy: creator.name } : {}),
          sport,
          teamId: team.id,
          teamName: team.name,
          createdByUid: creator.uid,
          ...(expiresAt ? { expiresAt } : {}),
        });
        // In-app ping to the team's families; failures never roll back the post
        notifyTeamParents(db, [team.id], creator.uid, {
          type: 'announcement',
          title: `${team.name}: ${title.trim()}`,
          body: body.trim(),
          sport,
          relatedDocId: docRef.id,
          relatedDocType: 'announcement',
        });
        notifySportAdmins(db, creator.uid, {
          title: 'Team announcement posted by coach',
          body: `${team.name}: ${title.trim()}`,
          sport,
          relatedDocId: docRef.id,
          relatedDocType: 'announcement',
        });
        toast({ title: 'Announcement posted', description: `Visible to ${team.name} families.` });
      }
      onOpenChange(false);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Could not save announcement', description: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editTarget ? 'Edit Team Announcement' : 'New Team Announcement'}</DialogTitle>
          <DialogDescription>
            Posted to your team's families and shown on their dashboards. Announcements are visible beyond your team — don't include private info.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {!editTarget && teams.length > 1 && (
            <div className="space-y-1.5">
              <Label>Team *</Label>
              <Select value={teamId} onValueChange={setTeamId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a team" />
                </SelectTrigger>
                <SelectContent>
                  {teams.map(t => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="ann-title">Title *</Label>
            <Input id="ann-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Practice moved to 6 PM" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ann-body">Message *</Label>
            <Textarea id="ann-body" value={body} onChange={e => setBody(e.target.value)} rows={4} placeholder="What do families need to know?" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ann-expires">Show until (optional)</Label>
            <Input id="ann-expires" type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} />
            <p className="text-xs text-muted-foreground">After this date the announcement stops displaying.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !title.trim() || !body.trim()}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {editTarget ? 'Save Changes' : 'Post Announcement'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
