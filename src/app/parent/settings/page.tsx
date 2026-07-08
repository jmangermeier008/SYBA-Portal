
"use client";

import { useState, useEffect } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useUser, useFirestore, useFirebaseApp, useCollection, useMemoFirebase } from '@/firebase';
import { doc, getDoc, updateDoc, collection, query, orderBy, where } from 'firebase/firestore';
import { ShieldCheck, Save, Loader2, User as UserIcon, Phone, Mail, Users, CheckCircle2, X, ArrowRight, Bell } from 'lucide-react';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { stripPhone } from '@/lib/utils';
import { useSport } from '@/firebase/sport-context';
import { isIosBrowser, isStandalone } from '@/lib/pwa';
import { enablePush, disablePush, getStoredPushToken, isPushSupported } from '@/lib/push-client';

interface OfficerRecord {
  id: string;
  title: string;
  name: string | null;
  email: string | null;
  contactHint: string;
  order: number;
}

interface Player {
  id: string;
  firstName: string;
  lastName: string;
  secondaryParentId?: string;
}

interface LinkedParent {
  uid: string;
  displayName: string | null;
  email: string | null;
}

export default function ParentSettingsPage() {
  const { user, profile } = useUser();
  const db = useFirestore();
  const app = useFirebaseApp();
  const { toast } = useToast();
  const { activeSport, leagueName } = useSport();
  const [profileLoading, setProfileLoading] = useState(false);
  const [privacyLoading, setPrivacyLoading] = useState(false);

  // Push notification toggle — device-level state, resolved client-side only
  const [push, setPush] = useState({
    hydrated: false,
    supported: false,
    enabled: false,
    blocked: false,
    iosNeedsInstall: false,
  });
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    isPushSupported().then(supported => {
      if (cancelled) return;
      const permission =
        typeof window !== 'undefined' && 'Notification' in window
          ? Notification.permission
          : 'default';
      setPush({
        hydrated: true,
        supported,
        enabled:
          supported &&
          permission === 'granted' &&
          !!getStoredPushToken() &&
          profile?.notificationPrefs?.push !== false,
        blocked: permission === 'denied',
        iosNeedsInstall: !supported && isIosBrowser() && !isStandalone(),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [profile]);

  const handlePushToggle = async (on: boolean) => {
    if (!user) return;
    setPushBusy(true);
    if (on) {
      const result = await enablePush(app, db, user.uid);
      if (result.status === 'granted') {
        setPush(s => ({ ...s, enabled: true }));
        toast({ title: 'Notifications on', description: 'This device will now get schedule alerts.' });
      } else if (result.status === 'denied') {
        setPush(s => ({ ...s, blocked: true }));
        toast({
          title: 'Notifications are blocked',
          description: 'Your browser blocked notifications for this site. Re-enable them in browser settings, then try again.',
          variant: 'destructive',
        });
      } else if (result.status === 'ios-needs-install') {
        setPush(s => ({ ...s, iosNeedsInstall: true }));
      } else if (result.status === 'error') {
        toast({ title: 'Could not enable notifications', description: result.message, variant: 'destructive' });
      }
    } else {
      await disablePush(app, db, user.uid);
      setPush(s => ({ ...s, enabled: false }));
      toast({ title: 'Push notifications off' });
    }
    setPushBusy(false);
  };

  const officersQuery = useMemoFirebase(() => {
    if (!db || !activeSport) return null;
    return query(collection(db, 'officers'), where('sport', '==', activeSport), orderBy('order'));
  }, [db, activeSport]);
  const { data: officers } = useCollection<OfficerRecord>(officersQuery);

  const playersQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return collection(db, 'userProfiles', user.uid, 'players');
  }, [db, user]);
  const { data: players } = useCollection<Player>(playersQuery);

  const [formData, setFormData] = useState({
    displayName: '',
    phoneNumber: '',
    shareContactInfo: false,
  });

  // Display info for already-linked secondary parents — keyed by playerId
  const [linkedParents, setLinkedParents] = useState<Record<string, LinkedParent | null>>({});

  useEffect(() => {
    if (profile) {
      setFormData({
        displayName: profile.displayName || '',
        phoneNumber: profile.phoneNumber || '',
        shareContactInfo: profile.shareContactInfo || false,
      });
    }
  }, [profile]);

  // Fetch display info for already-linked secondary parents
  useEffect(() => {
    let cancelled = false;
    const fetchLinkedParents = async () => {
      if (!db || !players) return;
      for (const player of players) {
        if (cancelled) break;
        if (!player.secondaryParentId || linkedParents[player.id]) continue;
        try {
          const snap = await getDoc(doc(db, 'userProfiles', player.secondaryParentId));
          if (!cancelled && snap.exists()) {
            const data = snap.data();
            setLinkedParents(prev => ({
              ...prev,
              [player.id]: { uid: snap.id, displayName: data.displayName || null, email: data.email || null },
            }));
          }
        } catch (err) {
          console.warn('[settings] linked parent lookup failed:', err);
        }
      }
    };
    fetchLinkedParents();
    return () => { cancelled = true; };
  // linkedParents intentionally omitted — including it causes a re-fetch loop on every state update
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, db]);

  const handleSaveProfile = async () => {
    if (!user || !db) return;
    setProfileLoading(true);
    const userRef = doc(db, 'userProfiles', user.uid);
    try {
      await updateDoc(userRef, {
        displayName: formData.displayName,
        phoneNumber: stripPhone(formData.phoneNumber),
        updatedAt: new Date().toISOString(),
      });
      toast({ title: "Profile Saved", description: "Your name and phone number have been updated." });
    } catch (error: any) {
      toast({ title: "Save Failed", description: error.message || "Could not save your profile. Please try again.", variant: "destructive" });
    } finally {
      setProfileLoading(false);
    }
  };

  const handleSavePrivacy = async () => {
    if (!user || !db) return;
    setPrivacyLoading(true);
    const userRef = doc(db, 'userProfiles', user.uid);
    try {
      await updateDoc(userRef, {
        shareContactInfo: formData.shareContactInfo,
        updatedAt: new Date().toISOString(),
      });
      toast({ title: "Privacy Settings Saved", description: "Your visibility preferences have been updated." });
    } catch (error: any) {
      toast({ title: "Save Failed", description: error.message || "Could not save your settings. Please try again.", variant: "destructive" });
    } finally {
      setPrivacyLoading(false);
    }
  };

  const handleUnlinkSecondParent = async (player: Player) => {
    if (!user || !db || !player.secondaryParentId) return;
    try {
      const playerRef = doc(db, 'userProfiles', user.uid, 'players', player.id);
      // Reset parentIds to mirror what link-request approval writes
      await updateDoc(playerRef, { secondaryParentId: null, parentIds: [user.uid] });
      setLinkedParents(prev => ({ ...prev, [player.id]: null }));
      toast({ title: "Second Parent Removed", description: `Co-management access for ${player.firstName} has been revoked.` });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6">
        <header className="mb-4 md:mb-6">
          <h1 className="text-xl md:text-2xl font-bold font-headline">Privacy & Settings</h1>
          <p className="text-sm text-muted-foreground">Manage your personal information and team visibility.</p>
        </header>

        <div className="max-w-2xl space-y-6">
          {/* Profile Details */}
          <Card className="border-none shadow-md">
            <CardHeader>
              <div className="flex items-center gap-2 text-primary">
                <UserIcon className="h-5 w-5" />
                <CardTitle className="text-xl">Profile Details</CardTitle>
              </div>
              <CardDescription>Update your contact information used by the association.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Full Name</Label>
                <Input
                  id="name"
                  value={formData.displayName}
                  onChange={(e) => setFormData({...formData, displayName: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="phone"
                    className="pl-10"
                    placeholder="(555) 000-0000"
                    value={formData.phoneNumber}
                    onChange={(e) => setFormData({...formData, phoneNumber: e.target.value})}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email (Read-only)</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="email"
                    className="pl-10 bg-muted/50"
                    value={user?.email || ''}
                    readOnly
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter className="border-t pt-6">
              <Button onClick={handleSaveProfile} className="w-full h-11 rounded-xl" disabled={profileLoading}>
                {profileLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Profile
              </Button>
            </CardFooter>
          </Card>

          {/* Family Management */}
          {players && players.length > 0 && (
            <Card className="border-none shadow-md">
              <CardHeader>
                <div className="flex items-center gap-2 text-primary">
                  <Users className="h-5 w-5" />
                  <CardTitle className="text-xl">Family Management</CardTitle>
                </div>
                <CardDescription>Second parents and guardians who co-manage a player's profile.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {players.map((player) => {
                  const linked = linkedParents[player.id] ?? (player.secondaryParentId ? { uid: player.secondaryParentId, displayName: null, email: null } : null);
                  return (
                    <div key={player.id} className="p-4 rounded-xl bg-secondary/20 border space-y-3">
                      <p className="text-sm font-semibold">{player.firstName}</p>
                      {linked ? (
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <div className="flex items-center gap-2 text-green-700">
                            <CheckCircle2 className="h-4 w-4 shrink-0" />
                            <span>{linked.displayName || linked.email || 'Second parent linked'}</span>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 rounded-full text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => handleUnlinkSecondParent(player)}
                          >
                            <X className="h-3 w-3 mr-1" /> Remove
                          </Button>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">No second parent linked.</p>
                      )}
                    </div>
                  );
                })}

                <div className="p-4 rounded-xl bg-muted/30 space-y-3">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    For security, co-parents request access from their own account: they sign in
                    and tap <span className="font-semibold text-foreground">"I'm a Co-Parent"</span> on
                    their My Players page. You'll approve the request from your dashboard.
                  </p>
                  <Button asChild variant="outline" size="sm" className="rounded-xl">
                    <Link href="/parent/family">
                      Go to My Players <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* League Contacts */}
          <Card className="border-none shadow-md">
            <CardHeader>
              <div className="flex items-center gap-2 text-primary">
                <Users className="h-5 w-5" />
                <CardTitle className="text-xl">League Leadership</CardTitle>
              </div>
              <CardDescription>Contact information for {leagueName} board members.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="divide-y">
                {(officers ?? []).filter((o) => o.name && o.title !== 'At-Large Board Member').map((officer) => (
                  <div key={officer.id} className="flex items-center justify-between py-3">
                    <div>
                      <p className="text-sm text-muted-foreground">{officer.title}</p>
                      {officer.contactHint && (
                        <p className="text-[10px] text-muted-foreground/70">{officer.contactHint}</p>
                      )}
                      {officer.email && (
                        <a
                          href={`mailto:${officer.email}`}
                          className="text-[11px] text-primary hover:underline"
                        >
                          {officer.email}
                        </a>
                      )}
                    </div>
                    <p className="text-sm font-semibold ml-4 text-right">
                      {officer.name ? officer.name : <span className="text-muted-foreground italic font-normal">TBA</span>}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Team Directory Privacy */}
          <Card className="border-none shadow-md overflow-hidden">
            <CardHeader className="bg-primary/5">
              <div className="flex items-center gap-2 text-primary">
                <ShieldCheck className="h-5 w-5" />
                <CardTitle className="text-xl">Team Directory Privacy</CardTitle>
              </div>
              <CardDescription>Control what other parents on your child's team can see.</CardDescription>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              <div className="flex items-center justify-between p-4 rounded-xl bg-secondary/20 border">
                <div className="space-y-0.5">
                  <Label className="text-base">Share contact info with team</Label>
                  <p className="text-xs text-muted-foreground">Allow other parents to see your phone and email for carpooling and coordination.</p>
                </div>
                <Switch
                  checked={formData.shareContactInfo}
                  onCheckedChange={(val) => setFormData({...formData, shareContactInfo: val})}
                />
              </div>

              <div className="p-4 rounded-xl bg-muted/30 flex gap-3 items-start">
                <ShieldCheck className="h-5 w-5 text-green-600 mt-0.5" />
                <div className="text-xs text-muted-foreground leading-relaxed">
                  <p className="font-semibold text-foreground mb-1">Our Privacy Promise</p>
                  {leagueName} will never sell your data. This toggle only controls visibility within the "My Team" roster view for parents on the same team. Coaches and Administrators always have access to contact info for emergency purposes.
                </div>
              </div>
            </CardContent>
            <CardFooter className="bg-secondary/10 border-t pt-6">
              <Button onClick={handleSavePrivacy} className="w-full h-11 rounded-xl" disabled={privacyLoading}>
                {privacyLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Privacy Settings
              </Button>
            </CardFooter>
          </Card>

          {/* Notifications */}
          <Card className="border-none shadow-md">
            <CardHeader>
              <div className="flex items-center gap-2 text-primary">
                <Bell className="h-5 w-5" />
                <CardTitle className="text-xl">Notifications</CardTitle>
              </div>
              <CardDescription>Device alerts for cancellations and schedule changes. Email and in-portal notifications are unaffected.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-4 p-4 rounded-xl bg-secondary/20 border">
                <div className="space-y-0.5">
                  <Label className="text-base">Push notifications</Label>
                  <p className="text-xs text-muted-foreground">
                    {!push.hydrated
                      ? 'Checking this device…'
                      : push.blocked
                        ? (isStandalone() && isIosBrowser()
                            ? 'Notifications are blocked. On your iPhone: Settings → Notifications → SV Sports → Allow Notifications, then return here.'
                            : isStandalone()
                              ? 'Notifications are blocked. In your phone Settings → Apps → SV Sports → Notifications, turn them on, then return here.'
                              : 'Notifications are blocked. Tap the padlock/settings icon next to the web address, set Notifications to Allow, then reload.')
                        : push.iosNeedsInstall
                          ? 'On iPhone, first add the portal to your Home Screen (Share → Add to Home Screen), then turn this on from the installed app.'
                          : push.supported
                            ? 'Get an alert on this device the moment a game or practice is cancelled or moved.'
                            : 'Not supported in this browser.'}
                  </p>
                </div>
                <Switch
                  checked={push.enabled}
                  disabled={!push.hydrated || pushBusy || push.blocked || !push.supported}
                  onCheckedChange={handlePushToggle}
                  aria-label="Toggle push notifications"
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
