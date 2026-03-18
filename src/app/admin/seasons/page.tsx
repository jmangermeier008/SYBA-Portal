"use client";

import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, Trophy, Calendar } from 'lucide-react';

export default function SeasonsAdminPage() {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar role="admin" />
      <main className="flex-1 ml-64 p-8">
        <header className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold font-headline">Season Management</h1>
            <p className="text-muted-foreground">Define seasons, registration periods, and division fees.</p>
          </div>
          <Button className="rounded-full shadow-lg shadow-primary/20">
            <Plus className="mr-2 h-4 w-4" /> Create Season
          </Button>
        </header>

        <div className="grid gap-6">
          <Card className="border-none shadow-md overflow-hidden">
            <CardHeader className="bg-primary/5 border-b">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                    <Trophy className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Spring 2024 Season</CardTitle>
                    <CardDescription>Registration: Jan 1 - Mar 15</CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                    Active
                  </span>
                  <Button variant="ghost" size="sm">Edit</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="grid grid-cols-4 border-b divide-x">
                <div className="p-4 text-center">
                  <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider mb-1">T-Ball</p>
                  <p className="text-lg font-bold text-primary">$50.00</p>
                </div>
                <div className="p-4 text-center">
                  <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider mb-1">Coach Pitch</p>
                  <p className="text-lg font-bold text-primary">$75.00</p>
                </div>
                <div className="p-4 text-center">
                  <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider mb-1">Minors</p>
                  <p className="text-lg font-bold text-primary">$100.00</p>
                </div>
                <div className="p-4 text-center">
                  <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider mb-1">Majors</p>
                  <p className="text-lg font-bold text-primary">$125.00</p>
                </div>
              </div>
              <div className="p-4 bg-secondary/10 flex items-center gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" /> Start: Apr 1, 2024
                </div>
                <div className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" /> End: Jun 30, 2024
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
