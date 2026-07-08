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
import { collection, doc, setDoc, deleteDoc, query, orderBy, where, writeBatch } from 'firebase/firestore';
import { useSport } from '@/firebase/sport-context';
import { Settings, Save, CreditCard, Lock, Loader2, Users, Check, Wrench, CloudRain, Trash2, Plus, Mail, Bell } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { INQUIRY_TOPICS } from '@/data/inquiry-topics';
import type { InquiryTopic } from '@/data/inquiry-topics';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { MaintenanceCard } from '@/components/admin/MaintenanceCard';
import { clearUserNotifications, clearAllNotifications } from '@/lib/maintenance-actions';
import type { LeagueOfficer, Game, InquiryDeliveryConfig, Sport } from '@/types/scheduling';
import { Checkbox } from '@/components/ui/checkbox';
import { EXECUTIVE_TITLES, getCoordinators } from '@/data/officers';

type OfficerRecord = LeagueOfficer;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** First-run default roles for a sport: executives + coordinators, with topic routing seeded. */
function buildDefaultRoles(sport: Sport): OfficerRecord[] {
  const execs = (EXECUTIVE_TITLES as readonly string[]).map((title) => ({ title, isExecutive: true }));
  const coords = getCoordinators(sport).map((c) => ({ title: c.title, isExecutive: false }));
  return [...execs, ...coords].map((r, idx) => ({
    id: `${sport}-${slug(r.title)}`,
    title: r.title,
    name: null,
    email: null,
    contactHint: '',
    isExecutive: r.isExecutive,
    handlesTopics: INQUIRY_TOPICS.filter((t) => t.assignedToRole === r.title).map((t) => t.value),
    mappedTopic: (INQUIRY_TOPICS.find((t) => t.assignedToRole === r.title)?.value ?? 'general') as InquiryTopic,
    order: idx,
    sport,
  }));
}

interface OfficerRowValues {
  title: string;
  email: string;
  hint: string;
  isExecutive: boolean;
  handlesTopics: InquiryTopic[];
}

