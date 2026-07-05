"use client";

import { useState, useEffect } from 'react';
import { doc, setDoc, writeBatch, type Firestore } from 'firebase/firestore';
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
import { Loader2, Trophy } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { notifySportAdmins } from '@/lib/coach-notifications';
import type { Game } from '@/types/scheduling';

interface LogScoreDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  db: Firestore;
  /** Top-level football game (games/{id}) awaiting a score. */
  game: Game | null;
  actorUid: string;
  onSaved?: (gameId: string) => void;
}

/** Coach-facing final-score entry for football games. Writes the score to the
 *  top-level games doc (the source standings and dashboards read) and syncs the
 *  team mirror, matching the admin score dialog's convention: our score in
 *  homeScore, opponent's in awayScore. */
export function LogScoreDialog({ open, onOpenChange, db, game, actorUid, onSaved }: LogScoreDialogProps) {
  const { toast } = useToast();
  const [ourScore, setOurScore] = useState('');
  const [theirScore, setTheirScore] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setOurScore('');
      setTheirScore('');
    }
  }, [open, game?.id]);

  const handleSave = async () => {
    if (!game || !game.teamId || ourScore === '' || theirScore === '') return;
    const ours = Number(ourScore);
    const theirs = Number(theirScore);
    if (isNaN(ours) || isNaN(theirs) || ours < 0 || theirs < 0) {
      toast({ variant: 'destructive', title: 'Invalid Score', description: 'Scores must be non-negative numbers.' });
      return;
    }
    setSaving(true);
    try {
      const updatedAt = new Date().toISOString();
      const batch = writeBatch(db);
      batch.update(doc(db, 'games', game.id), {
        homeScore: ours,
        awayScore: theirs,
        status: 'completed',
        updatedAt,
      });
      await batch.commit();
      // Sync the team mirror separately with merge — a missing mirror (legacy
      // import) must not roll back the recorded score.
      setDoc(
        doc(db, 'teams', game.teamId, 'games', game.id),
        { homeScore: ours, awayScore: theirs, status: 'completed', cancelled: false, updatedAt },
        { merge: true }
      ).catch(() => {});
      notifySportAdmins(db, actorUid, {
        title: 'Score recorded by coach',
        body: `${game.teamName ?? 'Team'} ${ours} – ${theirs} ${game.opponentName || 'TBD'}`,
        sport: 'football',
        relatedDocId: game.id,
        relatedDocType: 'game',
      });
      toast({ title: 'Score Saved', description: 'Final score recorded — standings will update.' });
      onSaved?.(game.id);
      onOpenChange(false);
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not save the score.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" />
            Log Final Score
          </DialogTitle>
          <DialogDescription>
            {game ? (
              <>
                {game.teamName ?? 'Your team'} vs {game.opponentName || 'TBD'}
                {game.date ? ` · ${format(parseISO(game.date), 'EEE, MMM d')}` : ''}
              </>
            ) : 'Select a game to score.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="our-score" className="text-xs">
              {game?.teamName ?? 'Us'}
            </Label>
            <Input
              id="our-score"
              type="number"
              min={0}
              inputMode="numeric"
              value={ourScore}
              onChange={e => setOurScore(e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="their-score" className="text-xs">
              {game?.opponentName || 'Opponent'}
            </Label>
            <Input
              id="their-score"
              type="number"
              min={0}
              inputMode="numeric"
              value={theirScore}
              onChange={e => setTheirScore(e.target.value)}
              placeholder="0"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || ourScore === '' || theirScore === ''}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Score
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
