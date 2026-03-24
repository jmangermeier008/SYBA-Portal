"use client";

import { useState, useEffect } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useUser, useFirestore, useCollection, useMemoFirebase, useAuth } from '@/firebase';
import { collection, doc, setDoc, query, orderBy } from 'firebase/firestore';
import { Settings, Save, Bell, CreditCard, Lock, Loader2, Users, Check, Wrench } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { OFFICER_TITLES } from '@/data/officers';
import { MaintenanceCard } from '@/components/admin/MaintenanceCard';
import { clearUserNotifications } from '@/lib/maintenance-actions';

interface OfficerRecord {
  id: string;
  title: string;
  name: string | null;
  email: string | null;
  contactHint: string;
  order: number;
}

// Default seed data matching officers.ts
const DEFAULT_OFFICERS: Omit<OfficerRecord, 'id'>[] = [
  { title: 'President', name: 'John Heutsche', email: null, contactHint: 'Leadership questions', order: 0 },
  { title: 'Vice President', name: 'Tom Roskos', email: null, contactHint: 'Leadership questions', order: 1 },
  { title: 'Treasurer', name: 'Don Nelson', email: null, contactHint: 'Payment questions', order: 2 },
  { title: 'Secretary', name: 'Russ Adkins', email: null, contactHint: 'Registration questions', order: 3 },
  { title: 'Building/Grounds Committee Chair', name: null, email: null, contactHint: 'Field & concession questions', order: 4 },
  { title: 'Competition Committee Chair', name: null, email: null, contactHint: 'Scheduling questions', order: 5 },
  { title: 'Finance Committee Chair', name: null, email: null, contactHint: 'Fundraising questions', order: 6 },
  { title: 'Equipment Coordinator', name: null, email: null, contactHint: 'Uniform & equipment questions', order: 7 },
  { title: 'Umpire Coordinator', name: null, email: null, contactHint: 'Umpire questions', order: 8 },
  { title: 'Tee Ball Coordinator', name: null, email: null, contactHint: 'Tee ball division', order: 9 },
  { title: 'Coach Pitch Coordinator', name: null, email: null, contactHint: 'Coach pitch division', order: 10 },
  { title: 'Kid Pitch Coordinator', name: null, email: null, contactHint: 'Kid pitch division', order: 11 },
  { title: 'Senior Division Coordinator', name: null, email: null, contactHint: 'Senior division', order: 12 },
];

function titleToId(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '');
}

function OfficerRow({ officer, onSave }: { officer: OfficerRecord; onSave: (id: string, name: string, email: string, hint: string) => Promise<void> }) {
  const [name, setName] = useState(officer.name ?? '');
  const [email, setEmail] = useState(officer.email ?? '');
  const [hint, setHint] = useState(officer.contactHint ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setName(officer.name ?? '');
    setEmail(officer.email ?? '');
    setHint(officer.contactHint ?? '');
  }, [officer.name, officer.email, officer.contactHint]);

  const handleSave = async () => {
    setSaving(true);
    await onSave(officer.id, name, email, hint);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const dirty =
    name !== (officer.name ?? '') ||
    email !== (officer.email ?? '') ||
    hint !== (officer.contactHint ?? '');

  return (
    <div className="border rounded-xl p-4 space-y-3">
      <p className="font-semibold text-sm">{officer.title}</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Name</Label>
          <Input
            placeholder="Full name (or leave blank for TBA)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Email (syba.blue address)</Label>
          <Input
            placeholder="e.g. president@syba.blue"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={120}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Contact hint shown to parents</Label>
        <Input
          placeholder="e.g. Payment questions"
          value={hint}
          onChange={(e) => setHint(e.target.value)}
          maxLength={80}
        />
      </div>
      <div className="flex justify-end">
        <Button
          size="sm"
          variant={saved ? 'secondary' : 'default'}
          disabled={!dirty || saving}
          onClick={handleSave}
          className="min-w-24"
        >
          {saving ? (
            <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Saving</>
          ) : saved ? (
            <><Check className="mr-2 h-3.5 w-3.5 text-green-600" /> Saved</>
          ) : (
            <><Save className="mr-2 h-3.5 w-3.5" /> Save</>
          )}
        </Button>
      </div>
    </div>
  );
}

