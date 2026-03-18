"use client";

import { useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useFirestore } from '@/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { Loader2, Database, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function SeedPage() {
  const db = useFirestore();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

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

      // 2. Seed Teams
      const teams = [
        { 
          id: 'blue-jays-spring-2024', 
          name: 'Blue Jays', 
          seasonId, 
          divisionId: 'tball', 
          coach_uid: 'demo-coach-uid', 
          player_ids: [],
          createdAt: new Date().toISOString()
        },
        { 
          id: 'tigers-spring-2024', 
          name: 'Tigers', 
          seasonId, 
          divisionId: 'minors', 
          coach_uid: 'demo-coach-uid', 
          player_ids: [],
          createdAt: new Date().toISOString()
        },
      ];

      for (const team of teams) {
        await setDoc(doc(db, 'teams', team.id), team);
      }

      toast({ title: "Seed Successful", description: "POC data has been initialized." });
      setDone(true);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Seed Failed", description: e.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar role="admin" />
      <main className="flex-1 ml-64 p-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold font-headline">POC Data Seeding</h1>
          <p className="text-muted-foreground">Initialize the database with sample data to test league registration and roster management.</p>
        </header>

        <Card className="max-w-md border-none shadow-xl">
          <CardHeader>
            <CardTitle>Initialize Environment</CardTitle>
            <CardDescription>This will create the "Spring 2024" season and sample teams.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-xl flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-yellow-600 shrink-0 mt-0.5" />
              <p className="text-xs text-yellow-700">
                This utility is for testing purposes. It will overwrite the "Spring 2024" configuration if it already exists.
              </p>
            </div>
            
            {done ? (
              <div className="bg-green-100 text-green-700 p-4 rounded-xl flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5" />
                <span className="text-sm font-medium">Data successfully seeded! You can now test Parent enrollment.</span>
              </div>
            ) : (
              <Button onClick={handleSeed} className="w-full h-12 rounded-xl" disabled={loading}>
                {loading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Database className="mr-2 h-5 w-5" />}
                Seed POC Data
              </Button>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
