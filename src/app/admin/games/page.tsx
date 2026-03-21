"use client";

import { useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useFirestore, useCollection, useMemoFirebase, useUser, deleteDocumentNonBlocking } from '@/firebase';
import { collection, doc, setDoc, query, orderBy, where, Timestamp } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import {
  Plus,
  Trash2,
  CalendarDays,
  Loader2,
  Lock,
  MapPin,
  Users,
  Trophy,
  Upload,
  Download,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { format, parseISO, addDays } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  parseGameScheduleCSV,
  validateGameRows,
  downloadGameTemplate,
  type ParsedGame,
  type ValidationError,
} from '@/lib/csv-import';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Game {
  id: string;
  type: 'game' | 'practice';
  date: string;
  time: string;
  fieldId: string;
  fieldName: string;
  homeTeamId?: string;
  homeTeamName?: string;
  awayTeamId?: string;
  awayTeamName?: string;
  teamId?: string;
  teamName?: string;
  notes?: string;
}

interface Team {
  id: string;
  name: string;
}

interface Field {
  id: string;
  name: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(t: string) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

const EMPTY_FORM = {
  type: 'game' as 'game' | 'practice',
  date: '',
  time: '',
  fieldId: '',
  homeTeamId: '',
  awayTeamId: '',
  teamId: '',
  notes: '',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function AdminGamesPage() {
  const db = useFirestore();
  const { isAdmin, isBoardMember, loading: loadingUser } = useUser();
  const { toast } = useToast();

  const todayISO = format(new Date(), 'yyyy-MM-dd');

  const [open, setOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showPast, setShowPast] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // CSV Import state
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<ParsedGame[]>([]);
  const [importErrors, setImportErrors] = useState<ValidationError[]>([]);
  const [isImporting, setIsImporting] = useState(false);

  // ── Queries ──────────────────────────────────────────────────────────────────

  const upcomingQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return query(
      collection(db, 'games'),
      where('date', '>=', todayISO),
      orderBy('date', 'asc'),
      orderBy('time', 'asc')
    );
  }, [db, isAdmin, isBoardMember, todayISO]);

