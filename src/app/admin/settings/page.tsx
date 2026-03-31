"use client";

import { useState, useEffect, useMemo } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useUser, useFirestore, useCollection, useMemoFirebase, useAuth } from '@/firebase';
import { collection, doc, setDoc, deleteDoc, query, orderBy, where } from 'firebase/firestore';
import { useSport } from '@/firebase/sport-context';
import { Settings, Save, Bell, CreditCard, Lock, Loader2, Users, Check, Wrench } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { INQUIRY_TOPICS } from '@/data/inquiry-topics';
import type { InquiryTopic } from '@/data/inquiry-topics';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MaintenanceCard } from '@/components/admin/MaintenanceCard';
import { clearUserNotifications } from '@/lib/maintenance-actions';
import type { LeagueOfficer } from '@/types/scheduling';
import { EXECUTIVE_TITLES } from '@/data/officers';

type OfficerRecord = LeagueOfficer;

function OfficerRow({ officer, holderName, onSave }: {
  officer: OfficerRecord;
  holderName: string | null;
  onSave: (id: string, name: string | null, email: string, hint: string, mappedTopic: string) => Promise<void>;
}) {
  const [email, setEmail] = useState(officer.email ?? '');
  const [hint, setHint] = useState(officer.contactHint ?? '');
  const [mappedTopic, setMappedTopic] = useState(officer.mappedTopic ?? 'general');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setEmail(officer.email ?? '');
    setHint(officer.contactHint ?? '');
    setMappedTopic(officer.mappedTopic ?? 'general');
  }, [officer.email, officer.contactHint, officer.mappedTopic]);

  const handleSave = async () => {
    setSaving(true);
    await onSave(officer.id, holderName, email, hint, mappedTopic);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const dirty =
    email !== (officer.email ?? '') ||
    hint !== (officer.contactHint ?? '') ||
    mappedTopic !== (officer.mappedTopic ?? 'general');

  return (
    <div className="border rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="font-semibold text-sm">{officer.title}</p>
          {(!holderName || holderName.trim() === '') && (
            <span className="text-xs text-muted-foreground border rounded px-1.5 py-0.5">Hidden from public</span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{holderName ?? 'TBA'}</span>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Email</Label>
          <Input
            placeholder="e.g. president@syba.blue"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={120}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Routes inbound email to topic</Label>
          <Select value={mappedTopic} onValueChange={(v) => setMappedTopic(v as InquiryTopic)}>
            <SelectTrigger className="rounded-xl text-xs h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INQUIRY_TOPICS.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Contact hint shown to public</Label>
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
  const { isAdmin, isSiteAdmin } = useUser();
  const { activeSport } = useSport();
  const db = useFirestore();
  const auth = useAuth();
  const { toast } = useToast();

  const [notifEmail, setNotifEmail] = useState('');

  // Executives only — scoped to the active sport
  const officersQuery = useMemoFirebase(() => {
    if (!db || !activeSport) return null;
    return query(collection(db, 'officers'), where('sport', '==', activeSport), orderBy('order'));
  }, [db, activeSport]);

  const usersQuery = useMemoFirebase(() => {
    if (!db) return null;
    return collection(db, 'userProfiles');
  }, [db]);

  const { data: officers, isLoading } = useCollection<OfficerRecord>(officersQuery);
  const { data: allUsers } = useCollection<{
    id: string;
    displayName: string | null;
    officerTitles?: string[];
    roles?: string[];
    sportRoles?: Record<string, string[]>;
  }>(usersQuery);

  // 4 executive rows — merge expected titles with any saved Firestore records
  const mergedOfficers = useMemo<OfficerRecord[]>(() => {
    if (!activeSport) return [];
    return (EXECUTIVE_TITLES as readonly string[]).map((title, idx) => {
      const existing = officers?.find(o => o.title === title);
      if (existing) return existing;
      return {
        id: `${activeSport}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        title,
        name: null,
        email: null,
        contactHint: '',
        mappedTopic: 'general' as InquiryTopic,
        order: idx,
        sport: activeSport,
      } as OfficerRecord;
    });
  }, [activeSport, officers]);

  // At-large members — board members for this sport who don't hold an executive title
  const atLargeMembers = useMemo(() => {
    if (!allUsers || !activeSport) return [];
    return allUsers.filter(u => {
      const sportRoleList = u.sportRoles?.[activeSport] ?? [];
      const isBoardMember =
        sportRoleList.some(r => r === 'Board Member' || r === 'Admin') ||
        u.roles?.includes('Board Member');
      if (!isBoardMember) return false;
      return !(u.officerTitles ?? []).some(t => EXECUTIVE_TITLES.includes(t));
    });
  }, [allUsers, activeSport]);

  // Auto-sync at-large members to the officers collection so the public
  // homepage can read them without requiring authentication.
  useEffect(() => {
    if (!db || !activeSport || !allUsers || officers === null) return;

    const derivedIds = new Set(atLargeMembers.map(u => `${activeSport}-at-large-${u.id}`));
    const existingAtLarge = officers.filter(o => o.title === 'At-Large Board Member');
    const existingMap = new Map(existingAtLarge.map(o => [o.id, o.name]));

    const needsAdd = atLargeMembers.filter(u => {
      const id = `${activeSport}-at-large-${u.id}`;
      return !existingMap.has(id) || existingMap.get(id) !== (u.displayName ?? null);
    });
    const needsRemove = existingAtLarge.filter(o => !derivedIds.has(o.id));

    if (needsAdd.length === 0 && needsRemove.length === 0) return;

    (async () => {
      for (const u of needsAdd) {
        await setDoc(
          doc(db, 'officers', `${activeSport}-at-large-${u.id}`),
          { title: 'At-Large Board Member', name: u.displayName ?? null, sport: activeSport, order: 100 },
          { merge: true }
        );
      }
      for (const o of needsRemove) {
        await deleteDoc(doc(db, 'officers', o.id));
      }
    })();
  }, [db, activeSport, allUsers, officers, atLargeMembers]);

  function getHolderName(title: string): string | null {
    const holders = allUsers?.filter(u => u.officerTitles?.includes(title)) ?? [];
    return holders.length ? holders.map(u => u.displayName).filter(Boolean).join(', ') : null;
  }

  const handleSave = async (id: string, name: string | null, email: string, hint: string, mappedTopic: string) => {
    if (!db || !activeSport) return;
    try {
      await setDoc(
        doc(db, 'officers', id),
        { name: name || null, email: email.trim() || null, contactHint: hint.trim(), mappedTopic: mappedTopic || 'general', sport: activeSport },
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
                  {!activeSport ? (
                    <div className="flex justify-center py-10">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {isLoading && (
                        <p className="text-xs text-muted-foreground pb-1">Loading saved data…</p>
                      )}
                      {mergedOfficers.map((officer) => (
                        <OfficerRow key={officer.id} officer={officer} holderName={getHolderName(officer.title)} onSave={handleSave} />
                      ))}

                      {/* At-large board members — auto-derived from user accounts */}
                      {atLargeMembers.length > 0 && (
                        <>
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest pt-2">
                            At-Large Board Members
                          </p>
                          <p className="text-xs text-muted-foreground -mt-1">
                            Automatically derived from board member accounts without a specific officer title.
                          </p>
                          <div className="flex flex-wrap gap-2 pt-1">
                            {atLargeMembers.map(u => (
                              <span key={u.id} className="text-xs border rounded px-2 py-1 bg-muted/40">
                                {u.displayName ?? 'Unnamed'}
                              </span>
                            ))}
                          </div>
                        </>
                      )}
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
