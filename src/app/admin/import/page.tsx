"use client";

import { useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useUser, useMemoFirebase, useCollection } from '@/firebase';
import {
  doc, deleteDoc, collection, query, orderBy,
  collectionGroup,
} from 'firebase/firestore';
import {
  Loader2, Trash2, Users,
  Activity, Calendar, Megaphone,
  BookOpen,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { deleteSeasonCascade } from '@/lib/season-delete';
import type { Announcement } from '@/types/scheduling';

interface Team {
  id: string;
  name: string;
  divisionId: string;
  player_ids?: string[];
}

interface Season {
  id: string;
  name: string;
  status?: string;
}

interface BoardMeeting {
  id: string;
  title: string;
  date?: string;
}

export default function DataManagementPage() {
  const db = useFirestore();
  const { user, isSiteAdmin, loading: loadingUser } = useUser();
  const { toast } = useToast();

  // ── All hooks before early returns (Rules of Hooks) ──────────────────────
  const teamsQuery = useMemoFirebase(() => db ? collection(db, 'teams') : null, [db]);
  const seasonsQuery = useMemoFirebase(() => db ? collection(db, 'seasons') : null, [db]);
  const announcementsQuery = useMemoFirebase(
    () => db ? query(collection(db, 'announcements'), orderBy('publishedAt', 'desc')) : null,
    [db]
  );
  const boardMeetingsQuery = useMemoFirebase(
    () => db ? query(collection(db, 'boardMeetings'), orderBy('date', 'desc')) : null,
    [db]
  );
  const playersQuery = useMemoFirebase(
    () => db ? collectionGroup(db, 'players') : null,
    [db]
  );

  const { data: teams } = useCollection<Team>(teamsQuery);
  const { data: seasons } = useCollection<Season>(seasonsQuery);
  const { data: announcements } = useCollection<Announcement>(announcementsQuery);
  const { data: boardMeetings } = useCollection<BoardMeeting>(boardMeetingsQuery);
  const { data: players } = useCollection<{ id: string }>(playersQuery);

  // Delete confirm state (inline — no modals)
  const [confirmDeleteTeamId, setConfirmDeleteTeamId] = useState<string | null>(null);
  const [confirmDeleteSeasonId, setConfirmDeleteSeasonId] = useState<string | null>(null);
  const [confirmDeleteAnnouncementId, setConfirmDeleteAnnouncementId] = useState<string | null>(null);
  const [confirmDeleteMeetingId, setConfirmDeleteMeetingId] = useState<string | null>(null);
  const [deleteLoadingId, setDeleteLoadingId] = useState<string | null>(null);


  if (loadingUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Please sign in to continue.</p>
      </div>
    );
  }

  if (!isSiteAdmin) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6 flex items-center justify-center">
          <Card className="max-w-md text-center border-none shadow-xl">
            <CardHeader>
              <CardTitle className="font-headline text-2xl">Access Denied</CardTitle>
              <CardDescription>You do not have the required permissions to access Data Management.</CardDescription>
            </CardHeader>
          </Card>
        </main>
      </div>
    );
  }

  // ── Derived stats ─────────────────────────────────────────────────────────
  const totalTeams = teams?.length ?? 0;
  const totalPlayers = players?.length ?? 0;
  const kidPitchCount = teams?.filter(t => t.divisionId === 'kid-pitch').length ?? 0;
  const coachPitchCount = teams?.filter(t => t.divisionId === 'coach-pitch').length ?? 0;

  // ── Division grouping ─────────────────────────────────────────────────────
  const divisionLabels: Record<string, string> = {
    'kid-pitch': 'Kid Pitch',
    'coach-pitch': 'Coach Pitch',
    'tball': 'T-Ball',
  };
  const groupedTeams = ['kid-pitch', 'coach-pitch', 'tball']
    .map(divId => ({
      label: divisionLabels[divId],
      teams: teams?.filter(t => t.divisionId === divId) ?? [],
    }))
    .filter(g => g.teams.length > 0);

  // ── Delete Season ─────────────────────────────────────────────────────────
  const handleDeleteSeason = async (seasonId: string) => {
    if (!db) return;
    setDeleteLoadingId(seasonId);
    try {
      const result = await deleteSeasonCascade(db, seasonId);
      if (!result.ok) {
        toast({
          variant: "destructive",
          title: "Cannot Delete Season",
          description: `${result.count} enrollment record(s) reference this season. Archive it from the Seasons page instead.`,
        });
        setConfirmDeleteSeasonId(null);
        return;
      }
      setConfirmDeleteSeasonId(null);
      toast({ title: "Season Deleted" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Delete Failed", description: e.message });
    } finally {
      setDeleteLoadingId(null);
    }
  };

  // ── Delete Team ───────────────────────────────────────────────────────────
  const handleDeleteTeam = async (teamId: string) => {
    if (!db) return;
    setDeleteLoadingId(teamId);
    try {
      await deleteDoc(doc(db, 'teams', teamId));
      setConfirmDeleteTeamId(null);
      toast({ title: "Team Deleted" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Delete Failed", description: e.message });
    } finally {
      setDeleteLoadingId(null);
    }
  };

  // ── Delete Announcement ───────────────────────────────────────────────────
  const handleDeleteAnnouncement = async (id: string) => {
    if (!db) return;
    setDeleteLoadingId(id);
    try {
      await deleteDoc(doc(db, 'announcements', id));
      setConfirmDeleteAnnouncementId(null);
      toast({ title: "Announcement Deleted" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Delete Failed", description: e.message });
    } finally {
      setDeleteLoadingId(null);
    }
  };

  // ── Delete Board Meeting ──────────────────────────────────────────────────
  const handleDeleteMeeting = async (id: string) => {
    if (!db) return;
    setDeleteLoadingId(id);
    try {
      await deleteDoc(doc(db, 'boardMeetings', id));
      setConfirmDeleteMeetingId(null);
      toast({ title: "Board Meeting Deleted" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Delete Failed", description: e.message });
    } finally {
      setDeleteLoadingId(null);
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6">
        <header className="mb-4 md:mb-6">
          <h1 className="text-xl md:text-2xl font-bold font-headline">Data Management</h1>
          <p className="text-sm text-muted-foreground">Monitor data health and manage league records.</p>
        </header>

        <div className="grid gap-4 max-w-3xl">

          {/* ── Data Status ── */}
          <Card className="border-none shadow-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-primary" />
                League Data Status
              </CardTitle>
              <CardDescription>Live snapshot of data currently in Firestore.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div className="rounded-xl border bg-secondary/20 p-4 text-center">
                  <p className="text-3xl font-bold text-primary">{totalTeams}</p>
                  <p className="text-xs text-muted-foreground mt-1">Total Teams</p>
                </div>
                <div className="rounded-xl border bg-secondary/20 p-4 text-center">
                  <p className="text-3xl font-bold text-primary">{totalPlayers}</p>
                  <p className="text-xs text-muted-foreground mt-1">Total Players</p>
                </div>
                <div className="rounded-xl border bg-secondary/20 p-4 text-center">
                  <p className="text-3xl font-bold text-primary">{kidPitchCount}</p>
                  <p className="text-xs text-muted-foreground mt-1">Kid Pitch</p>
                </div>
                <div className="rounded-xl border bg-secondary/20 p-4 text-center">
                  <p className="text-3xl font-bold text-primary">{coachPitchCount}</p>
                  <p className="text-xs text-muted-foreground mt-1">Coach Pitch</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── Manage Seasons ── */}
          <Card className="border-none shadow-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-primary" />
                Manage Seasons
              </CardTitle>
              <CardDescription>
                Delete a season and its divisions. Blocked if enrollment records exist for that season.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!seasons || seasons.length === 0 ? (
                <p className="text-sm text-muted-foreground">No seasons found.</p>
              ) : (
                <div className="space-y-2">
                  {seasons.map(season => (
                    <div key={season.id} className="rounded-xl border p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{season.name}</span>
                          {season.status && (
                            <Badge variant={season.status === 'active' ? 'default' : 'secondary'} className="text-xs">
                              {season.status}
                            </Badge>
                          )}
                        </div>
                        {confirmDeleteSeasonId === season.id ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-destructive font-medium">Delete this season?</span>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="h-7 text-xs"
                              onClick={() => handleDeleteSeason(season.id)}
                              disabled={deleteLoadingId === season.id}
                            >
                              {deleteLoadingId === season.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Confirm'}
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setConfirmDeleteSeasonId(null)}>
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => setConfirmDeleteSeasonId(season.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                          </Button>
                        )}
                      </div>
                      {confirmDeleteSeasonId === season.id && (
                        <p className="text-xs text-muted-foreground pl-1">
                          This will also delete all divisions under this season. Seasons with enrollment records cannot be deleted.
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Manage Teams ── */}
          <Card className="border-none shadow-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                Manage Teams
              </CardTitle>
              <CardDescription>
                Delete individual teams. Enrollment records for players are not affected.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!teams || teams.length === 0 ? (
                <p className="text-sm text-muted-foreground">No teams found.</p>
              ) : (
                <div className="space-y-4">
                  {groupedTeams.map(group => (
                    <div key={group.label}>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{group.label}</p>
                      <div className="space-y-2">
                        {group.teams.map(team => (
                          <div key={team.id} className="rounded-xl border p-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm">{team.name}</span>
                                <span className="text-xs text-muted-foreground">{team.player_ids?.length ?? 0} players</span>
                              </div>
                              {confirmDeleteTeamId === team.id ? (
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-destructive font-medium">Delete this team?</span>
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    className="h-7 text-xs"
                                    onClick={() => handleDeleteTeam(team.id)}
                                    disabled={deleteLoadingId === team.id}
                                  >
                                    {deleteLoadingId === team.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Confirm'}
                                  </Button>
                                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setConfirmDeleteTeamId(null)}>
                                    Cancel
                                  </Button>
                                </div>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                                  onClick={() => setConfirmDeleteTeamId(team.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Manage Announcements ── */}
          <Card className="border-none shadow-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Megaphone className="h-5 w-5 text-primary" />
                Manage Announcements
              </CardTitle>
              <CardDescription>Delete individual announcements.</CardDescription>
            </CardHeader>
            <CardContent>
              {!announcements || announcements.length === 0 ? (
                <p className="text-sm text-muted-foreground">No announcements found.</p>
              ) : (
                <div className="space-y-2">
                  {announcements.map(ann => (
                    <div key={ann.id} className="rounded-xl border p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-medium text-sm">{ann.title}</span>
                          {ann.publishedAt && (
                            <span className="text-xs text-muted-foreground ml-2">
                              {new Date(ann.publishedAt).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                        {confirmDeleteAnnouncementId === ann.id ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-destructive font-medium">Delete?</span>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="h-7 text-xs"
                              onClick={() => handleDeleteAnnouncement(ann.id)}
                              disabled={deleteLoadingId === ann.id}
                            >
                              {deleteLoadingId === ann.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Confirm'}
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setConfirmDeleteAnnouncementId(null)}>
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => setConfirmDeleteAnnouncementId(ann.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Manage Board Meetings ── */}
          <Card className="border-none shadow-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-primary" />
                Manage Board Meetings
              </CardTitle>
              <CardDescription>Delete individual board meeting records.</CardDescription>
            </CardHeader>
            <CardContent>
              {!boardMeetings || boardMeetings.length === 0 ? (
                <p className="text-sm text-muted-foreground">No board meetings found.</p>
              ) : (
                <div className="space-y-2">
                  {boardMeetings.map(meeting => (
                    <div key={meeting.id} className="rounded-xl border p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-medium text-sm">{meeting.title}</span>
                          {meeting.date && (
                            <span className="text-xs text-muted-foreground ml-2">{meeting.date}</span>
                          )}
                        </div>
                        {confirmDeleteMeetingId === meeting.id ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-destructive font-medium">Delete?</span>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="h-7 text-xs"
                              onClick={() => handleDeleteMeeting(meeting.id)}
                              disabled={deleteLoadingId === meeting.id}
                            >
                              {deleteLoadingId === meeting.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Confirm'}
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setConfirmDeleteMeetingId(null)}>
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => setConfirmDeleteMeetingId(meeting.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

        </div>
      </main>
    </div>
  );
}
