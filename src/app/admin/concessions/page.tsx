"use client";

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc, addDoc, deleteDoc, getDocs, getDoc, query, where, collectionGroup } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ShoppingCart,
  Plus,
  Trash2,
  Loader2,
  Lock,
  Clock,
  Users,
  CalendarDays,
  CheckCircle2,
  XCircle,
  Download,
  AlertCircle,
  LayoutList,
  CalendarIcon,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO } from 'date-fns';
import { DayPicker } from 'react-day-picker';
import { cn } from '@/lib/utils';

interface ConcessionSignup {
  parentUserId: string;
  displayName: string;
  signedUpAt: string;
}

interface ConcessionSlot {
  id: string;
  gameDate: string;
  startTime: string;
  endTime: string;
  capacity: number;
  cancelCutoffHours: number;
  description?: string;
  signups: ConcessionSignup[];
  createdAt: string;
}

interface Season {
  id: string;
  name: string;
  registrationOpen: string;
  registrationClose: string;
  volunteerSlotsRequired?: number;
}

interface FamilyCompliance {
  parentUserId: string;
  displayName: string;
  email: string;
  slotsCount: number;
  required: number;
}

const emptySlot = {
  gameDate: '',
  startTime: '10:00',
  endTime: '14:00',
  capacity: 4,
  cancelCutoffHours: 24,
  description: '',
};

function formatTime(t: string) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

function complianceStatus(family: FamilyCompliance) {
  if (family.slotsCount >= family.required) return 'met';
  if (family.slotsCount > 0) return 'partial';
  return 'none';
}

