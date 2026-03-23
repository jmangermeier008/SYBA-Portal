"use client";

import { useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useUser, useMemoFirebase, useCollection } from '@/firebase';
import {
  doc, setDoc, deleteDoc, updateDoc, collection, query, orderBy,
  collectionGroup, where, getDocs,
} from 'firebase/firestore';
import {
  Loader2, Database, CheckCircle2, AlertTriangle, Trash2, Users, UserPlus,
  ShieldCheck, User as UserIcon, UserCheck, Activity, Calendar, Megaphone,
  BookOpen,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

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

interface Announcement {
  id: string;
  title: string;
  publishedAt?: string;
}

interface BoardMeeting {
  id: string;
  title: string;
  date?: string;
}

export default function DataManagementPage() {
  const db = useFirestore();
  const { user, profile, isSiteAdmin, loading: loadingUser } = useUser();
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

  const { data: teams } = useCollection<Team>(teamsQuery);
  const { data: seasons } = useCollection<Season>(seasonsQuery);
  const { data: announcements } = useCollection<Announcement>(announcementsQuery);
  const { data: boardMeetings } = useCollection<BoardMeeting>(boardMeetingsQuery);

  // Role switcher state
  const [roleLoading, setRoleLoading] = useState(false);

  // Delete confirm state (inline — no modals)
  const [confirmDeleteTeamId, setConfirmDeleteTeamId] = useState<string | null>(null);
  const [confirmDeleteSeasonId, setConfirmDeleteSeasonId] = useState<string | null>(null);
  const [confirmDeleteAnnouncementId, setConfirmDeleteAnnouncementId] = useState<string | null>(null);
  const [confirmDeleteMeetingId, setConfirmDeleteMeetingId] = useState<string | null>(null);
  const [deleteLoadingId, setDeleteLoadingId] = useState<string | null>(null);

  // Import operation state
  const [clearLoading, setClearLoading] = useState(false);
  const [clearDone, setClearDone] = useState(false);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [teamsDone, setTeamsDone] = useState(false);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterDone, setRosterDone] = useState(false);

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
        <p className="text-muted-foreground">Please sign in to continue.</p>
      </div>
    );
  }

  if (!isSiteAdmin) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8 flex items-center justify-center">
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
  const kidPitchCount = teams?.filter(t => t.divisionId === 'kid-pitch').length ?? 0;
  const coachPitchCount = teams?.filter(t => t.divisionId === 'coach-pitch').length ?? 0;
  const yankeesPlayerCount = teams?.find(t => t.id === 'yankees-spring-2026')?.player_ids?.length ?? 0;

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

  // ── Role Switcher ─────────────────────────────────────────────────────────
  const handleRoleSwitch = async (newRole: 'Site Admin' | 'Admin' | 'Board Member' | 'Coach' | 'Parent') => {
    if (!user || !db) return;
    setRoleLoading(true);
    try {
      // Legacy 'role' field only supports Parent/Coach/Admin — map higher roles to Admin
      const legacyRole = (newRole === 'Site Admin' || newRole === 'Board Member') ? 'Admin' : newRole;
      await updateDoc(doc(db, 'userProfiles', user.uid), {
        role: legacyRole,
        roles: [newRole],
        updatedAt: new Date().toISOString(),
      });
      toast({ title: "Role Updated", description: `Switched to ${newRole}. Reloading…` });
      setTimeout(() => window.location.reload(), 500);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Update Failed", description: e.message });
    } finally {
      setRoleLoading(false);
    }
  };

  // ── Delete Season ─────────────────────────────────────────────────────────
  const handleDeleteSeason = async (seasonId: string) => {
    if (!db) return;
    setDeleteLoadingId(seasonId);
    try {
      // Check for enrollment dependencies
      const enrollSnap = await getDocs(
        query(collectionGroup(db, 'enrollments'), where('seasonId', '==', seasonId))
      );
      if (!enrollSnap.empty) {
        toast({
          variant: "destructive",
          title: "Cannot Delete Season",
          description: `${enrollSnap.size} enrollment record(s) reference this season. Remove enrollments first.`,
        });
        setConfirmDeleteSeasonId(null);
        return;
      }

      // Delete all divisions under the season
      const divsSnap = await getDocs(collection(db, 'seasons', seasonId, 'divisions'));
      await Promise.all(divsSnap.docs.map(d => deleteDoc(d.ref)));

      // Delete the season itself
      await deleteDoc(doc(db, 'seasons', seasonId));
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

  // ── Clear Demo Data ───────────────────────────────────────────────────────
  const handleClearDemo = async () => {
    if (!db) return;
    setClearLoading(true);
    try {
      const deletes: Promise<void>[] = [];

      deletes.push(deleteDoc(doc(db, 'teams', 'blue-jays-spring-2026', 'games', 'game-1')));
      deletes.push(deleteDoc(doc(db, 'teams', 'blue-jays-spring-2026', 'games', 'practice-1')));
      deletes.push(deleteDoc(doc(db, 'teams', 'tigers-spring-2026', 'games', 'game-2')));
      deletes.push(deleteDoc(doc(db, 'teams', 'blue-jays-spring-2026')));
      deletes.push(deleteDoc(doc(db, 'teams', 'cardinals-spring-2026')));
      deletes.push(deleteDoc(doc(db, 'teams', 'tigers-spring-2026')));

      deletes.push(deleteDoc(doc(db, 'userProfiles', 'demo-coach-uid', 'clearances', 'childabuse')));
      deletes.push(deleteDoc(doc(db, 'userProfiles', 'demo-coach-uid', 'clearances', 'criminalrecord')));
      deletes.push(deleteDoc(doc(db, 'userProfiles', 'demo-coach-uid')));
      deletes.push(deleteDoc(doc(db, 'userProfiles', 'demo-coach-2-uid', 'clearances', 'childabuse')));
      deletes.push(deleteDoc(doc(db, 'userProfiles', 'demo-coach-2-uid', 'clearances', 'criminalrecord')));
      deletes.push(deleteDoc(doc(db, 'userProfiles', 'demo-coach-2-uid', 'clearances', 'fbi')));
      deletes.push(deleteDoc(doc(db, 'userProfiles', 'demo-coach-2-uid')));
      deletes.push(deleteDoc(doc(db, 'userProfiles', 'demo-parent-uid', 'players', 'player-1')));
      deletes.push(deleteDoc(doc(db, 'userProfiles', 'demo-parent-uid', 'enrollments', 'enroll-1')));
      deletes.push(deleteDoc(doc(db, 'userProfiles', 'demo-parent-uid')));
      deletes.push(deleteDoc(doc(db, 'userProfiles', 'demo-parent-2-uid', 'players', 'player-2')));
      deletes.push(deleteDoc(doc(db, 'userProfiles', 'demo-parent-2-uid', 'players', 'player-3')));
      deletes.push(deleteDoc(doc(db, 'userProfiles', 'demo-parent-2-uid', 'enrollments', 'enroll-2')));
      deletes.push(deleteDoc(doc(db, 'userProfiles', 'demo-parent-2-uid', 'enrollments', 'enroll-3')));
      deletes.push(deleteDoc(doc(db, 'userProfiles', 'demo-parent-2-uid')));

      if (user) {
        deletes.push(deleteDoc(doc(db, 'userProfiles', user.uid, 'players', 'my-player-1')));
        deletes.push(deleteDoc(doc(db, 'userProfiles', user.uid, 'enrollments', 'my-enroll-1')));
      }

      deletes.push(deleteDoc(doc(db, 'announcements', 'ann-1')));
      deletes.push(deleteDoc(doc(db, 'announcements', 'ann-2')));
      deletes.push(deleteDoc(doc(db, 'concessionSlots', 'slot-1')));
      deletes.push(deleteDoc(doc(db, 'concessionSlots', 'slot-2')));
      deletes.push(deleteDoc(doc(db, 'boardMeetings', 'meeting-1')));

      await Promise.allSettled(deletes);
      toast({ title: "Demo Data Cleared", description: "All placeholder data removed." });
      setClearDone(true);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Clear Failed", description: e.message });
    } finally {
      setClearLoading(false);
    }
  };

  // ── Create Teams ──────────────────────────────────────────────────────────
  const handleCreateTeams = async () => {
    if (!db) return;
    setTeamsLoading(true);
    try {
      const now = new Date().toISOString();
      const seasonId = 'spring-2026';

      const kidPitchTeams = [
        { id: 'mariners-spring-2026', name: 'Mariners' },
        { id: 'rays-spring-2026', name: 'Rays' },
        { id: 'phillies-spring-2026', name: 'Phillies' },
        { id: 'athletics-spring-2026', name: 'Athletics' },
        { id: 'dodgers-spring-2026', name: 'Dodgers' },
        { id: 'pirates-spring-2026', name: 'Pirates' },
      ];
      const coachPitchTeams = [
        { id: 'braves-spring-2026', name: 'Braves' },
        { id: 'yankees-spring-2026', name: 'Yankees' },
        { id: 'cubs-spring-2026', name: 'Cubs' },
        { id: 'reds-spring-2026', name: 'Reds' },
        { id: 'brewers-spring-2026', name: 'Brewers' },
      ];

      const writes: Promise<void>[] = [];
      for (const team of kidPitchTeams) {
        writes.push(setDoc(doc(db, 'teams', team.id), {
          id: team.id, name: team.name, seasonId, divisionId: 'kid-pitch',
          coachIds: [], player_ids: [], createdAt: now,
        }));
      }
      for (const team of coachPitchTeams) {
        writes.push(setDoc(doc(db, 'teams', team.id), {
          id: team.id, name: team.name, seasonId, divisionId: 'coach-pitch',
          coachIds: [], player_ids: [], createdAt: now,
        }));
      }
      await Promise.all(writes);
      toast({ title: "Teams Created", description: "11 teams created — 6 Kid Pitch, 5 Coach Pitch." });
      setTeamsDone(true);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Team Creation Failed", description: e.message });
    } finally {
      setTeamsLoading(false);
    }
  };

  // ── Import Yankees Roster ─────────────────────────────────────────────────
  const handleImportRoster = async () => {
    if (!db) return;
    setRosterLoading(true);
    try {
      const now = new Date().toISOString();
      const seasonId = 'spring-2026';
      const divisionId = 'coach-pitch';
      const teamId = 'yankees-spring-2026';

      const parents = [
        { uid: 'parent-melissa-anderson', displayName: 'Melissa Anderson', email: 'jambo0621@hotmail.com', phoneNumber: '724-813-1748' },
        { uid: 'parent-justin-angermeier', displayName: 'Justin Angermeier', email: 'jmangermeier008@gmail.com', phoneNumber: '724-699-1282' },
        { uid: 'parent-tessa-bagzis', displayName: 'Tessa Bagzis', email: 'trbagzis@gmail.com', phoneNumber: '724-815-3024' },
        { uid: 'parent-nate-blakeman', displayName: 'Nate Blakeman', email: 'n.d.blakeman95@gmail.com', phoneNumber: '724-979-0010' },
        { uid: 'parent-carolyn-janosko', displayName: 'Carolyn Janosko', email: 'carolyn.janosko@gmail.com', phoneNumber: '724-977-0741' },
        { uid: 'parent-susan-stigliano', displayName: 'Susan Stigliano', email: 'smstigliano@gmail.com', phoneNumber: '724-815-5580' },
        { uid: 'parent-samantha-moon', displayName: 'Samantha Moon', email: 'samanthalmoon@gmail.com', phoneNumber: '724-612-0104' },
        { uid: 'parent-zayne-oris', displayName: 'Zayne Oris', email: 'Devo092009@gmail.com', phoneNumber: '724-674-4279' },
        { uid: 'parent-taylor-pokrant', displayName: 'Taylor Pokrant', email: 'tgp74711@gmail.com', phoneNumber: '724-992-2173' },
        { uid: 'parent-caryn-schreckenghost', displayName: 'Caryn Schreckenghost', email: 'carynmichelle15@gmail.com', phoneNumber: '206-755-9586' },
        { uid: 'parent-stephanie-skladanek', displayName: 'Stephanie Skladanek', email: 'steph_ms04@yahoo.com', phoneNumber: '724-651-7723' },
      ];

      const players = [
        { id: 'player-severide-anderson', firstName: 'Severide', lastName: 'Anderson', parentUid: 'parent-melissa-anderson' },
        { id: 'player-roman-angermeier', firstName: 'Roman', lastName: 'Angermeier', parentUid: 'parent-justin-angermeier' },
        { id: 'player-matthew-bagzis', firstName: 'Matthew', lastName: 'Bagzis', parentUid: 'parent-tessa-bagzis' },
        { id: 'player-ezra-blakeman', firstName: 'Ezra', lastName: 'Blakeman', parentUid: 'parent-nate-blakeman' },
        { id: 'player-maxwell-dudzinski', firstName: 'Maxwell', lastName: 'Dudzinski', parentUid: 'parent-carolyn-janosko' },
        { id: 'player-ryan-laskowitz', firstName: 'Ryan', lastName: 'Laskowitz', parentUid: 'parent-susan-stigliano' },
        { id: 'player-ezra-moon', firstName: 'Ezra', lastName: 'Moon', parentUid: 'parent-samantha-moon' },
        { id: 'player-jett-oris', firstName: 'Jett', lastName: 'Oris', parentUid: 'parent-zayne-oris' },
        { id: 'player-winston-pokrant', firstName: 'Winston', lastName: 'Pokrant', parentUid: 'parent-taylor-pokrant' },
        { id: 'player-tanner-schreckenghost', firstName: 'Tanner', lastName: 'Schreckenghost', parentUid: 'parent-caryn-schreckenghost' },
        { id: 'player-gunnar-schreckenghost', firstName: 'Gunnar', lastName: 'Schreckenghost', parentUid: 'parent-caryn-schreckenghost' },
        { id: 'player-carter-skladanek', firstName: 'Carter', lastName: 'Skladanek', parentUid: 'parent-stephanie-skladanek' },
      ];

      const writes: Promise<void>[] = [];
      for (const parent of parents) {
        writes.push(setDoc(doc(db, 'userProfiles', parent.uid), {
          id: parent.uid, displayName: parent.displayName, email: parent.email,
          phoneNumber: parent.phoneNumber, role: 'Parent', roles: ['Parent'],
          shareContactInfo: true, createdAt: now,
        }));
      }
      for (const player of players) {
        writes.push(setDoc(doc(db, 'userProfiles', player.parentUid, 'players', player.id), {
          id: player.id, firstName: player.firstName, lastName: player.lastName,
          parentUserId: player.parentUid, teamId, division: divisionId, seasonId,
          medicalNotes: '', ageVerified: false, emergencyContacts: [], createdAt: now,
        }));
        writes.push(setDoc(doc(db, 'userProfiles', player.parentUid, 'enrollments', `enroll-${player.id}`), {
          id: `enroll-${player.id}`, playerId: player.id, seasonId, divisionId,
          parentUserId: player.parentUid, paymentStatus: 'paid', teamId, createdAt: now,
        }));
      }
      await Promise.all(writes);
      await setDoc(doc(db, 'teams', teamId), { player_ids: players.map(p => p.id) }, { merge: true });
      toast({ title: "Roster Imported", description: "12 Yankees players and 11 parent profiles created." });
      setRosterDone(true);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Roster Import Failed", description: e.message });
    } finally {
      setRosterLoading(false);
    }
  };

  // ── Shared inline-confirm row renderer ────────────────────────────────────
  const currentRole = profile?.roles?.[0] ?? profile?.role ?? '—';

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold font-headline">Data Management</h1>
          <p className="text-muted-foreground">Monitor data health, manage league records, switch roles for demo testing, and run imports.</p>
        </header>

        <div className="grid gap-8 max-w-3xl">

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
                  <p className="text-3xl font-bold text-primary">{kidPitchCount}</p>
                  <p className="text-xs text-muted-foreground mt-1">Kid Pitch</p>
                </div>
                <div className="rounded-xl border bg-secondary/20 p-4 text-center">
                  <p className="text-3xl font-bold text-primary">{coachPitchCount}</p>
                  <p className="text-xs text-muted-foreground mt-1">Coach Pitch</p>
                </div>
                <div className="rounded-xl border bg-secondary/20 p-4 text-center">
                  <p className="text-3xl font-bold text-primary">{yankeesPlayerCount}</p>
                  <p className="text-xs text-muted-foreground mt-1">Yankees Players</p>
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

          {/* ── Role Switcher ── */}
          <Card className="border-none shadow-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                Role Switcher
              </CardTitle>
              <CardDescription>Instantly switch your account's role to preview different dashboards during the demo.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="p-4 rounded-xl border bg-primary/5 space-y-4">
                <p className="text-sm text-muted-foreground">
                  Current role: <span className="font-bold text-primary">{currentRole}</span>
                </p>
                <div className="grid grid-cols-1 gap-3">
                  <Button
                    variant={currentRole === 'Site Admin' ? 'default' : 'outline'}
                    className="justify-start h-12 rounded-xl"
                    onClick={() => handleRoleSwitch('Site Admin')}
                    disabled={roleLoading}
                  >
                    <ShieldCheck className="mr-2 h-5 w-5" /> Switch to Site Admin
                  </Button>
                  <Button
                    variant={currentRole === 'Admin' ? 'default' : 'outline'}
                    className="justify-start h-12 rounded-xl"
                    onClick={() => handleRoleSwitch('Admin')}
                    disabled={roleLoading}
                  >
                    <ShieldCheck className="mr-2 h-5 w-5" /> Switch to Admin
                  </Button>
                  <Button
                    variant={currentRole === 'Board Member' ? 'default' : 'outline'}
                    className="justify-start h-12 rounded-xl"
                    onClick={() => handleRoleSwitch('Board Member')}
                    disabled={roleLoading}
                  >
                    <UserCheck className="mr-2 h-5 w-5" /> Switch to Board Member
                  </Button>
                  <Button
                    variant={currentRole === 'Coach' ? 'default' : 'outline'}
                    className="justify-start h-12 rounded-xl"
                    onClick={() => handleRoleSwitch('Coach')}
                    disabled={roleLoading}
                  >
                    <UserCheck className="mr-2 h-5 w-5" /> Switch to Coach
                  </Button>
                  <Button
                    variant={currentRole === 'Parent' ? 'default' : 'outline'}
                    className="justify-start h-12 rounded-xl"
                    onClick={() => handleRoleSwitch('Parent')}
                    disabled={roleLoading}
                  >
                    <UserIcon className="mr-2 h-5 w-5" /> Switch to Parent
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── Step 1: Clear Demo Data ── */}
          <Card className="border-none shadow-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trash2 className="h-5 w-5 text-destructive" />
                Step 1 — Clear Demo Data
              </CardTitle>
              <CardDescription>
                Deletes placeholder Blue Jays, Cardinals, Tigers teams, all demo user profiles, and sample announcements/concessions/board meetings. Season, divisions, and fields are preserved.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {clearDone ? (
                <div className="bg-green-100 text-green-700 p-4 rounded-xl flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 shrink-0" />
                  <span className="text-sm font-medium">Demo data cleared.</span>
                </div>
              ) : (
                <Button variant="destructive" onClick={handleClearDemo} className="w-full h-12 rounded-xl text-base font-bold" disabled={clearLoading}>
                  {clearLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Trash2 className="mr-2 h-5 w-5" />}
                  Clear All Demo Data
                </Button>
              )}
            </CardContent>
          </Card>

          {/* ── Step 2: Create Teams ── */}
          <Card className="border-none shadow-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                Step 2 — Create Season Teams
              </CardTitle>
              <CardDescription>
                Creates all 11 real SYBA teams for Spring 2026 — 6 Kid Pitch and 5 Coach Pitch.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {teamsDone ? (
                <div className="space-y-3">
                  <div className="bg-green-100 text-green-700 p-4 rounded-xl flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 shrink-0" />
                    <span className="text-sm font-medium">11 teams created.</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 px-1">
                    {['Mariners','Rays','Phillies','Athletics','Dodgers','Pirates','Braves','Yankees','Cubs','Reds','Brewers'].map(name => (
                      <div key={name} className="flex items-center gap-2 text-xs text-green-700">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> {name}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <Button onClick={handleCreateTeams} className="w-full h-12 rounded-xl text-base font-bold" disabled={teamsLoading}>
                  {teamsLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Users className="mr-2 h-5 w-5" />}
                  Create All 11 Teams
                </Button>
              )}
            </CardContent>
          </Card>

          {/* ── Step 3: Import Yankees Roster ── */}
          <Card className="border-none shadow-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-primary" />
                Step 3 — Import Yankees Roster
              </CardTitle>
              <CardDescription>
                Creates 11 parent profiles and 12 player records for the Coach Pitch Yankees.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-xl flex items-start gap-3">
                <AlertTriangle className="h-4 w-4 text-yellow-600 shrink-0 mt-0.5" />
                <p className="text-xs text-yellow-700">
                  Run Step 2 first. Parent profiles are Firestore-only — contact info visible in admin but parents cannot log in to the portal.
                </p>
              </div>
              {rosterDone ? (
                <div className="space-y-3">
                  <div className="bg-green-100 text-green-700 p-4 rounded-xl flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 shrink-0" />
                    <span className="text-sm font-medium">Yankees roster imported — 12 players across 11 parent accounts.</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 px-1">
                    {[
                      'Severide Anderson','Roman Angermeier','Matthew Bagzis','Ezra Blakeman',
                      'Maxwell Dudzinski','Ryan Laskowitz','Ezra Moon','Jett Oris',
                      'Winston Pokrant','Tanner Schreckenghost','Gunnar Schreckenghost','Carter Skladanek',
                    ].map(name => (
                      <div key={name} className="flex items-center gap-2 text-xs text-green-700">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> {name}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <Button onClick={handleImportRoster} className="w-full h-12 rounded-xl text-base font-bold" disabled={rosterLoading}>
                  {rosterLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <UserPlus className="mr-2 h-5 w-5" />}
                  Import Yankees Roster
                </Button>
              )}
            </CardContent>
          </Card>

        </div>
      </main>
    </div>
  );
}
