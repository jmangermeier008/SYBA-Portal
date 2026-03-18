"use client";

import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useFirestore, useCollection } from '@/firebase';
import { useMemoFirebase } from '@/firebase/provider';
import { use } from 'react';
import { collection } from 'firebase/firestore';
import { ShieldCheck, Users, Trophy, Settings, Activity, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default function AdminDashboard({
  params,
  searchParams,
}: {
  params: Promise<any>;
  searchParams: Promise<any>;
}) {
  // Destructure and unwrap dynamic props for Next.js 15 compliance
  use(params);
  use(searchParams);

  const db = useFirestore();

  const usersQuery = useMemoFirebase(() => collection(db, 'userProfiles'), [db]);
  const seasonsQuery = useMemoFirebase(() => collection(db, 'seasons'), [db]);

  const { data: users } = useCollection(usersQuery);
  const { data: seasons } = useCollection(seasonsQuery);

  const stats = [
    { label: 'Total Users', value: users?.length || 0, icon: Users, color: 'text-blue-600', bg: 'bg-blue-100' },
    { label: 'Active Seasons', value: seasons?.length || 0, icon: Trophy, color: 'text-yellow-600', bg: 'bg-yellow-100' },
    { label: 'System Status', value: 'Healthy', icon: Activity, color: 'text-green-600', bg: 'bg-green-100' },
    { label: 'Security Level', value: 'High', icon: ShieldCheck, color: 'text-red-600', bg: 'bg-red-100' },
  ];

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar role="admin" />
      <main className="flex-1 ml-64 p-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold font-headline">Admin Control Center</h1>
          <p className="text-muted-foreground">Global system management and oversight for SYBA.</p>
        </header>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-8">
          {stats.map((stat, i) => (
            <Card key={i} className="border-none shadow-md">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{stat.label}</CardTitle>
                <div className={`${stat.bg} p-2 rounded-lg`}>
                  <stat.icon className={`h-4 w-4 ${stat.color}`} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card className="border-none shadow-md">
            <CardHeader>
              <CardTitle className="font-headline">Quick Management</CardTitle>
              <CardDescription>Essential administrative tasks</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button className="w-full justify-between h-auto py-4 rounded-xl" variant="outline" asChild>
                <Link href="/admin/roles">
                  <div className="flex items-center gap-3">
                    <ShieldCheck className="h-5 w-5 text-primary" />
                    <div className="text-left">
                      <p className="font-semibold">User Access Control</p>
                      <p className="text-xs text-muted-foreground">Manage permissions and roles</p>
                    </div>
                  </div>
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              </Button>
              <Button className="w-full justify-between h-auto py-4 rounded-xl" variant="outline" asChild>
                <Link href="/admin/seasons">
                  <div className="flex items-center gap-3">
                    <Trophy className="h-5 w-5 text-primary" />
                    <div className="text-left">
                      <p className="font-semibold">Season Configuration</p>
                      <p className="text-xs text-muted-foreground">Setup registrations and divisions</p>
                    </div>
                  </div>
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              </Button>
              <Button className="w-full justify-between h-auto py-4 rounded-xl" variant="outline" asChild>
                <Link href="/admin/settings">
                  <div className="flex items-center gap-3">
                    <Settings className="h-5 w-5 text-primary" />
                    <div className="text-left">
                      <p className="font-semibold">Global Settings</p>
                      <p className="text-xs text-muted-foreground">Configure system-wide parameters</p>
                    </div>
                  </div>
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="border-none shadow-md">
            <CardHeader>
              <CardTitle className="font-headline">System Logs</CardTitle>
              <CardDescription>Recent administrative activity</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[
                  { user: 'Admin', action: 'Updated user role for John Doe', time: '2 mins ago' },
                  { user: 'System', action: 'Spring 2024 Season Created', time: '1 hour ago' },
                  { user: 'Admin', action: 'Modified Major League Fee', time: '3 hours ago' },
                ].map((log, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-secondary/20">
                    <div>
                      <p className="text-sm font-medium">{log.action}</p>
                      <p className="text-xs text-muted-foreground">By {log.user}</p>
                    </div>
                    <span className="text-[10px] text-muted-foreground font-mono">{log.time}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
