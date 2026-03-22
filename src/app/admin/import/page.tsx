"use client";

import { useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useFirestore, useUser } from '@/firebase';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { Loader2, Upload, CheckCircle2, AlertTriangle, Trash2, Users, UserPlus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function ImportPage() {
  const db = useFirestore();
  const { user, isAdmin } = useUser();
  const { toast } = useToast();

  const [clearLoading, setClearLoading] = useState(false);
  const [clearDone, setClearDone] = useState(false);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [teamsDone, setTeamsDone] = useState(false);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterDone, setRosterDone] = useState(false);

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Access denied.</p>
      </div>
    );
  }

  // ─── Section 1: Clear Demo Data ────────────────────────────────────────────

  const handleClearDemo = async () => {
    if (!db) return;
    setClearLoading(true);
    try {
      const deletes: Promise<void>[] = [];

      // Demo team games (subcollections)
      deletes.push(deleteDoc(doc(db, 'teams', 'blue-jays-spring-2026', 'games', 'game-1')));
      deletes.push(deleteDoc(doc(db, 'teams', 'blue-jays-spring-2026', 'games', 'practice-1')));
      deletes.push(deleteDoc(doc(db, 'teams', 'tigers-spring-2026', 'games', 'game-2')));

      // Demo teams
      deletes.push(deleteDoc(doc(db, 'teams', 'blue-jays-spring-2026')));
      deletes.push(deleteDoc(doc(db, 'teams', 'cardinals-spring-2026')));
      deletes.push(deleteDoc(doc(db, 'teams', 'tigers-spring-2026')));

      // Demo coach 1 subcollections + profile
      deletes.push(deleteDoc(doc(db, 'userProfiles', 'demo-coach-uid', 'clearances', 'childabuse')));
      deletes.push(deleteDoc(doc(db, 'userProfiles', 'demo-coach-uid', 'clearances', 'criminalrecord')));
      deletes.push(deleteDoc(doc(db, 'userProfiles', 'demo-coach-uid')));

      // Demo coach 2 subcollections + profile
      deletes.push(deleteDoc(doc(db, 'userProfiles', 'demo-coach-2-uid', 'clearances', 'childabuse')));
      deletes.push(deleteDoc(doc(db, 'userProfiles', 'demo-coach-2-uid', 'clearances', 'criminalrecord')));
      deletes.push(deleteDoc(doc(db, 'userProfiles', 'demo-coach-2-uid', 'clearances', 'fbi')));
      deletes.push(deleteDoc(doc(db, 'userProfiles', 'demo-coach-2-uid')));

      // Demo parent 1 subcollections + profile
      deletes.push(deleteDoc(doc(db, 'userProfiles', 'demo-parent-uid', 'players', 'player-1')));
      deletes.push(deleteDoc(doc(db, 'userProfiles', 'demo-parent-uid', 'enrollments', 'enroll-1')));
      deletes.push(deleteDoc(doc(db, 'userProfiles', 'demo-parent-uid')));

      // Demo parent 2 subcollections + profile
      deletes.push(deleteDoc(doc(db, 'userProfiles', 'demo-parent-2-uid', 'players', 'player-2')));
      deletes.push(deleteDoc(doc(db, 'userProfiles', 'demo-parent-2-uid', 'players', 'player-3')));
      deletes.push(deleteDoc(doc(db, 'userProfiles', 'demo-parent-2-uid', 'enrollments', 'enroll-2')));
      deletes.push(deleteDoc(doc(db, 'userProfiles', 'demo-parent-2-uid', 'enrollments', 'enroll-3')));
      deletes.push(deleteDoc(doc(db, 'userProfiles', 'demo-parent-2-uid')));

      // Current user's demo player/enrollment (from "Assign Me as Demo Coach" seed option)
      if (user) {
        deletes.push(deleteDoc(doc(db, 'userProfiles', user.uid, 'players', 'my-player-1')));
        deletes.push(deleteDoc(doc(db, 'userProfiles', user.uid, 'enrollments', 'my-enroll-1')));
      }

      // Demo announcements, concession slots, board meetings
      deletes.push(deleteDoc(doc(db, 'announcements', 'ann-1')));
      deletes.push(deleteDoc(doc(db, 'announcements', 'ann-2')));
      deletes.push(deleteDoc(doc(db, 'concessionSlots', 'slot-1')));
      deletes.push(deleteDoc(doc(db, 'concessionSlots', 'slot-2')));
      deletes.push(deleteDoc(doc(db, 'boardMeetings', 'meeting-1')));

      await Promise.allSettled(deletes); // allSettled — don't fail if doc didn't exist

      toast({ title: "Demo Data Cleared", description: "All seed/demo data has been removed." });
      setClearDone(true);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Clear Failed", description: e.message });
    } finally {
      setClearLoading(false);
    }
  };

  // ─── Section 2: Create All 11 Teams ────────────────────────────────────────

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
          id: team.id,
          name: team.name,
          seasonId,
          divisionId: 'kid-pitch',
          coachIds: [],
          player_ids: [],
          createdAt: now,
        }));
      }

      for (const team of coachPitchTeams) {
        writes.push(setDoc(doc(db, 'teams', team.id), {
          id: team.id,
          name: team.name,
          seasonId,
          divisionId: 'coach-pitch',
          coachIds: [],
          player_ids: [],
          createdAt: now,
        }));
      }

      await Promise.all(writes);

      toast({ title: "Teams Created", description: "11 teams created across Kid Pitch and Coach Pitch divisions." });
      setTeamsDone(true);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Team Creation Failed", description: e.message });
    } finally {
      setTeamsLoading(false);
    }
  };

  // ─── Section 3: Import Yankees Roster ──────────────────────────────────────

  const handleImportRoster = async () => {
    if (!db) return;
    setRosterLoading(true);
    try {
      const now = new Date().toISOString();
      const seasonId = 'spring-2026';
      const divisionId = 'coach-pitch';
      const teamId = 'yankees-spring-2026';

      // 11 unique parents
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

      // 12 players mapped to parent UIDs
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

      // Write parent profiles
      for (const parent of parents) {
        writes.push(setDoc(doc(db, 'userProfiles', parent.uid), {
          id: parent.uid,
          displayName: parent.displayName,
          email: parent.email,
          phoneNumber: parent.phoneNumber,
          role: 'Parent',
          roles: ['Parent'],
          shareContactInfo: true,
          createdAt: now,
        }));
      }

      // Write players + enrollments
      for (const player of players) {
        writes.push(setDoc(doc(db, 'userProfiles', player.parentUid, 'players', player.id), {
          id: player.id,
          firstName: player.firstName,
          lastName: player.lastName,
          parentUserId: player.parentUid,
          teamId,
          division: divisionId,
          seasonId,
          medicalNotes: '',
          ageVerified: false,
          emergencyContacts: [],
          createdAt: now,
        }));

        writes.push(setDoc(doc(db, 'userProfiles', player.parentUid, 'enrollments', `enroll-${player.id}`), {
          id: `enroll-${player.id}`,
          playerId: player.id,
          seasonId,
          divisionId,
          parentUserId: player.parentUid,
          paymentStatus: 'paid',
          teamId,
          createdAt: now,
        }));
      }

      await Promise.all(writes);

      // Update Yankees team player_ids
      await setDoc(doc(db, 'teams', teamId), {
        player_ids: players.map(p => p.id),
      }, { merge: true });

      toast({ title: "Roster Imported", description: "12 Yankees players and 11 parent profiles created." });
      setRosterDone(true);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Roster Import Failed", description: e.message });
    } finally {
      setRosterLoading(false);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold font-headline">Demo Data Import</h1>
          <p className="text-muted-foreground">Run each step in order to prepare the app for the board member demo.</p>
        </header>

        <div className="grid gap-8 max-w-3xl">

          {/* Step 1: Clear Demo Data */}
          <Card className="border-none shadow-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trash2 className="h-5 w-5 text-destructive" />
                Step 1 — Clear Demo Data
              </CardTitle>
              <CardDescription>
                Deletes the placeholder Blue Jays, Cardinals, and Tigers teams, all demo user profiles, and sample announcements/concessions/board meetings. Season, divisions, and fields are kept.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {clearDone ? (
                <div className="bg-green-100 text-green-700 p-4 rounded-xl flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 shrink-0" />
                  <span className="text-sm font-medium">Demo data cleared successfully.</span>
                </div>
              ) : (
                <Button
                  variant="destructive"
                  onClick={handleClearDemo}
                  className="w-full h-12 rounded-xl text-base font-bold"
                  disabled={clearLoading}
                >
                  {clearLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Trash2 className="mr-2 h-5 w-5" />}
                  Clear All Demo Data
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Step 2: Create Teams */}
          <Card className="border-none shadow-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                Step 2 — Create Season Teams
              </CardTitle>
              <CardDescription>
                Creates all 11 real SYBA teams for Spring 2026: 6 Kid Pitch teams (Mariners, Rays, Phillies, Athletics, Dodgers, Pirates) and 5 Coach Pitch teams (Braves, Yankees, Cubs, Reds, Brewers).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {teamsDone ? (
                <div className="space-y-3">
                  <div className="bg-green-100 text-green-700 p-4 rounded-xl flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 shrink-0" />
                    <span className="text-sm font-medium">11 teams created successfully.</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 px-1">
                    {['Mariners', 'Rays', 'Phillies', 'Athletics', 'Dodgers', 'Pirates', 'Braves', 'Yankees', 'Cubs', 'Reds', 'Brewers'].map(name => (
                      <div key={name} className="flex items-center gap-2 text-xs text-green-700">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                        {name}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <Button
                  onClick={handleCreateTeams}
                  className="w-full h-12 rounded-xl text-base font-bold"
                  disabled={teamsLoading}
                >
                  {teamsLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Users className="mr-2 h-5 w-5" />}
                  Create All 11 Teams
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Step 3: Import Yankees Roster */}
          <Card className="border-none shadow-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-primary" />
                Step 3 — Import Yankees Roster
              </CardTitle>
              <CardDescription>
                Creates 11 parent profiles and 12 player records for the Coach Pitch Yankees. Siblings Tanner and Gunnar Schreckenghost share one parent contact. Maxwell Dudzinski's parent is Carolyn Janosko; Ryan Laskowitz's parent is Susan Stigliano.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-xl flex items-start gap-3">
                <AlertTriangle className="h-4 w-4 text-yellow-600 shrink-0 mt-0.5" />
                <p className="text-xs text-yellow-700">
                  Run Step 2 first. Parent accounts are created as Firestore-only profiles — they cannot log in to the portal, but all contact info will be visible in admin views.
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
                      'Severide Anderson', 'Roman Angermeier', 'Matthew Bagzis', 'Ezra Blakeman',
                      'Maxwell Dudzinski', 'Ryan Laskowitz', 'Ezra Moon', 'Jett Oris',
                      'Winston Pokrant', 'Tanner Schreckenghost', 'Gunnar Schreckenghost', 'Carter Skladanek',
                    ].map(name => (
                      <div key={name} className="flex items-center gap-2 text-xs text-green-700">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                        {name}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <Button
                  onClick={handleImportRoster}
                  className="w-full h-12 rounded-xl text-base font-bold"
                  disabled={rosterLoading}
                >
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
