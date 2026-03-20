"use client";

import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dumbbell } from 'lucide-react';

export default function DrillsPage() {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar role="coach" />
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold font-headline">Practice Drills</h1>
          <p className="text-muted-foreground">Drill resources for your team.</p>
        </header>

        <Card className="border-none shadow-md max-w-lg">
          <CardHeader className="flex flex-row items-center gap-4 pb-2">
            <div className="bg-primary/10 p-3 rounded-xl">
              <Dumbbell className="h-6 w-6 text-primary" />
            </div>
            <div>
              <CardTitle className="font-headline">Coming Soon</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Practice drill resources will be available here. Check back after the season kicks off.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
