
"use client";

import { useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useFirestore, useUser } from '@/firebase';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { Loader2, Database, CheckCircle2, AlertTriangle, UserCheck, ShieldCheck, User as UserIcon } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

export default function SeedPage() {
  const db = useFirestore();
  const { user, profile, isAdmin } = useUser();

  // C1: Block in production and for non-admins
  if (process.env.NODE_ENV !== 'development') return null;
  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Access denied.</p>
      </div>
    );
  }
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [assignMeAsCoach, setAssignMeAsCoach] = useState(false);

  const handleRoleSwitch = async (newRole: 'Admin' | 'Coach' | 'Parent') => {
    if (!user || !db) return;
    setLoading(true);
    try {
      await updateDoc(doc(db, 'userProfiles', user.uid), {
        role: newRole,
        roles: [newRole],
        updatedAt: new Date().toISOString()
      });
      toast({
        title: "Role Updated",
        description: `Your role is now ${newRole}. Please refresh or navigate to see changes.`
      });
      // Force a slight delay to allow Firestore to propagate
      setTimeout(() => window.location.reload(), 500);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Update Failed", description: e.message });
    } finally {
      setLoading(false);
    }
  };

  const handleSeed = async () => {
    setLoading(true);
    try {
      // 0. Ensure current user is Admin FIRST so all subsequent writes succeed
      if (user) {
        await setDoc(doc(db, 'userProfiles', user.uid), {
          role: 'Admin',
          roles: ['Admin'],
          updatedAt: new Date().toISOString()
        }, { merge: true });
      }

      // 1. Seed Seasons & Divisions
      const seasonId = 'spring-2026';
      await setDoc(doc(db, 'seasons', seasonId), {
        id: seasonId,
        name: 'Spring 2026',
        registrationOpen: '2026-01-15',
        registrationClose: '2026-03-31',
      });

      const divisions = [
        { id: 'tball', name: 'T-Ball', fee: 5000 },
        { id: 'coach-pitch', name: 'Coach Pitch', fee: 7500 },
        { id: 'kid-pitch', name: 'Kid Pitch', fee: 10000 },
      ];

      for (const div of divisions) {
        await setDoc(doc(db, 'seasons', seasonId, 'divisions', div.id), div);
      }

      // 2. Seed Sample Users
      const demoCoachUid = assignMeAsCoach && user ? user.uid : 'demo-coach-uid';
      const demoCoach2Uid = 'demo-coach-2-uid';
      const demoParentUid = 'demo-parent-uid';
      const demoParent2Uid = 'demo-parent-2-uid';

      if (!assignMeAsCoach || !user) {
        await setDoc(doc(db, 'userProfiles', 'demo-coach-uid'), {
          id: 'demo-coach-uid',
          displayName: 'Coach Mike Russo',
          email: 'mrusso@example.com',
          role: 'Coach',
          createdAt: new Date().toISOString()
        });
      }

      await setDoc(doc(db, 'userProfiles', demoCoach2Uid), {
        id: demoCoach2Uid,
        displayName: 'Coach Dave Kelley',
        email: 'dkelley@example.com',
        role: 'Coach',
        createdAt: new Date().toISOString()
      });

      await setDoc(doc(db, 'userProfiles', demoParentUid), {
        id: demoParentUid,
        displayName: 'Sarah Mitchell',
        email: 'smitchell@example.com',
        phoneNumber: '(724) 555-0123',
        role: 'Parent',
        shareContactInfo: true,
        createdAt: new Date().toISOString()
      });

      await setDoc(doc(db, 'userProfiles', demoParent2Uid), {
        id: demoParent2Uid,
        displayName: 'Tom Graziano',
        email: 'tgraziano@example.com',
        phoneNumber: '(724) 555-0456',
        role: 'Parent',
        shareContactInfo: true,
        createdAt: new Date().toISOString()
      });

      // 3. Seed Teams — one per division with Sharpsville-style names
      const teamTBall = 'blue-jays-spring-2026';
      const teamCoachPitch = 'cardinals-spring-2026';
      const teamKidPitch = 'tigers-spring-2026';

      const player1 = 'player-1';
      const player2 = 'player-2';
      const player3 = 'player-3';
      const myPlayerId = 'my-player-1';

      const firstName = profile?.displayName?.split(' ')[0] || 'Your Child';

      await setDoc(doc(db, 'teams', teamTBall), {
        id: teamTBall,
        name: 'Blue Jays',
        seasonId,
        divisionId: 'tball',
        coach_uid: demoCoachUid,
        player_ids: [player1, player2, myPlayerId],
        createdAt: new Date().toISOString()
      });

      await setDoc(doc(db, 'teams', teamCoachPitch), {
        id: teamCoachPitch,
        name: 'Cardinals',
        seasonId,
        divisionId: 'coach-pitch',
        coach_uid: demoCoach2Uid,
        player_ids: [player3],
        createdAt: new Date().toISOString()
      });

      await setDoc(doc(db, 'teams', teamKidPitch), {
        id: teamKidPitch,
        name: 'Tigers',
        seasonId,
        divisionId: 'kid-pitch',
        coach_uid: demoCoachUid,
        player_ids: [],
        createdAt: new Date().toISOString()
      });

      // 4. Seed Demo Players & Enrollments
      await setDoc(doc(db, 'userProfiles', demoParentUid, 'players', player1), {
        id: player1,
        firstName: 'Owen',
        lastName: 'Mitchell',
        dateOfBirth: '2019-04-12',
        parentUserId: demoParentUid,
        medicalNotes: '',
        ageVerified: true,
        emergencyContacts: [
          { name: 'Brian Mitchell', phone: '(724) 555-0124', relationship: 'Father' }
        ]
      });

      await setDoc(doc(db, 'userProfiles', demoParentUid, 'enrollments', 'enroll-1'), {
        id: 'enroll-1',
        playerId: player1,
        seasonId,
        divisionId: 'tball',
        parentUserId: demoParentUid,
        paymentStatus: 'paid',
        teamId: teamTBall,
        jerseySize: 'Youth S',
        jerseyNumber: '7'
      });

      await setDoc(doc(db, 'userProfiles', demoParent2Uid, 'players', player2), {
        id: player2,
        firstName: 'Lena',
        lastName: 'Graziano',
        dateOfBirth: '2020-06-30',
        parentUserId: demoParent2Uid,
        medicalNotes: 'Asthma — inhaler in bag',
        ageVerified: false,
        birthCertificateUrl: 'https://placehold.co/1/1/png',
        emergencyContacts: [
          { name: 'Tom Graziano', phone: '(724) 555-0456', relationship: 'Father' }
        ]
      });

      await setDoc(doc(db, 'userProfiles', demoParent2Uid, 'enrollments', 'enroll-2'), {
        id: 'enroll-2',
        playerId: player2,
        seasonId,
        divisionId: 'tball',
        parentUserId: demoParent2Uid,
        paymentStatus: 'paid',
        teamId: teamTBall,
        jerseySize: 'Youth XS',
        jerseyNumber: '12'
      });

      await setDoc(doc(db, 'userProfiles', demoParent2Uid, 'players', player3), {
        id: player3,
        firstName: 'Marco',
        lastName: 'Graziano',
        dateOfBirth: '2017-09-05',
        parentUserId: demoParent2Uid,
        medicalNotes: '',
        ageVerified: true,
        emergencyContacts: [
          { name: 'Tom Graziano', phone: '(724) 555-0456', relationship: 'Father' }
        ]
      });

      await setDoc(doc(db, 'userProfiles', demoParent2Uid, 'enrollments', 'enroll-3'), {
        id: 'enroll-3',
        playerId: player3,
        seasonId,
        divisionId: 'coach-pitch',
        parentUserId: demoParent2Uid,
        paymentStatus: 'paid',
        teamId: teamCoachPitch,
        jerseySize: 'Youth M',
        jerseyNumber: '5'
      });

      // 5. Seed logged-in user's own player + enrollment (for Parent role experience)
      if (user) {
        await setDoc(doc(db, 'userProfiles', user.uid, 'players', myPlayerId), {
          id: myPlayerId,
          firstName,
          lastName: 'Demo',
          dateOfBirth: '2018-05-15',
          parentUserId: user.uid,
          medicalNotes: '',
          ageVerified: true,
          emergencyContacts: []
        });

        await setDoc(doc(db, 'userProfiles', user.uid, 'enrollments', 'my-enroll-1'), {
          id: 'my-enroll-1',
          playerId: myPlayerId,
          seasonId,
          divisionId: 'tball',
          parentUserId: user.uid,
          paymentStatus: 'paid',
          teamId: teamTBall,
          jerseySize: 'Youth S',
          jerseyNumber: '10'
        });
      }

      // 6. Seed clearances for demo coaches
      const clearanceTypes = ['ChildAbuse', 'CriminalRecord', 'FBI'];
      for (const type of clearanceTypes) {
        await setDoc(doc(db, 'userProfiles', demoCoach2Uid, 'clearances', type.toLowerCase()), {
          id: type.toLowerCase(),
          type,
          userId: demoCoach2Uid,
          status: 'Approved',
          fileUrl: 'https://placehold.co/1/1/png',
          expirationDate: '2027-01-01',
          verifiedByName: 'Admin',
          verifiedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        });
      }
      // Demo coach 1 has one pending clearance
      await setDoc(doc(db, 'userProfiles', demoCoachUid, 'clearances', 'childabuse'), {
        id: 'childabuse',
        type: 'ChildAbuse',
        userId: demoCoachUid,
        status: 'Approved',
        fileUrl: 'https://placehold.co/1/1/png',
        expirationDate: '2027-01-01',
        createdAt: new Date().toISOString(),
      });
      await setDoc(doc(db, 'userProfiles', demoCoachUid, 'clearances', 'criminalrecord'), {
        id: 'criminalrecord',
        type: 'CriminalRecord',
        userId: demoCoachUid,
        status: 'Pending',
        fileUrl: 'https://placehold.co/1/1/png',
        expirationDate: '2027-01-01',
        createdAt: new Date().toISOString(),
      });

      // 7. Seed sample schedule events
      const today = new Date();
      const fmt = (d: Date) => d.toISOString().split('T')[0];
      const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

      await setDoc(doc(db, 'teams', teamTBall, 'games', 'game-1'), {
        id: 'game-1',
        title: 'Blue Jays vs. Cardinals',
        opponentName: 'Cardinals',
        type: 'Game',
        teamId: teamTBall,
        seasonId,
        dateTime: fmt(addDays(today, 5)) + 'T10:00:00Z',
        location: 'Sharpsville Community Park — Field 1',
        notes: 'Home game. Parents please arrive 15 minutes early.',
        createdAt: new Date().toISOString()
      });

      await setDoc(doc(db, 'teams', teamTBall, 'games', 'practice-1'), {
        id: 'practice-1',
        title: 'Blue Jays Practice',
        type: 'Practice',
        teamId: teamTBall,
        seasonId,
        dateTime: fmt(addDays(today, 2)) + 'T17:30:00Z',
        location: 'Sharpsville Community Park — Field 2',
        notes: 'Bring water and gloves.',
        createdAt: new Date().toISOString()
      });

      await setDoc(doc(db, 'teams', teamKidPitch, 'games', 'game-2'), {
        id: 'game-2',
        title: 'Tigers vs. Riverside',
        opponentName: 'Riverside',
        type: 'Game',
        teamId: teamKidPitch,
        seasonId,
        dateTime: fmt(addDays(today, 7)) + 'T13:00:00Z',
        location: 'Sharpsville Community Park — Field 1',
        notes: 'Away uniforms.',
        createdAt: new Date().toISOString()
      });

      // 8. Seed announcements
      const nowIso = new Date().toISOString();
      const yesterdayIso = addDays(today, -1).toISOString();

      await setDoc(doc(db, 'announcements', 'ann-1'), {
        id: 'ann-1',
        title: 'Spring 2026 Season Kickoff!',
        body: 'We are thrilled to officially open the Spring 2026 SYBA season! Registration is open through March 31st. All returning and new players are welcome. Practice schedules will be posted by April 1st. Go Blue Jays, Cardinals, and Tigers!',
        pinned: true,
        publishedAt: nowIso,
        createdAt: nowIso,
        publishedBy: 'SYBA Board',
      });

      await setDoc(doc(db, 'announcements', 'ann-2'), {
        id: 'ann-2',
        title: 'Concession Volunteer Sign-Ups Open',
        body: 'We need parent volunteers to staff the concession stand for home games. Sign up through the Concessions tab in the portal. Each shift is 4 hours and earns a $10 concession credit. Thank you for your support!',
        pinned: false,
        publishedAt: yesterdayIso,
        createdAt: yesterdayIso,
        publishedBy: 'SYBA Board',
      });

      // 9. Seed fields
      await setDoc(doc(db, 'fields', 'field-1'), {
        id: 'field-1',
        name: 'Field 1 — Sharpsville Community Park',
        address: '100 Community Dr, Sharpsville PA',
        availabilityStart: '08:00',
        availabilityEnd: '21:00',
        maintenanceClosures: [],
        createdAt: nowIso,
      });

      await setDoc(doc(db, 'fields', 'field-2'), {
        id: 'field-2',
        name: 'Field 2 — Sharpsville Community Park',
        address: '100 Community Dr, Sharpsville PA',
        availabilityStart: '08:00',
        availabilityEnd: '21:00',
        maintenanceClosures: [],
        createdAt: nowIso,
      });

      await setDoc(doc(db, 'fields', 'field-3'), {
        id: 'field-3',
        name: 'Buhl Farm Diamond',
        address: '11 Buhl Farm Dr, Hermitage PA',
        availabilityStart: '08:00',
        availabilityEnd: '20:00',
        maintenanceClosures: [],
        createdAt: nowIso,
      });

      // 10. Seed concession slots
      await setDoc(doc(db, 'concessionSlots', 'slot-1'), {
        id: 'slot-1',
        gameDate: fmt(addDays(today, 5)),
        startTime: '09:00',
        endTime: '13:00',
        capacity: 2,
        cancelCutoffHours: 24,
        description: 'Blue Jays home game vs. Cardinals',
        signups: [],
        createdAt: nowIso,
      });

      await setDoc(doc(db, 'concessionSlots', 'slot-2'), {
        id: 'slot-2',
        gameDate: fmt(addDays(today, 7)),
        startTime: '12:00',
        endTime: '16:00',
        capacity: 2,
        cancelCutoffHours: 24,
        description: 'Tigers game vs. Riverside',
        signups: [],
        createdAt: nowIso,
      });

      // 11. Seed board meeting
      await setDoc(doc(db, 'boardMeetings', 'meeting-1'), {
        id: 'meeting-1',
        title: 'Spring 2026 Pre-Season Board Meeting',
        date: fmt(addDays(today, 10)),
        time: '19:00',
        location: 'Sharpsville Borough Hall',
        agenda: [
          { text: 'Field prep and maintenance review', addedBy: 'Board' },
          { text: 'Umpire assignments for opening weekend', addedBy: 'Board' },
          { text: 'Fundraising — concession schedule', addedBy: 'Board' },
        ],
        rsvps: [],
        minutes: '',
        createdAt: nowIso,
      });

      // 12. Update current user role at end (Admin by default, Coach only if checkbox checked)
      if (user) {
        if (assignMeAsCoach) {
          await updateDoc(doc(db, 'userProfiles', user.uid), {
            role: 'Coach',
            roles: ['Coach'],
            updatedAt: new Date().toISOString()
          });
        }
        // If not assignMeAsCoach, user stays as Admin (already set in step 0)
      }

      toast({ title: "Seed Successful", description: `Spring 2026 SYBA data initialized. ${assignMeAsCoach ? 'Your role has been updated to Coach.' : 'You remain as Admin.'}` });
      setDone(true);
      if (assignMeAsCoach) {
        setTimeout(() => window.location.reload(), 1000);
      }
    } catch (e: any) {
      toast({ variant: "destructive", title: "Seed Failed", description: e.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold font-headline">POC Management Utilities</h1>
          <p className="text-muted-foreground">Tools to initialize data and switch between roles for testing.</p>
        </header>

        <div className="grid gap-8 md:grid-cols-2">
          <Card className="border-none shadow-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5 text-primary" />
                Initialize Environment
              </CardTitle>
              <CardDescription>Setup seasons, teams, fields, announcements, and sample enrollments.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-xl flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-yellow-600 shrink-0 mt-0.5" />
                <p className="text-xs text-yellow-700">
                  This utility is for testing purposes. It will overwrite sample data if it already exists.
                </p>
              </div>

              <div className="flex items-center space-x-2 p-4 bg-secondary/20 rounded-xl border">
                <Checkbox
                  id="assignMe"
                  checked={assignMeAsCoach}
                  onCheckedChange={(checked) => setAssignMeAsCoach(!!checked)}
                />
                <div className="grid gap-1.5 leading-none">
                  <Label htmlFor="assignMe" className="text-sm font-bold flex items-center gap-2">
                    <UserCheck className="h-4 w-4 text-primary" /> Assign Me as Demo Coach
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Check to switch your role to Coach after seeding. Leave unchecked to stay as Admin.
                  </p>
                </div>
              </div>

              {done ? (
                <div className="space-y-3">
                  <div className="bg-green-100 text-green-700 p-4 rounded-xl flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 shrink-0" />
                    <span className="text-sm font-medium">Data successfully seeded!</span>
                  </div>
                  <div className="space-y-2 px-1">
                    {[
                      'Season: Spring 2026 (3 divisions)',
                      'Teams: Blue Jays, Cardinals, Tigers',
                      'Your player added to Blue Jays (T-Ball)',
                      'Games & practices (3 events)',
                      'Announcements (2)',
                      'Fields (3)',
                      'Concession slots (2)',
                      'Board meeting (1)',
                      'Clearances for demo coaches',
                    ].map((item) => (
                      <div key={item} className="flex items-center gap-2 text-xs text-green-700">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <Button onClick={handleSeed} className="w-full h-12 rounded-xl text-lg font-bold" disabled={loading}>
                  {loading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Database className="mr-2 h-5 w-5" />}
                  Seed POC Data
                </Button>
              )}
            </CardContent>
          </Card>

          <Card className="border-none shadow-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                Role Switcher
              </CardTitle>
              <CardDescription>Instantly switch your account's role to test different dashboards.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 rounded-xl border bg-primary/5 space-y-4">
                <p className="text-sm text-muted-foreground">Current Role: <span className="font-bold text-primary">{profile?.role || 'Loading...'}</span></p>

                <div className="grid grid-cols-1 gap-3">
                  <Button
                    variant={profile?.role === 'Admin' ? 'default' : 'outline'}
                    className="justify-start h-12 rounded-xl"
                    onClick={() => handleRoleSwitch('Admin')}
                    disabled={loading}
                  >
                    <ShieldCheck className="mr-2 h-5 w-5" /> Switch to Admin
                  </Button>
                  <Button
                    variant={profile?.role === 'Coach' ? 'default' : 'outline'}
                    className="justify-start h-12 rounded-xl"
                    onClick={() => handleRoleSwitch('Coach')}
                    disabled={loading}
                  >
                    <UserCheck className="mr-2 h-5 w-5" /> Switch to Coach
                  </Button>
                  <Button
                    variant={profile?.role === 'Parent' ? 'default' : 'outline'}
                    className="justify-start h-12 rounded-xl"
                    onClick={() => handleRoleSwitch('Parent')}
                    disabled={loading}
                  >
                    <UserIcon className="mr-2 h-5 w-5" /> Switch to Parent
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