  const pastQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember) || !showPast) return null;
    return query(
      collection(db, 'games'),
      where('date', '<', todayISO),
      orderBy('date', 'desc'),
      orderBy('time', 'desc')
    );
  }, [db, isAdmin, isBoardMember, showPast, todayISO]);

  const teamsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return query(collection(db, 'teams'), orderBy('name', 'asc'));
  }, [db, isAdmin, isBoardMember]);

  const fieldsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return collection(db, 'fields');
  }, [db, isAdmin, isBoardMember]);

  const { data: upcomingGames, isLoading: loadingUpcoming } = useCollection<Game>(upcomingQuery);
  const { data: pastGames, isLoading: loadingPast } = useCollection<Game>(pastQuery);
  const { data: teams } = useCollection<Team>(teamsQuery);
  const { data: fields } = useCollection<Field>(fieldsQuery);

  // ── Derived ───────────────────────────────────────────────────────────────────

  const fieldMap = Object.fromEntries((fields ?? []).map((f) => [f.id, f.name]));
  const teamMap = Object.fromEntries((teams ?? []).map((t) => [t.id, t.name]));

  // ── Handlers ──────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!db) return;
    if (!form.date || !form.time || !form.fieldId) {
      toast({ title: 'Missing fields', description: 'Date, time, and field are required.', variant: 'destructive' });
      return;
    }
    if (form.type === 'game' && (!form.homeTeamId || !form.awayTeamId)) {
      toast({ title: 'Missing teams', description: 'Games require a home team and away team.', variant: 'destructive' });
      return;
    }
    if (form.type === 'practice' && !form.teamId) {
      toast({ title: 'Missing team', description: 'Practices require a team.', variant: 'destructive' });
      return;
    }

    setIsSaving(true);
    try {
      const id = crypto.randomUUID();
      const payload: Record<string, any> = {
        type: form.type,
        date: form.date,
        time: form.time,
        fieldId: form.fieldId,
        fieldName: fieldMap[form.fieldId] ?? '',
        notes: form.notes,
        createdAt: Timestamp.now(),
      };

      if (form.type === 'game') {
        payload.homeTeamId = form.homeTeamId;
        payload.homeTeamName = teamMap[form.homeTeamId] ?? '';
        payload.awayTeamId = form.awayTeamId;
        payload.awayTeamName = teamMap[form.awayTeamId] ?? '';
      } else {
        payload.teamId = form.teamId;
        payload.teamName = teamMap[form.teamId] ?? '';
      }

      await setDoc(doc(db, 'games', id), payload);
      toast({ title: 'Saved', description: `${form.type === 'game' ? 'Game' : 'Practice'} added successfully.` });
      setForm(EMPTY_FORM);
      setOpen(false);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseGameScheduleCSV(text);
    const teamNames = (teams ?? []).map((t) => t.name);
    const fieldNames = (fields ?? []).map((f) => f.name);
    const result = validateGameRows(parsed, teamNames, fieldNames);
    setImportRows(result.valid);
    setImportErrors(result.errors);
    e.target.value = '';
  };

  const handleImport = async () => {
    if (!db || importRows.length === 0) return;
    setIsImporting(true);
    try {
      for (const row of importRows) {
        const id = crypto.randomUUID();
        const isGame = row.type.toLowerCase() === 'game';
        const matchedField = (fields ?? []).find((f) => f.name.toLowerCase() === row.field.toLowerCase());
        const payload: Record<string, any> = {
          type: isGame ? 'game' : 'practice',
          date: row.date,
          time: row.time,
          fieldId: matchedField?.id ?? '',
          fieldName: matchedField?.name ?? row.field,
          notes: row.notes ?? '',
          createdAt: Timestamp.now(),
        };
        if (isGame) {
          const home = (teams ?? []).find((t) => t.name.toLowerCase() === (row.homeTeam ?? '').toLowerCase());
          const away = (teams ?? []).find((t) => t.name.toLowerCase() === (row.awayTeam ?? '').toLowerCase());
          payload.homeTeamId = home?.id ?? '';
          payload.homeTeamName = home?.name ?? row.homeTeam ?? '';
          payload.awayTeamId = away?.id ?? '';
          payload.awayTeamName = away?.name ?? row.awayTeam ?? '';
        } else {
          const team = (teams ?? []).find((t) => t.name.toLowerCase() === (row.teamName ?? '').toLowerCase());
          payload.teamId = team?.id ?? '';
          payload.teamName = team?.name ?? row.teamName ?? '';
        }
        await setDoc(doc(db, 'games', id), payload);
      }
      toast({ title: `Imported ${importRows.length} item${importRows.length !== 1 ? 's' : ''}`, description: 'Schedule updated successfully.' });
      setImportOpen(false);
      setImportRows([]);
      setImportErrors([]);
    } catch (err: any) {
      toast({ title: 'Import Failed', description: err.message, variant: 'destructive' });
    } finally {
      setIsImporting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!db) return;
    deleteDocumentNonBlocking(doc(db, 'games', id));
    setDeleteConfirmId(null);
    toast({ title: 'Deleted' });
  };

  // ── Access guard ──────────────────────────────────────────────────────────────

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
        <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8 flex items-center justify-center">
          <Card className="max-w-md text-center border-none shadow-xl">
            <CardHeader>
              <Lock className="h-12 w-12 text-destructive mx-auto mb-4" />
              <CardTitle className="font-headline text-2xl">Access Denied</CardTitle>
              <p className="text-muted-foreground text-sm">Admins only.</p>
            </CardHeader>
          </Card>
        </main>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const filterGames = (list: Game[]) => {
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(g =>
      (g.homeTeamName ?? '').toLowerCase().includes(q) ||
      (g.awayTeamName ?? '').toLowerCase().includes(q) ||
      (g.teamName ?? '').toLowerCase().includes(q) ||
      (g.fieldName ?? '').toLowerCase().includes(q)
    );
  };

  const gameList = filterGames(upcomingGames ?? []);
  const pastList = filterGames(pastGames ?? []);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8">

        {/* Header */}
        <header className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold font-headline">Game Schedule</h1>
            <p className="text-muted-foreground">Add and manage games and practices for all teams.</p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative">
              <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35"/></svg>
              <Input
                placeholder="Search games…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 rounded-xl w-48"
              />
            </div>

            <Button variant="outline" className="rounded-full px-5" onClick={() => setImportOpen(true)}>
              <Upload className="mr-2 h-4 w-4" /> Import Schedule
            </Button>

          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="rounded-full px-6">
                <Plus className="mr-2 h-4 w-4" /> Add Game / Practice
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle className="font-headline">Add Game or Practice</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                {/* Type */}
                <div className="space-y-1.5">
                  <Label>Type</Label>
                  <Select value={form.type} onValueChange={(v: 'game' | 'practice') => setForm({ ...form, type: v, homeTeamId: '', awayTeamId: '', teamId: '' })}>
                    <SelectTrigger className="rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="game">Game</SelectItem>
                      <SelectItem value="practice">Practice</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Date / Time */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Date</Label>
                    <Input type="date" className="rounded-xl" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Time</Label>
                    <Input type="time" className="rounded-xl" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
                  </div>
                </div>

                {/* Field */}
                <div className="space-y-1.5">
                  <Label>Field</Label>
                  <Select value={form.fieldId} onValueChange={(v) => setForm({ ...form, fieldId: v })}>
                    <SelectTrigger className="rounded-xl">
                      <SelectValue placeholder="Select a field" />
                    </SelectTrigger>
                    <SelectContent>
                      {(fields ?? []).map((f) => (
                        <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Teams — game */}
                {form.type === 'game' && (
                  <>
                    <div className="space-y-1.5">
                      <Label>Home Team</Label>
                      <Select value={form.homeTeamId} onValueChange={(v) => setForm({ ...form, homeTeamId: v })}>
                        <SelectTrigger className="rounded-xl">
                          <SelectValue placeholder="Select home team" />
                        </SelectTrigger>
                        <SelectContent>
                          {(teams ?? []).map((t) => (
                            <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Away Team</Label>
                      <Select value={form.awayTeamId} onValueChange={(v) => setForm({ ...form, awayTeamId: v })}>
                        <SelectTrigger className="rounded-xl">
                          <SelectValue placeholder="Select away team" />
                        </SelectTrigger>
                        <SelectContent>
                          {(teams ?? []).filter((t) => t.id !== form.homeTeamId).map((t) => (
                            <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}

                {/* Team — practice */}
                {form.type === 'practice' && (
                  <div className="space-y-1.5">
                    <Label>Team</Label>
                    <Select value={form.teamId} onValueChange={(v) => setForm({ ...form, teamId: v })}>
                      <SelectTrigger className="rounded-xl">
                        <SelectValue placeholder="Select team" />
                      </SelectTrigger>
                      <SelectContent>
                        {(teams ?? []).map((t) => (
                          <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Notes */}
                <div className="space-y-1.5">
                  <Label>Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
                  <Input className="rounded-xl" placeholder="e.g. Rain makeup game" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={handleSave} disabled={isSaving}>
                  {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </div>
        </header>

        {/* Upcoming Games */}
        <Card className="border-none shadow-md mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="font-headline flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-primary" />
              Upcoming
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingUpcoming ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : gameList.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No upcoming games or practices. Use the button above to add one.</p>
            ) : (
              <div className="space-y-2">
                {gameList.map((g) => (
                  <GameRow
                    key={g.id}
                    game={g}
                    onDelete={() => setDeleteConfirmId(g.id)}
                    confirmId={deleteConfirmId}
                    onConfirmDelete={() => handleDelete(g.id)}
                    onCancelDelete={() => setDeleteConfirmId(null)}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Past Games */}
        <div className="mb-4">
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setShowPast(!showPast)}>
            {showPast ? 'Hide' : 'Show'} past games
          </Button>
        </div>

        {showPast && (
          <Card className="border-none shadow-md">
            <CardHeader className="pb-2">
              <CardTitle className="font-headline text-muted-foreground">Past</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingPast ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : pastList.length === 0 ? (
                <p className="text-sm text-muted-foreground">No past games on record.</p>
              ) : (
                <div className="space-y-2 opacity-60">
                  {pastList.map((g) => (
                    <GameRow
                      key={g.id}
                      game={g}
                      onDelete={() => setDeleteConfirmId(g.id)}
                      confirmId={deleteConfirmId}
                      onConfirmDelete={() => handleDelete(g.id)}
                      onCancelDelete={() => setDeleteConfirmId(null)}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </main>

      {/* CSV Import Dialog */}
      <Dialog open={importOpen} onOpenChange={(o) => { if (!isImporting) { setImportOpen(o); if (!o) { setImportRows([]); setImportErrors([]); } } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-headline">Import Game Schedule</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/20 border">
              <p className="text-sm text-muted-foreground">Download the CSV template to see the required format.</p>
              <Button variant="outline" size="sm" className="rounded-xl" onClick={downloadGameTemplate}>
                <Download className="mr-2 h-3 w-3" /> Template
              </Button>
            </div>

            <div>
              <Label className="text-sm font-medium">Upload CSV File</Label>
              <label className="mt-2 flex flex-col items-center justify-center w-full h-24 border-2 border-dashed rounded-xl cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors">
                <Upload className="h-6 w-6 text-muted-foreground mb-1" />
                <span className="text-sm text-muted-foreground">Click to select a .csv file</span>
                <input type="file" accept=".csv" className="hidden" onChange={handleFileSelect} />
              </label>
            </div>

            {importErrors.length > 0 && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 space-y-1 max-h-32 overflow-y-auto">
                <p className="text-xs font-semibold text-destructive flex items-center gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5" /> {importErrors.length} validation error{importErrors.length !== 1 ? 's' : ''}
                </p>
                {importErrors.map((err, i) => (
                  <p key={i} className="text-xs text-destructive/80">Row {err.row} · {err.column}: {err.message}</p>
                ))}
              </div>
            )}

            {importRows.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> {importRows.length} valid row{importRows.length !== 1 ? 's' : ''} ready to import
                </p>
                <div className="rounded-xl border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-secondary/30">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Date</th>
                        <th className="px-3 py-2 text-left font-semibold">Time</th>
                        <th className="px-3 py-2 text-left font-semibold">Type</th>
                        <th className="px-3 py-2 text-left font-semibold">Teams / Team</th>
                        <th className="px-3 py-2 text-left font-semibold">Field</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importRows.slice(0, 5).map((row, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-1.5">{row.date}</td>
                          <td className="px-3 py-1.5">{row.time}</td>
                          <td className="px-3 py-1.5 capitalize">{row.type}</td>
                          <td className="px-3 py-1.5">
                            {row.type.toLowerCase() === 'game'
                              ? `${row.homeTeam} vs ${row.awayTeam}`
                              : row.teamName}
                          </td>
                          <td className="px-3 py-1.5">{row.field}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {importRows.length > 5 && (
                    <p className="text-xs text-muted-foreground text-center py-2 border-t">
                      +{importRows.length - 5} more rows not shown
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)} disabled={isImporting}>Cancel</Button>
            <Button onClick={handleImport} disabled={isImporting || importRows.length === 0}>
              {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Import {importRows.length > 0 ? `${importRows.length} Item${importRows.length !== 1 ? 's' : ''}` : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Game Row ─────────────────────────────────────────────────────────────────

function GameRow({
  game,
  onDelete,
  confirmId,
  onConfirmDelete,
  onCancelDelete,
}: {
  game: Game;
  onDelete: () => void;
  confirmId: string | null;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}) {
  function formatTime(t: string) {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  const isGame = game.type === 'game';
  const isConfirming = confirmId === game.id;

  return (
    <div className={cn(
      'flex items-center justify-between rounded-xl px-4 py-3 gap-3',
      isGame ? 'bg-blue-50 border border-blue-100' : 'bg-green-50 border border-green-100'
    )}>
      <div className="flex items-center gap-3 min-w-0">
        <div className={cn('p-2 rounded-lg shrink-0', isGame ? 'bg-blue-100' : 'bg-green-100')}>
          {isGame ? <Trophy className="h-4 w-4 text-blue-600" /> : <Users className="h-4 w-4 text-green-600" />}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">
            {isGame
              ? `${game.homeTeamName} vs. ${game.awayTeamName}`
              : `${game.teamName} Practice`}
          </p>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            <span className="text-xs text-muted-foreground">
              {format(parseISO(game.date), 'EEE, MMM d')} · {formatTime(game.time)}
            </span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3" /> {game.fieldName}
            </span>
            {game.notes && <span className="text-xs text-muted-foreground italic truncate">{game.notes}</span>}
          </div>
        </div>
      </div>

      <div className="shrink-0">
        {isConfirming ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-destructive font-medium">Delete?</span>
            <Button size="sm" variant="destructive" onClick={onConfirmDelete} className="h-7 px-2 text-xs">Yes</Button>
            <Button size="sm" variant="ghost" onClick={onCancelDelete} className="h-7 px-2 text-xs">No</Button>
          </div>
        ) : (
          <Button size="sm" variant="ghost" onClick={onDelete} className="text-muted-foreground hover:text-destructive h-8 w-8 p-0">
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