export default function ConcessionsAdminPage() {
  const db = useFirestore();
  const { isAdmin, isBoardMember, loading: loadingUser } = useUser();
  const { toast } = useToast();

  // Manage Slots state
  const [addDialog, setAddDialog] = useState(false);
  const [formData, setFormData] = useState(emptySlot);
  const [saving, setSaving] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; slot: ConcessionSlot | null }>({ open: false, slot: null });
  const [deleting, setDeleting] = useState(false);

  // Family Compliance state
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>('');
  const [complianceLoading, setComplianceLoading] = useState(false);
  const [families, setFamilies] = useState<FamilyCompliance[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<Season | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [slotView, setSlotView] = useState<'list' | 'calendar'>('list');
  const [calMonth, setCalMonth] = useState<Date>(new Date());

  const slotsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return collection(db, 'concessionSlots');
  }, [db, isAdmin, isBoardMember]);

  const { data: slots, isLoading } = useCollection<ConcessionSlot>(slotsQuery);

  const seasonsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return collection(db, 'seasons');
  }, [db, isAdmin, isBoardMember]);

  const { data: seasons } = useCollection<Season>(seasonsQuery);

  const allGamesQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return collection(db, 'games');
  }, [db, isAdmin, isBoardMember]);

  interface GameDate { id: string; date: string; }
  const { data: allGames } = useCollection<GameDate>(allGamesQuery);

  const sortedSlots = slots
    ? [...slots].sort((a, b) => a.gameDate.localeCompare(b.gameDate))
    : [];

  // Set of all game dates
  const gameDateSet = useMemo(() => {
    return new Set((allGames ?? []).map(g => g.date).filter(Boolean));
  }, [allGames]);

  // Per-date slot coverage: { totalCap, filled }
  const coverageByDate = useMemo(() => {
    const map = new Map<string, { totalCap: number; filled: number }>();
    for (const slot of sortedSlots) {
      const cur = map.get(slot.gameDate) ?? { totalCap: 0, filled: 0 };
      map.set(slot.gameDate, {
        totalCap: cur.totalCap + slot.capacity,
        filled: cur.filled + (slot.signups?.length ?? 0),
      });
    }
    return map;
  }, [sortedSlots]);

  // Derive colored date sets for react-day-picker modifiers
  const redDates = useMemo(() =>
    [...gameDateSet].filter(d => !coverageByDate.has(d)).map(d => parseISO(d)),
  [gameDateSet, coverageByDate]);

  const yellowDates = useMemo(() => {
    return [...gameDateSet].filter(d => {
      const cov = coverageByDate.get(d);
      return cov && cov.filled < cov.totalCap;
    }).map(d => parseISO(d));
  }, [gameDateSet, coverageByDate]);

  const greenDates = useMemo(() => {
    return [...gameDateSet].filter(d => {
      const cov = coverageByDate.get(d);
      return cov && cov.filled >= cov.totalCap;
    }).map(d => parseISO(d));
  }, [gameDateSet, coverageByDate]);

  const handleAddSlot = async () => {
    if (!formData.gameDate || !db) return;
    setSaving(true);
    try {
      await addDoc(collection(db, 'concessionSlots'), {
        gameDate: formData.gameDate,
        startTime: formData.startTime,
        endTime: formData.endTime,
        capacity: Number(formData.capacity),
        cancelCutoffHours: Number(formData.cancelCutoffHours),
        description: formData.description.trim(),
        signups: [],
        createdAt: new Date().toISOString(),
      });
      toast({ title: 'Slot Created', description: `Concession slot for ${formData.gameDate} added.` });
      setAddDialog(false);
      setFormData(emptySlot);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSlot = async () => {
    if (!deleteDialog.slot || !db) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'concessionSlots', deleteDialog.slot.id));
      toast({ title: 'Slot Deleted' });
      setDeleteDialog({ open: false, slot: null });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  const loadComplianceReport = useCallback(async (seasonId: string) => {
    if (!db || !seasonId) return;
    setComplianceLoading(true);
    setFamilies([]);
    try {
      // Get the season details
      const seasonDoc = await getDoc(doc(db, 'seasons', seasonId));
      if (!seasonDoc.exists()) return;
      const season = { id: seasonDoc.id, ...seasonDoc.data() } as Season;
      setSelectedSeason(season);

      // Get all enrollments for this season
      const enrollmentsSnap = await getDocs(
        query(collectionGroup(db, 'enrollments'), where('seasonId', '==', seasonId))
      );

      // Collect unique parentUserIds
      const parentIds = new Set<string>();
      enrollmentsSnap.docs.forEach(d => {
        const parentUserId = d.data().parentUserId as string;
        if (parentUserId) parentIds.add(parentUserId);
      });

      if (parentIds.size === 0) {
        setFamilies([]);
        return;
      }

      // Fetch user profiles for each parent via individual getDoc calls
      const parentIdArray = Array.from(parentIds);
      const profileMap = new Map<string, { displayName: string; email: string }>();

      await Promise.all(
        parentIdArray.map(async (parentId) => {
          const profileDoc = await getDoc(doc(db, 'userProfiles', parentId));
          if (profileDoc.exists()) {
            const data = profileDoc.data();
            profileMap.set(parentId, {
              displayName: data.displayName || data.email || parentId,
              email: data.email || '',
            });
          } else {
            profileMap.set(parentId, { displayName: parentId, email: '' });
          }
        })
      );

      // Get concession slots within the season's registration date range
      // Filter client-side using registrationOpen / registrationClose
      const allSlotsSnap = await getDocs(collection(db, 'concessionSlots'));
      const signupCountMap = new Map<string, number>();

      allSlotsSnap.docs.forEach(d => {
        const slotData = d.data() as ConcessionSlot;
        const gameDate = slotData.gameDate;
        // Include slots within the season's date range (or all slots if no range set)
        const inRange =
          (!season.registrationOpen || gameDate >= season.registrationOpen) &&
          (!season.registrationClose || gameDate <= season.registrationClose);
        if (inRange && slotData.signups) {
          slotData.signups.forEach(signup => {
            signupCountMap.set(
              signup.parentUserId,
              (signupCountMap.get(signup.parentUserId) ?? 0) + 1
            );
          });
        }
      });

      const required = season.volunteerSlotsRequired ?? 1;

      const result: FamilyCompliance[] = parentIdArray.map(parentId => ({
        parentUserId: parentId,
        displayName: profileMap.get(parentId)?.displayName ?? parentId,
        email: profileMap.get(parentId)?.email ?? '',
        slotsCount: signupCountMap.get(parentId) ?? 0,
        required,
      }));

      // Sort: not signed up first, then partial, then met
      result.sort((a, b) => {
        const order = { none: 0, partial: 1, met: 2 };
        return order[complianceStatus(a)] - order[complianceStatus(b)];
      });

      setFamilies(result);
    } catch (err: any) {
      toast({ title: 'Error loading report', description: err.message, variant: 'destructive' });
    } finally {
      setComplianceLoading(false);
    }
  }, [db, toast]);

  useEffect(() => {
    if (selectedSeasonId) {
      loadComplianceReport(selectedSeasonId);
    }
  }, [selectedSeasonId, loadComplianceReport]);

  const filteredFamilies = families.filter(f =>
    f.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    f.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const metCount = families.filter(f => complianceStatus(f) === 'met').length;
  const partialCount = families.filter(f => complianceStatus(f) === 'partial').length;
  const noneCount = families.filter(f => complianceStatus(f) === 'none').length;

  const handleExportCSV = () => {
    const seasonName = selectedSeason?.name ?? 'season';
    const rows = [
      ['Family Name', 'Email', 'Slots Signed Up', 'Required', 'Status'],
      ...families.map(f => {
        const status = complianceStatus(f);
        const label = status === 'met' ? 'Met' : status === 'partial' ? 'Partial' : 'Not Signed Up';
        return [f.displayName, f.email, String(f.slotsCount), String(f.required), label];
      }),
    ];
    const csv = rows.map(r => r.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `volunteer-compliance-${seasonName.replace(/\s+/g, '-').toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8">
        <header className="mb-8 flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold font-headline">Concessions Management</h1>
            <p className="text-muted-foreground">Create volunteer slots and track parent sign-ups.</p>
          </div>
        </header>

        <Tabs defaultValue="slots">
          <TabsList className="mb-6">
            <TabsTrigger value="slots">Manage Slots</TabsTrigger>
            <TabsTrigger value="compliance">Family Compliance</TabsTrigger>
          </TabsList>

          {/* ── Manage Slots Tab ── */}
          <TabsContent value="slots">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center rounded-full border bg-muted p-0.5 text-sm">
                <button
                  onClick={() => setSlotView('list')}
                  className={cn('px-3 py-1 rounded-full transition-colors flex items-center gap-1.5', slotView === 'list' ? 'bg-white shadow font-semibold text-foreground' : 'text-muted-foreground')}
                >
                  <LayoutList className="h-3.5 w-3.5" /> List
                </button>
                <button
                  onClick={() => setSlotView('calendar')}
                  className={cn('px-3 py-1 rounded-full transition-colors flex items-center gap-1.5', slotView === 'calendar' ? 'bg-white shadow font-semibold text-foreground' : 'text-muted-foreground')}
                >
                  <CalendarIcon className="h-3.5 w-3.5" /> Calendar
                </button>
              </div>
              <Button onClick={() => setAddDialog(true)} className="rounded-full shadow-lg">
                <Plus className="mr-2 h-4 w-4" /> Add Slot
              </Button>
            </div>

            {slotView === 'calendar' ? (
              <Card className="border-none shadow-md">
                <CardContent className="p-4">
                  <DayPicker
                    month={calMonth}
                    onMonthChange={setCalMonth}
                    modifiers={{ gameRed: redDates, gameYellow: yellowDates, gameGreen: greenDates }}
                    modifiersStyles={{
                      gameRed: { backgroundColor: '#fecaca', color: '#991b1b', borderRadius: '50%', fontWeight: 600 },
                      gameYellow: { backgroundColor: '#fef08a', color: '#92400e', borderRadius: '50%', fontWeight: 600 },
                      gameGreen: { backgroundColor: '#bbf7d0', color: '#14532d', borderRadius: '50%', fontWeight: 600 },
                    }}
                    onDayClick={(day) => {
                      const iso = format(day, 'yyyy-MM-dd');
                      if (gameDateSet.has(iso)) {
                        setFormData(prev => ({ ...prev, gameDate: iso }));
                        setAddDialog(true);
                      }
                    }}
                    className="mx-auto"
                  />
                  <div className="flex items-center gap-4 justify-center mt-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-200 inline-block" /> No slots</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-yellow-200 inline-block" /> Partial</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-200 inline-block" /> Covered</span>
                  </div>
                </CardContent>
              </Card>
            ) : (
              isLoading ? (
                <div className="flex justify-center py-20">
                  <Loader2 className="h-10 w-10 animate-spin text-primary" />
                </div>
              ) : sortedSlots.length === 0 ? (
                <Card className="border-none shadow-md border-dashed">
                  <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                    <ShoppingCart className="h-12 w-12 text-muted-foreground/40 mb-4" />
                    <p className="text-muted-foreground font-medium">No concession slots yet</p>
                    <p className="text-sm text-muted-foreground mb-4">Add your first volunteer slot to get started.</p>
                    <Button onClick={() => setAddDialog(true)} className="rounded-full">
                      <Plus className="mr-2 h-4 w-4" /> Add Slot
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {sortedSlots.map(slot => {
                    const signupCount = slot.signups?.length ?? 0;
                    const spotsLeft = slot.capacity - signupCount;
                    const isFull = spotsLeft <= 0;
                    return (
                      <Card key={slot.id} className="border-none shadow-md">
                        <CardHeader className="pb-3">
                          <div className="flex justify-between items-start">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <CalendarDays className="h-4 w-4 text-primary" />
                                <CardTitle className="text-base font-headline">
                                  {slot.gameDate ? format(parseISO(slot.gameDate), 'EEE, MMM d, yyyy') : slot.gameDate}
                                </CardTitle>
                              </div>
                              {slot.description && (
                                <p className="text-xs text-muted-foreground">{slot.description}</p>
                              )}
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                              onClick={() => setDeleteDialog({ open: true, slot })}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div className="flex items-center gap-2 text-sm">
                            <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                            <span>{formatTime(slot.startTime)} – {formatTime(slot.endTime)}</span>
                          </div>

                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-sm">
                              <Users className="h-4 w-4 text-muted-foreground" />
                              <span>{signupCount} / {slot.capacity} volunteers</span>
                            </div>
                            <Badge variant={isFull ? 'destructive' : 'secondary'} className="text-xs">
                              {isFull ? 'Full' : `${spotsLeft} spot${spotsLeft !== 1 ? 's' : ''} left`}
                            </Badge>
                          </div>

                          <p className="text-xs text-muted-foreground">
                            Cancel cutoff: {slot.cancelCutoffHours}h before start
                          </p>

                          {slot.signups?.length > 0 && (
                            <div className="space-y-1 pt-1 border-t">
                              <p className="text-xs font-bold uppercase text-muted-foreground">Volunteers</p>
                              {slot.signups.map((s, i) => (
                                <p key={i} className="text-xs text-foreground">{s.displayName}</p>
                              ))}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )
            )}
          </TabsContent>

          {/* ── Family Compliance Tab ── */}
          <TabsContent value="compliance">
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end">
                <div className="space-y-1 w-64">
                  <Label>Select Season</Label>
                  <Select value={selectedSeasonId} onValueChange={setSelectedSeasonId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a season…" />
                    </SelectTrigger>
                    <SelectContent>
                      {(seasons ?? []).map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {families.length > 0 && (
                  <Button variant="outline" onClick={handleExportCSV} className="rounded-full">
                    <Download className="mr-2 h-4 w-4" /> Export CSV
                  </Button>
                )}
              </div>

              {!selectedSeasonId && (
                <Card className="border-none shadow-md">
                  <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                    <Users className="h-12 w-12 text-muted-foreground/40 mb-4" />
                    <p className="text-muted-foreground font-medium">Select a season to view compliance</p>
                    <p className="text-sm text-muted-foreground">See which families have met their volunteer commitment.</p>
                  </CardContent>
                </Card>
              )}

              {selectedSeasonId && complianceLoading && (
                <div className="flex justify-center py-20">
                  <Loader2 className="h-10 w-10 animate-spin text-primary" />
                </div>
              )}

              {selectedSeasonId && !complianceLoading && families.length === 0 && (
                <Card className="border-none shadow-md">
                  <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                    <AlertCircle className="h-12 w-12 text-muted-foreground/40 mb-4" />
                    <p className="text-muted-foreground font-medium">No enrolled families found</p>
                    <p className="text-sm text-muted-foreground">No registrations have been recorded for this season yet.</p>
                  </CardContent>
                </Card>
              )}

              {selectedSeasonId && !complianceLoading && families.length > 0 && (
                <>
                  {/* Summary bar */}
                  <div className="grid grid-cols-3 gap-4">
                    <Card className="border-none shadow-md">
                      <CardContent className="pt-4 pb-4 text-center">
                        <p className="text-2xl font-bold">{families.length}</p>
                        <p className="text-sm text-muted-foreground">Families Enrolled</p>
                      </CardContent>
                    </Card>
                    <Card className="border-none shadow-md">
                      <CardContent className="pt-4 pb-4 text-center">
                        <p className="text-2xl font-bold text-green-600">{metCount}</p>
                        <p className="text-sm text-muted-foreground">Met Requirement</p>
                      </CardContent>
                    </Card>
                    <Card className="border-none shadow-md">
                      <CardContent className="pt-4 pb-4 text-center">
                        <p className="text-2xl font-bold text-destructive">{noneCount + partialCount}</p>
                        <p className="text-sm text-muted-foreground">Not Yet Complete</p>
                      </CardContent>
                    </Card>
                  </div>

                  {selectedSeason && (
                    <p className="text-sm text-muted-foreground">
                      Requirement: <strong>{selectedSeason.volunteerSlotsRequired ?? 1} slot{(selectedSeason.volunteerSlotsRequired ?? 1) !== 1 ? 's' : ''}</strong> per family for the {selectedSeason.name} season.
                    </p>
                  )}

                  {/* Search */}
                  <Input
                    placeholder="Search by name or email…"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="max-w-sm"
                  />

                  {/* Compliance table */}
                  <Card className="border-none shadow-md overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/30">
                            <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Family</th>
                            <th className="text-left px-4 py-3 font-semibold text-muted-foreground hidden sm:table-cell">Email</th>
                            <th className="text-center px-4 py-3 font-semibold text-muted-foreground">Slots</th>
                            <th className="text-center px-4 py-3 font-semibold text-muted-foreground">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredFamilies.map(family => {
                            const status = complianceStatus(family);
                            return (
                              <tr key={family.parentUserId} className="border-b last:border-0 hover:bg-muted/20">
                                <td className="px-4 py-3 font-medium">{family.displayName}</td>
                                <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{family.email}</td>
                                <td className="px-4 py-3 text-center">
                                  {family.slotsCount} / {family.required}
                                </td>
                                <td className="px-4 py-3 text-center">
                                  {status === 'met' && (
                                    <Badge className="bg-green-100 text-green-700 border-green-200 gap-1">
                                      <CheckCircle2 className="h-3 w-3" /> Met
                                    </Badge>
                                  )}
                                  {status === 'partial' && (
                                    <Badge variant="secondary" className="gap-1">
                                      <AlertCircle className="h-3 w-3" /> Partial
                                    </Badge>
                                  )}
                                  {status === 'none' && (
                                    <Badge variant="destructive" className="gap-1">
                                      <XCircle className="h-3 w-3" /> Not Signed Up
                                    </Badge>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                </>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </main>

      {/* Add Slot Dialog */}
      <Dialog open={addDialog} onOpenChange={setAddDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Concession Slot</DialogTitle>
            <DialogDescription>Create a volunteer slot for a game date.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Game Date *</Label>
              <Input type="date" value={formData.gameDate}
                onChange={e => setFormData(prev => ({ ...prev, gameDate: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Start Time</Label>
                <Input type="time" value={formData.startTime}
                  onChange={e => setFormData(prev => ({ ...prev, startTime: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>End Time</Label>
                <Input type="time" value={formData.endTime}
                  onChange={e => setFormData(prev => ({ ...prev, endTime: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Volunteer Capacity</Label>
                <Input type="number" min={1} max={20} value={formData.capacity}
                  onChange={e => setFormData(prev => ({ ...prev, capacity: Number(e.target.value) }))} />
              </div>
              <div className="space-y-1">
                <Label>Cancel Cutoff (hours)</Label>
                <Input type="number" min={0} max={168} value={formData.cancelCutoffHours}
                  onChange={e => setFormData(prev => ({ ...prev, cancelCutoffHours: Number(e.target.value) }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Description (optional)</Label>
              <Input placeholder="e.g. Snack bar — opening shift" value={formData.description}
                onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialog(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleAddSlot} disabled={saving || !formData.gameDate}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create Slot
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Slot Dialog */}
      <Dialog open={deleteDialog.open} onOpenChange={(open) => !deleting && setDeleteDialog(prev => ({ ...prev, open }))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Slot</DialogTitle>
            <DialogDescription>
              Delete the concession slot for <strong>{deleteDialog.slot?.gameDate}</strong>? All sign-ups will be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog({ open: false, slot: null })} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteSlot} disabled={deleting}>
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
