
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
  const { user, profile } = useUser();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [assignMeAsCoach, setAssignMeAsCoach] = useState(true);

  const handleRoleSwitch = async (newRole: 'Admin' | 'Coach' | 'Parent') => {
    if (!user || !db) return;
    setLoading(true);
    try {
      await updateDoc(doc(db, 'userProfiles', user.uid), {
        role: newRole,
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

      // Update current user to Coach if requested
      if (assignMeAsCoach && user) {
        await setDoc(doc(db, 'userProfiles', user.uid), {
          role: 'Coach',
          updatedAt: new Date().toISOString()
        }, { merge: true });
      } else {
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

      await setDoc(doc(db, 'teams', teamTBall), {
        id: teamTBall,
        name: 'Blue Jays',
        seasonId,
        divisionId: 'tball',
        coach_uid: demoCoachUid,
        player_ids: [player1, player2],
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

      // 4. Seed Players & Enrollments
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

      // 5. Seed clearances for demo coach
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

      // 6. Seed sample schedule events
      const today = new Date();
      const fmt = (d: Date) => d.toISOString().split('T')[0];
      const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

      await setDoc(doc(db, 'schedules', 'game-1'), {
        id: 'game-1',
        title: 'Blue Jays vs. Cardinals',
        type: 'Game',
        teamId: teamTBall,
        seasonId,
        date: fmt(addDays(today, 5)),
        time: '10:00 AM',
        location: 'Sharpsville Community Park — Field 1',
        notes: 'Home game. Parents please arrive 15 minutes early.',
        createdAt: new Date().toISOString()
      });

      await setDoc(doc(db, 'schedules', 'practice-1'), {
        id: 'practice-1',
        title: 'Blue Jays Practice',
        type: 'Practice',
        teamId: teamTBall,
        seasonId,
        date: fmt(addDays(today, 2)),
        time: '5:30 PM',
        location: 'Sharpsville Community Park — Field 2',
        notes: 'Bring water and gloves.',
        createdAt: new Date().toISOString()
      });

      await setDoc(doc(db, 'schedules', 'game-2'), {
        id: 'game-2',
        title: 'Tigers vs. Riverside',
        type: 'Game',
        teamId: teamKidPitch,
        seasonId,
        date: fmt(addDays(today, 7)),
        time: '1:00 PM',
        location: 'Sharpsville Community Park — Field 1',
        notes: 'Away uniforms.',
        createdAt: new Date().toISOString()
      });

      toast({ title: "Seed Successful", description: `Spring 2026 SYBA data initialized. ${assignMeAsCoach ? 'Your role has been updated to Coach.' : ''}` });
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
      <Sidebar role={profile?.role.toLowerCase() as any || 'parent'} />
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
              <CardDescription>Setup seasons, teams, and sample enrollments.</CardDescription>
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
                    Your profile role will be changed to Coach for testing rosters.
                  </p>
                </div>
              </div>
              
              {done ? (
                <div className="bg-green-100 text-green-700 p-4 rounded-xl flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="text-sm font-medium">Data successfully seeded!</span>
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
                    <Loader2 className="mr-2 h-5 w-5" /> Switch to Coach
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