export default function AdminSettingsPage() {
  const { isBoardMember, isAdmin, isSiteAdmin } = useUser();
  const db = useFirestore();
  const auth = useAuth();
  const { toast } = useToast();

  const [notifEmail, setNotifEmail] = useState('');

  const officersQuery = useMemoFirebase(() => {
    if (!db) return null;
    return query(collection(db, 'officers'), orderBy('order'));
  }, [db]);

  const { data: officers, isLoading } = useCollection<OfficerRecord>(officersQuery);

  // Seed Firestore from defaults if the collection is empty
  useEffect(() => {
    if (!db || !isBoardMember || officers == null || officers.length > 0) return;
    const seed = async () => {
      for (const o of DEFAULT_OFFICERS) {
        const id = titleToId(o.title);
        await setDoc(doc(db, 'officers', id), { ...o, id });
      }
    };
    seed().catch(console.error);
  }, [db, isBoardMember, officers]);

  const handleSave = async (id: string, name: string, email: string, hint: string) => {
    if (!db) return;
    try {
      await setDoc(
        doc(db, 'officers', id),
        { name: name.trim() || null, email: email.trim() || null, contactHint: hint.trim() },
        { merge: true }
      );
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Save failed', description: err.message });
    }
  };

  const handleClearNotifications = async () => {
    const token = await auth.currentUser?.getIdToken();
    if (!token) {
      toast({ variant: 'destructive', title: 'Not authenticated', description: 'Please sign in and try again.' });
      return;
    }
    try {
      const { deleted } = await clearUserNotifications(token, notifEmail.trim());
      toast({
        title: 'Notifications cleared',
        description: `Deleted ${deleted} notification${deleted !== 1 ? 's' : ''} for ${notifEmail.trim()}.`,
      });
      setNotifEmail('');
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Action failed', description: err.message });
    }
  };

  const canAccessMaintenance = isAdmin || isSiteAdmin;

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold font-headline flex items-center gap-2">
            <Settings className="h-8 w-8" />
            Settings
          </h1>
          <p className="text-muted-foreground">Manage officer directory and system configuration.</p>
        </header>

        <div className="max-w-4xl">
          <Tabs defaultValue="general">
            <TabsList className="mb-6">
              <TabsTrigger value="general">General</TabsTrigger>
              {canAccessMaintenance && (
                <TabsTrigger value="maintenance" className="flex items-center gap-1.5">
                  <Wrench className="h-3.5 w-3.5" />
                  Maintenance
                </TabsTrigger>
              )}
            </TabsList>

            {/* General Tab */}
            <TabsContent value="general" className="space-y-8">

              {/* Officer Directory */}
              <Card className="border-none shadow-md">
                <CardHeader className="flex flex-row items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                    <Users className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle>Officer Directory</CardTitle>
                    <CardDescription>
                      Names and emails update immediately across the parent portal and public homepage. Leave email blank to hide the mailto link.
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <div className="flex justify-center py-10">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {(officers && officers.length > 0 ? officers : DEFAULT_OFFICERS.map((o, i) => ({ ...o, id: titleToId(o.title) }))).map((officer) => (
                        <OfficerRow key={officer.id} officer={officer as OfficerRecord} onSave={handleSave} />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Notifications (read-only preview) */}
              <Card className="border-none shadow-md opacity-60">
                <CardHeader className="flex flex-row items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                    <Bell className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle>Notifications</CardTitle>
                    <CardDescription>Automated broadcast settings — coming soon</CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Email Alerts</Label>
                      <p className="text-xs text-muted-foreground">Send automated emails for game rainouts</p>
                    </div>
                    <Switch defaultChecked disabled />
                  </div>
                </CardContent>
              </Card>

              {/* Payments (read-only preview) */}
              <Card className="border-none shadow-md opacity-60">
                <CardHeader className="flex flex-row items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                    <CreditCard className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle>Payments</CardTitle>
                    <CardDescription>Stripe integration — coming soon</CardDescription>
                  </div>
                </CardHeader>
              </Card>

              {/* Security (read-only preview) */}
              <Card className="border-none shadow-md opacity-60">
                <CardHeader className="flex flex-row items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center text-red-600">
                    <Lock className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle>Security</CardTitle>
                    <CardDescription>System access rules — coming soon</CardDescription>
                  </div>
                </CardHeader>
              </Card>

            </TabsContent>

            {/* Maintenance Tab — Admin / Site Admin only */}
            {canAccessMaintenance && (
              <TabsContent value="maintenance" className="space-y-6">
                <div>
                  <h2 className="text-lg font-semibold mb-1">Data Maintenance</h2>
                  <p className="text-sm text-muted-foreground">
                    Internal tools for managing test data and system state. All actions are permanent and cannot be undone.
                  </p>
                </div>

                <MaintenanceCard
                  title="Clear User Notifications"
                  description="Permanently delete all notification records for a specific user. Use this to clean up test data or reset a user's notification inbox."
                  inputLabel="User Email"
                  inputPlaceholder="user@example.com"
                  inputValue={notifEmail}
                  onInputChange={setNotifEmail}
                  buttonLabel="Clear Notifications"
                  buttonVariant="destructive"
                  confirmMessage="Warning: This will permanently delete all notifications for this user. This action cannot be undone. Are you sure you want to proceed?"
                  onExecute={handleClearNotifications}
                  disabled={!notifEmail.trim()}
                />
              </TabsContent>
            )}
          </Tabs>
        </div>
      </main>
    </div>
  );
}