function OfficerRow({ officer, holderName, onSave, onDelete }: {
  officer: OfficerRecord;
  holderName: string | null;
  onSave: (id: string, holderName: string | null, values: OfficerRowValues) => Promise<void>;
  onDelete: (id: string, title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(officer.title ?? '');
  const [email, setEmail] = useState(officer.email ?? '');
  const [hint, setHint] = useState(officer.contactHint ?? '');
  const [isExecutive, setIsExecutive] = useState(officer.isExecutive ?? false);
  const [handlesTopics, setHandlesTopics] = useState<InquiryTopic[]>(officer.handlesTopics ?? []);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setTitle(officer.title ?? '');
    setEmail(officer.email ?? '');
    setHint(officer.contactHint ?? '');
    setIsExecutive(officer.isExecutive ?? false);
    setHandlesTopics(officer.handlesTopics ?? []);
  }, [officer.title, officer.email, officer.contactHint, officer.isExecutive, officer.handlesTopics]);

  const handleSave = async () => {
    setSaving(true);
    await onSave(officer.id, holderName, { title, email, hint, isExecutive, handlesTopics });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const sameTopics =
    handlesTopics.length === (officer.handlesTopics?.length ?? 0) &&
    handlesTopics.every((t) => officer.handlesTopics?.includes(t));
  const dirty =
    title.trim() !== (officer.title ?? '') ||
    email !== (officer.email ?? '') ||
    hint !== (officer.contactHint ?? '') ||
    isExecutive !== (officer.isExecutive ?? false) ||
    !sameTopics;

  const topicSummary =
    handlesTopics.length === 0
      ? 'No topics'
      : INQUIRY_TOPICS.filter((t) => handlesTopics.includes(t.value)).map((t) => t.label).join(', ');

  return (
    <div className="border rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={60}
          placeholder="Role / title name"
          className="font-semibold text-sm h-9 max-w-xs"
        />
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground">{holderName ?? 'TBA'}</span>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            title="Delete role"
            onClick={() => onDelete(officer.id, officer.title)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Email (where these inquiries are sent)</Label>
          <Input
            placeholder="e.g. president@syba.blue"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={120}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Handles inquiry topics</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="rounded-xl w-full text-xs h-9 justify-start font-normal truncate">
                {topicSummary}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-3" align="start">
              <p className="text-xs font-semibold mb-2 text-muted-foreground">Topics routed to this role</p>
              <div className="space-y-1.5">
                {INQUIRY_TOPICS.map((t) => (
                  <label key={t.value} className="flex items-center gap-2 text-xs cursor-pointer">
                    <Checkbox
                      checked={handlesTopics.includes(t.value)}
                      onCheckedChange={(checked) => {
                        setHandlesTopics((prev) =>
                          checked ? [...prev, t.value] : prev.filter((x) => x !== t.value)
                        );
                      }}
                    />
                    {t.label}
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
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
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <Switch checked={isExecutive} onCheckedChange={setIsExecutive} />
          Show in public leadership grid
        </label>
        <Button
          size="sm"
          variant={saved ? 'secondary' : 'default'}
          disabled={!dirty || saving || title.trim() === ''}
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
  const { user, isSiteAdmin } = useUser();
  const { activeSport, isAdmin } = useSport();
  const db = useFirestore();
  const auth = useAuth();
  const { toast } = useToast();

  const [notifEmail, setNotifEmail] = useState('');
  const [testPushBusy, setTestPushBusy] = useState(false);
  const [testPushEmail, setTestPushEmail] = useState('');

  // Site Admin test send: pushes to the caller's own registered devices (or a
  // pilot user's, by email), verifying the whole pipeline end-to-end.
  const handleTestPush = async (delaySeconds = 0) => {
    if (!user) return;
    setTestPushBusy(true);
    if (delaySeconds > 0) {
      toast({
        title: `Sending in ${delaySeconds} seconds`,
        description: 'Lock the phone or switch apps now — the notification should appear on the lock screen.',
      });
    }
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin/test-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          ...(testPushEmail.trim() ? { email: testPushEmail.trim() } : {}),
          ...(delaySeconds > 0 ? { delaySeconds } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      if (data.scheduled) {
        toast({
          title: `Test scheduled for ${data.target}`,
          description: `Arriving in ~${data.delaySeconds} seconds. If nothing shows on the locked device, check that notifications were enabled from the installed app.`,
        });
      } else if (data.tokenCount === 0) {
        toast({
          title: `No devices registered for ${data.target}`,
          description: 'Enable notifications on the device first (dashboard banner or Parent Settings), then try again.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: `Test sent to ${data.sent} of ${data.tokenCount} device${data.tokenCount === 1 ? '' : 's'} for ${data.target}`,
          description: 'If the portal is open on the device, it appears as an in-app toast; otherwise as a system notification within seconds.' +
            (data.pruned > 0 ? ` Removed ${data.pruned} stale device registration${data.pruned === 1 ? '' : 's'}.` : ''),
        });
      }
    } catch (err: any) {
      toast({ title: 'Test push failed', description: err.message, variant: 'destructive' });
    } finally {
      setTestPushBusy(false);
    }
  };

  // Wipe every push registration for the target (self or pilot email) so the
  // next enable starts from a clean slate — used when repeated installs/tests
  // have piled up stale device registrations.
  const handleClearPushDevices = async () => {
    if (!user) return;
    setTestPushBusy(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin/test-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          action: 'clear-devices',
          ...(testPushEmail.trim() ? { email: testPushEmail.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      toast({
        title: `Cleared ${data.cleared} device registration${data.cleared === 1 ? '' : 's'} for ${data.target}`,
        description: 'The device(s) will stop receiving pushes until notifications are enabled again (dashboard banner or Parent Settings).',
      });
    } catch (err: any) {
      toast({ title: 'Clear failed', description: err.message, variant: 'destructive' });
    } finally {
      setTestPushBusy(false);
    }
  };
  const [stripeConfigured, setStripeConfigured] = useState<boolean | null>(null);
  const [stripeMode, setStripeMode] = useState<'sandbox' | 'production' | null>(null);
  const [stripeKeys, setStripeKeys] = useState<{ test: boolean; live: boolean }>({ test: false, live: false });
  const [stripeAudit, setStripeAudit] = useState<{ updatedAt: string; updatedByName: string }>({ updatedAt: '', updatedByName: '' });
  const [confirmSandboxOpen, setConfirmSandboxOpen] = useState(false);
  const [deleteRoleTarget, setDeleteRoleTarget] = useState<{ id: string; title: string } | null>(null);
  const [switchingMode, setSwitchingMode] = useState(false);

  const loadStripeStatus = async () => {
    try {
      const res = await fetch('/api/stripe/status');
      const data = await res.json();
      setStripeConfigured(!!data.configured);
      setStripeMode(data.mode ?? 'sandbox');
      setStripeKeys({ test: !!data.testConfigured, live: !!data.liveConfigured });
      setStripeAudit({ updatedAt: data.updatedAt ?? '', updatedByName: data.updatedByName ?? '' });
    } catch {
      setStripeConfigured(false);
    }
  };

  useEffect(() => {
    loadStripeStatus();
  }, []);

  // Flip the runtime Stripe payment mode (Site Admin only). Switching INTO sandbox is
  // confirmed first because it stops real payments from being collected on the live site.
  const applyStripeMode = async (mode: 'sandbox' | 'production') => {
    setSwitchingMode(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/stripe/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to change mode');
      }
      await loadStripeStatus();
      toast({ title: `Payments now in ${mode === 'production' ? 'Live' : 'Test'} mode` });
    } catch (e: any) {
      toast({ title: 'Could not change payment mode', description: e.message, variant: 'destructive' });
    } finally {
      setSwitchingMode(false);
      setConfirmSandboxOpen(false);
    }
  };

  const onToggleStripeMode = (checked: boolean) => {
    // checked = Live mode. Going live is immediate; going to test asks for confirmation.
    if (checked) applyStripeMode('production');
    else setConfirmSandboxOpen(true);
  };

  // Rain-out engine state
  const [rainoutDate, setRainoutDate] = useState('');
  const [selectedGameIds, setSelectedGameIds] = useState<Set<string>>(new Set());
  const [processingRainout, setProcessingRainout] = useState(false);

  // Query scheduled games on the selected rainout date (all sports on that day)
  const rainoutGamesQuery = useMemoFirebase(() => {
    if (!db || !rainoutDate) return null;
    return query(
      collection(db, 'games'),
      where('date', '==', rainoutDate),
      where('status', '==', 'scheduled')
    );
  }, [db, rainoutDate]);
  const { data: rainoutGames, isLoading: loadingRainoutGames } = useCollection<Game>(rainoutGamesQuery);

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
    isSiteAdmin?: boolean;
  }>(usersQuery);

  // Inquiry delivery config (systemConfig/inquiries) — master CC + per-sport fallback.
  // systemConfig is not client-readable (Firestore rules block it), so we fetch it from a
  // server endpoint that reads via the Admin SDK — mirrors the Stripe-status pattern.
  const [inquiryConfig, setInquiryConfig] = useState<InquiryDeliveryConfig | null>(null);
  const [masterCc, setMasterCc] = useState('');
  const [sportFallback, setSportFallback] = useState('');
  const [savingDelivery, setSavingDelivery] = useState(false);

  const loadInquiryConfig = async () => {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const res = await fetch('/api/admin/inquiry-config', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      setInquiryConfig((await res.json()) as InquiryDeliveryConfig);
    } catch {
      // Non-fatal — the form just starts empty.
    }
  };

  useEffect(() => {
    if (isSiteAdmin) loadInquiryConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSiteAdmin]);

  // Hydrate the delivery form from the loaded config (and when switching sport for the fallback field).
  useEffect(() => {
    setMasterCc((inquiryConfig?.alwaysCcEmails ?? []).join(', '));
  }, [inquiryConfig?.alwaysCcEmails]);
  useEffect(() => {
    if (!activeSport) return;
    setSportFallback((inquiryConfig?.fallbackEmails?.[activeSport] ?? []).join(', '));
  }, [inquiryConfig?.fallbackEmails, activeSport]);

  const handleSaveDelivery = async () => {
    if (!activeSport) return;
    setSavingDelivery(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/inquiry-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          alwaysCcEmails: masterCc,
          // Preserve the other sport's fallback + any existing topic overrides.
          fallbackEmails: { ...(inquiryConfig?.fallbackEmails ?? {}), [activeSport]: sportFallback },
          topicOverrides: inquiryConfig?.topicOverrides ?? {},
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Save failed');
      }
      // POST returns the saved config — refresh local state so values + "Last changed" stay correct.
      setInquiryConfig(data as InquiryDeliveryConfig);
      toast({ title: 'Inquiry delivery updated' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Could not save', description: e.message });
    } finally {
      setSavingDelivery(false);
    }
  };

  // Editable role rows — every officer doc for this sport except the auto-synced at-large entries.
  const roleOfficers = useMemo<OfficerRecord[]>(() => {
    if (!officers) return [];
    return officers
      .filter(o => o.title !== 'At-Large Board Member')
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [officers]);

  // Named position titles in the directory (used to decide who counts as "at-large").
  const directoryTitles = useMemo(
    () => new Set(roleOfficers.map(o => o.title)),
    [roleOfficers],
  );

  // First-run seed: if a sport has no editable roles yet, populate the defaults once
  // so non-technical admins never face an empty screen.
  useEffect(() => {
    if (!db || !activeSport || officers === null) return;
    if (roleOfficers.length > 0) return;
    (async () => {
      for (const r of buildDefaultRoles(activeSport)) {
        const { id, ...data } = r;
        await setDoc(doc(db, 'officers', id), data, { merge: true });
      }
    })();
  }, [db, activeSport, officers, roleOfficers.length]);

  // At-large members — board members for this sport who hold no named directory position.
  const atLargeMembers = useMemo(() => {
    if (!allUsers || !activeSport) return [];
    return allUsers.filter(u => {
      // Site Admin is a behind-the-scenes superuser role, not a board seat —
      // never auto-list them as an At-Large Board Member. Mirror the same
      // dedicated-field + legacy-roles fallback used by useUser() so legacy
      // profiles (Site Admin stored only in `roles`) are also excluded.
      if (u.isSiteAdmin || u.roles?.includes('Site Admin')) return false;
      const sportRoleList = u.sportRoles?.[activeSport] ?? [];
      const isBoardMember =
        sportRoleList.some(r => r === 'Board Member' || r === 'Admin') ||
        u.roles?.includes('Board Member');
      if (!isBoardMember) return false;
      return !(u.officerTitles ?? []).some(t => directoryTitles.has(t));
    });
  }, [allUsers, activeSport, directoryTitles]);

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

  const handleSave = async (id: string, name: string | null, values: OfficerRowValues) => {
    if (!db || !activeSport) return;
    try {
      await setDoc(
        doc(db, 'officers', id),
        {
          title: values.title.trim(),
          name: name || null,
          email: values.email.trim() || null,
          contactHint: values.hint.trim(),
          isExecutive: values.isExecutive,
          handlesTopics: values.handlesTopics,
          // Keep mappedTopic in sync (drives inbound-email classification) — first handled topic.
          mappedTopic: (values.handlesTopics[0] ?? 'general') as InquiryTopic,
          sport: activeSport,
        },
        { merge: true }
      );
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Save failed', description: err.message });
    }
  };

  const handleAddRole = async () => {
    if (!db || !activeSport) return;
    try {
      const ref = doc(collection(db, 'officers'));
      const nextOrder = roleOfficers.reduce((m, o) => Math.max(m, o.order ?? 0), 0) + 1;
      await setDoc(ref, {
        title: 'New Role',
        name: null,
        email: null,
        contactHint: '',
        isExecutive: false,
        handlesTopics: [],
        mappedTopic: 'general' as InquiryTopic,
        order: nextOrder,
        sport: activeSport,
      });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Could not add role', description: err.message });
    }
  };

  const handleDeleteRole = async (id: string, title: string) => {
    setDeleteRoleTarget({ id, title });
  };

  const confirmDeleteRole = async () => {
    if (!db || !deleteRoleTarget) return;
    try {
      await deleteDoc(doc(db, 'officers', deleteRoleTarget.id));
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Delete failed', description: err.message });
    } finally {
      setDeleteRoleTarget(null);
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

  const handleClearAllNotifications = async () => {
    const token = await auth.currentUser?.getIdToken();
    if (!token) {
      toast({ variant: 'destructive', title: 'Not authenticated', description: 'Please sign in and try again.' });
      return;
    }
    try {
      const { deleted } = await clearAllNotifications(token);
      toast({
        title: 'All notifications cleared',
        description: `Deleted ${deleted} notification${deleted !== 1 ? 's' : ''} across all users.`,
      });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Action failed', description: err.message });
    }
  };

  const handleProcessRainout = async () => {
    if (!db || selectedGameIds.size === 0) return;
    setProcessingRainout(true);
    try {
      const batch = writeBatch(db);
      for (const gameId of selectedGameIds) {
        const game = rainoutGames?.find(g => g.id === gameId);
        if (!game) continue;
        batch.update(doc(db, 'games', gameId), {
          status: 'unscheduled',
          originalDate: game.date,
          originalTime: game.time,
          originalFieldId: game.fieldId,
          originalFieldName: game.fieldName,
        });
      }
      await batch.commit();
      toast({
        title: 'Rain-out processed',
        description: `${selectedGameIds.size} game${selectedGameIds.size !== 1 ? 's' : ''} marked as unscheduled. Original date/field preserved.`,
      });
      setSelectedGameIds(new Set());
      setRainoutDate('');
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Failed to process rain-out', description: err.message });
    } finally {
      setProcessingRainout(false);
    }
  };

  const canAccessMaintenance = isAdmin || isSiteAdmin;

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6">
        <header className="mb-4 md:mb-6">
          <h1 className="text-xl md:text-2xl font-bold font-headline flex items-center gap-2">
            <Settings className="h-8 w-8" />
            Settings
          </h1>
          <p className="text-sm text-muted-foreground">Manage officer directory and system configuration.</p>
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
                  <div className="flex-1">
                    <CardTitle>Roles &amp; Inquiry Routing</CardTitle>
                    <CardDescription>
                      Add, rename, or remove roles for {activeSport ?? 'this sport'}. The <strong>Email</strong> you set
                      is where that role&apos;s inquiries are sent. Use <strong>Handles inquiry topics</strong> to choose
                      which website questions route to each role. Each sport is managed independently.
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
                      {roleOfficers.map((officer) => (
                        <OfficerRow
                          key={officer.id}
                          officer={officer}
                          holderName={getHolderName(officer.title)}
                          onSave={handleSave}
                          onDelete={handleDeleteRole}
                        />
                      ))}

                      <Button variant="outline" size="sm" onClick={handleAddRole} className="rounded-xl">
                        <Plus className="mr-2 h-3.5 w-3.5" /> Add role
                      </Button>

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

              {/* Inquiry Delivery — Site Admin only */}
              {isSiteAdmin && (
                <Card className="border-none shadow-md">
                  <CardHeader className="flex flex-row items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                      <Mail className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <CardTitle>Inquiry Delivery</CardTitle>
                      <CardDescription>
                        A safety net so no inquiry is ever missed. The master inbox is copied on <strong>every</strong>{' '}
                        inquiry; the fallback only receives inquiries whose topic has no assigned role.
                      </CardDescription>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Master inbox — CC&apos;d on every inquiry (comma-separated)</Label>
                      <Input
                        placeholder="you@example.com, board@example.com"
                        value={masterCc}
                        onChange={(e) => setMasterCc(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">
                        Fallback inbox for {activeSport ?? 'this sport'} — used only when a topic has no role (comma-separated)
                      </Label>
                      <Input
                        placeholder="fallback@example.com"
                        value={sportFallback}
                        onChange={(e) => setSportFallback(e.target.value)}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      {inquiryConfig?.updatedAt ? (
                        <p className="text-xs text-muted-foreground">
                          Last changed{inquiryConfig.updatedByName ? ` by ${inquiryConfig.updatedByName}` : ''} on{' '}
                          {new Date(inquiryConfig.updatedAt).toLocaleString()}
                        </p>
                      ) : <span />}
                      <Button size="sm" onClick={handleSaveDelivery} disabled={savingDelivery || !activeSport} className="min-w-24">
                        {savingDelivery ? (
                          <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Saving</>
                        ) : (
                          <><Save className="mr-2 h-3.5 w-3.5" /> Save</>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Payments */}
              <Card className="border-none shadow-md">
                <CardHeader className="flex flex-row items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                    <CreditCard className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <CardTitle>Payments</CardTitle>
                    <CardDescription>Stripe registration fee collection</CardDescription>
                  </div>
                  {stripeConfigured === null ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : !stripeConfigured ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow-100 px-3 py-1 text-xs font-semibold text-yellow-700">
                      Not Configured
                    </span>
                  ) : stripeMode === 'production' ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
                      <Check className="h-3.5 w-3.5" /> Live mode
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
                      TEST mode
                    </span>
                  )}
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    {!stripeConfigured
                      ? 'Add STRIPE_SECRET_KEY to your environment to enable payment collection.'
                      : stripeMode === 'production'
                        ? 'Payments are LIVE — real registration fees are collected at checkout.'
                        : 'Payments are in TEST mode — no real money is collected. Parents can register with test cards only.'}
                  </p>

                  {stripeConfigured && isSiteAdmin && (
                    <div className="rounded-xl border p-4 space-y-3">
                      <div className="flex items-center justify-between gap-4">
                        <div className="space-y-0.5">
                          <Label>Live payment mode</Label>
                          <p className="text-xs text-muted-foreground">
                            Off = Test mode (no real charges). On = Live (real charges).
                          </p>
                        </div>
                        {switchingMode ? (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        ) : (
                          <Switch
                            checked={stripeMode === 'production'}
                            onCheckedChange={onToggleStripeMode}
                            disabled={
                              stripeMode === null ||
                              (stripeMode === 'sandbox' && !stripeKeys.live) ||
                              (stripeMode === 'production' && !stripeKeys.test)
                            }
                          />
                        )}
                      </div>
                      {(!stripeKeys.live || !stripeKeys.test) && (
                        <p className="text-xs text-amber-600">
                          {!stripeKeys.live && 'Live keys not configured. '}
                          {!stripeKeys.test && 'Test keys not configured. '}
                          Add the missing STRIPE_SECRET_KEY_TEST / STRIPE_SECRET_KEY_LIVE values to enable switching.
                        </p>
                      )}
                      {stripeAudit.updatedAt && (
                        <p className="text-xs text-muted-foreground">
                          Last changed{stripeAudit.updatedByName ? ` by ${stripeAudit.updatedByName}` : ''} on{' '}
                          {new Date(stripeAudit.updatedAt).toLocaleString()}
                        </p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              <AlertDialog open={confirmSandboxOpen} onOpenChange={setConfirmSandboxOpen}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Switch payments to TEST mode?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This puts the live site into test mode. Real payments will <strong>NOT</strong> be
                      collected — parents who register will be marked paid using test cards only. Remember to
                      switch back to Live mode before real registration resumes.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={switchingMode}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={(e) => { e.preventDefault(); applyStripeMode('sandbox'); }}
                      disabled={switchingMode}
                      className="bg-amber-600 hover:bg-amber-700"
                    >
                      {switchingMode ? 'Switching…' : 'Switch to Test mode'}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <AlertDialog open={!!deleteRoleTarget} onOpenChange={(o) => { if (!o) setDeleteRoleTarget(null); }}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete the &quot;{deleteRoleTarget?.title}&quot; role?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Inquiries that route to this role will fall back to your master/fallback inbox
                      until they are reassigned.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={confirmDeleteRole}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Delete Role
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

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

                {/* Push self-test — Site Admin only (matches the API route gate) */}
                {isSiteAdmin && (
                  <Card className="border-none shadow-md">
                    <CardHeader className="flex flex-row items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                        <Bell className="h-5 w-5" />
                      </div>
                      <div>
                        <CardTitle>Test Push Notification</CardTitle>
                        <CardDescription>
                          Sends a test notification to your own registered devices, or to one pilot user by email — no one else is contacted. The target must enable notifications on their device first.
                        </CardDescription>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="space-y-1.5 max-w-sm">
                        <Label htmlFor="test-push-email">Target email (optional — blank sends to yourself)</Label>
                        <Input
                          id="test-push-email"
                          type="email"
                          placeholder="family-member@example.com"
                          value={testPushEmail}
                          onChange={e => setTestPushEmail(e.target.value)}
                        />
                      </div>
                      <div className="flex flex-wrap gap-3">
                        <Button onClick={() => handleTestPush()} disabled={testPushBusy}>
                          {testPushBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Bell className="mr-2 h-4 w-4" />}
                          Send Test Notification
                        </Button>
                        <Button variant="secondary" onClick={() => handleTestPush(15)} disabled={testPushBusy}>
                          <Bell className="mr-2 h-4 w-4" />
                          Send in 15s (lock phone first)
                        </Button>
                        <Button variant="outline" onClick={handleClearPushDevices} disabled={testPushBusy}>
                          <Trash2 className="mr-2 h-4 w-4" />
                          Clear Registered Devices
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Device counts include old registrations from deleted/re-added home-screen icons. Those clean themselves up automatically after a failed delivery, or use Clear Registered Devices for a fresh start before re-testing.
                      </p>
                    </CardContent>
                  </Card>
                )}

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

                <MaintenanceCard
                  title="Clear ALL Notifications"
                  description="Permanently delete every notification for every user across the entire system. Intended for removing test/junk data before launch."
                  buttonLabel="Clear All Notifications"
                  buttonVariant="destructive"
                  confirmMessage="Warning: This permanently deletes ALL notifications for EVERY user. This cannot be undone. Are you sure?"
                  onExecute={handleClearAllNotifications}
                />

                {/* Rain-out Batch Action */}
                <Card className="border-none shadow-md">
                  <CardHeader className="flex flex-row items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                      <CloudRain className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle>Rain-out Game Day</CardTitle>
                      <CardDescription>
                        Mark scheduled games as unscheduled. Original date, time, and field are preserved for displacement history.
                      </CardDescription>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Select game date</Label>
                      <Input
                        type="date"
                        value={rainoutDate}
                        onChange={(e) => {
                          setRainoutDate(e.target.value);
                          setSelectedGameIds(new Set());
                        }}
                        className="max-w-xs"
                      />
                    </div>

                    {rainoutDate && (
                      <div className="space-y-2">
                        {loadingRainoutGames ? (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Loading games…
                          </div>
                        ) : !rainoutGames || rainoutGames.length === 0 ? (
                          <p className="text-sm text-muted-foreground py-2">No scheduled games found on this date.</p>
                        ) : (
                          <>
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                              Scheduled games on {rainoutDate}
                            </p>
                            <div className="space-y-2">
                              {rainoutGames.map((game) => {
                                const label = game.type === 'game'
                                  ? `${game.homeTeamName ?? '?'} vs ${game.awayTeamName ?? '?'}`
                                  : `${game.teamName ?? 'Practice'} — Practice`;
                                return (
                                  <label
                                    key={game.id}
                                    className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/40 transition-colors"
                                  >
                                    <Checkbox
                                      checked={selectedGameIds.has(game.id)}
                                      onCheckedChange={(checked) => {
                                        setSelectedGameIds(prev => {
                                          const next = new Set(prev);
                                          if (checked) next.add(game.id);
                                          else next.delete(game.id);
                                          return next;
                                        });
                                      }}
                                    />
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium truncate">{label}</p>
                                      <p className="text-xs text-muted-foreground">
                                        {game.time} · {game.fieldName}
                                      </p>
                                    </div>
                                  </label>
                                );
                              })}
                            </div>
                            <Button
                              variant="default"
                              disabled={selectedGameIds.size === 0 || processingRainout}
                              onClick={handleProcessRainout}
                              className="mt-2"
                            >
                              {processingRainout ? (
                                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing…</>
                              ) : (
                                <><CloudRain className="mr-2 h-4 w-4" /> Process Rain-out ({selectedGameIds.size} selected)</>
                              )}
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            )}
          </Tabs>
        </div>
      </main>
    </div>
  );
}
