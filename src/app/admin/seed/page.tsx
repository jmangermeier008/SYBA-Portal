
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
      const seasonId = 'spring-2024';
      await setDoc(doc(db, 'seasons', seasonId), {
        id: seasonId,
        name: 'Spring 2024',
        registrationOpen: '2024-01-01',
        registrationClose: '2024-03-31',
      });

      const divisions = [
        { id: 'tball', name: 'T-Ball', fee: 5000 },
        { id: 'coach-pitch', name: 'Coach Pitch', fee: 7500 },
        { id: 'minors', name: 'Minor League', fee: 10000 },
        { id: 'majors', name: 'Major League', fee: 12500 },
      ];

      for (const div of divisions) {
        await setDoc(doc(db, 'seasons', seasonId, 'divisions', div.id), div);
      }

      // 2. Seed Sample Users
      const demoCoachUid = assignMeAsCoach && user ? user.uid : 'demo-coach-uid';
      const demoParentUid = 'demo-parent-uid';

      // Update current user to Coach if requested
      if (assignMeAsCoach && user) {
        await setDoc(doc(db, 'userProfiles', user.uid), {
          role: 'Coach',
          updatedAt: new Date().toISOString()
        }, { merge: true });
      } else {
        // Seed the default demo coach profile
        await setDoc(doc(db, 'userProfiles', 'demo-coach-uid'), {
          id: 'demo-coach-uid',
          displayName: 'Coach Mike Smith',
          email: 'coach@example.com',
          role: 'Coach',
          createdAt: new Date().toISOString()
        });
      }

      await setDoc(doc(db, 'userProfiles', demoParentUid), {
        id: demoParentUid,
        displayName: 'Jane Doe',
        email: 'parent@example.com',
        phoneNumber: '(555) 123-4567',
        role: 'Parent',
        shareContactInfo: true,
        createdAt: new Date().toISOString()
      });

      // 3. Seed Teams
      const teamId = 'blue-jays-spring-2024';
      const samplePlayerId = 'sample-player-1';

      await setDoc(doc(db, 'teams', teamId), { 
        id: teamId, 
        name: 'Blue Jays', 
        seasonId, 
        divisionId: 'tball', 
        coach_uid: demoCoachUid, 
        player_ids: [samplePlayerId],
        createdAt: new Date().toISOString()
      });

      // 4. Seed Players & Enrollments for the demo parent
      await setDoc(doc(db, 'userProfiles', demoParentUid, 'players', samplePlayerId), {
        id: samplePlayerId,
        firstName: 'Tommy',
        lastName: 'Doe',
        dateOfBirth: '2018-05-15',
        parentUserId: demoParentUid,
        medicalNotes: 'Peanut Allergy',
        ageVerified: true,
        emergencyContacts: [
          { name: 'John Doe', phone: '(555) 987-6543', relationship: 'Father' }
        ]
      });

      await setDoc(doc(db, 'userProfiles', demoParentUid, 'enrollments', 'demo-enroll-1'), {
        id: 'demo-enroll-1',
        playerId: samplePlayerId,
        seasonId,
        divisionId: 'tball',
        parentUserId: demoParentUid,
        paymentStatus: 'paid',
        teamId: teamId,
        jerseySize: 'Youth S',
        jerseyNumber: '10'
      });

      toast({ title: "Seed Successful", description: `POC data initialized. ${assignMeAsCoach ? 'Your role has been updated to Coach.' : ''}` });
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
      <main className="flex-1 ml-64 p-8">
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
