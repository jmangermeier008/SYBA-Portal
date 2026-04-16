
"use client";

import { useState, useEffect } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useUser, useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { doc, updateDoc, collection, query, orderBy, where, getDocs, arrayUnion } from 'firebase/firestore';
import { ShieldCheck, Save, Loader2, User as UserIcon, Phone, Mail, Users, UserPlus, CheckCircle2, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { stripPhone } from '@/lib/utils';

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
  const { toast } = useToast();
  const [profileLoading, setProfileLoading] = useState(false);
  const [privacyLoading, setPrivacyLoading] = useState(false);

  const officersQuery = useMemoFirebase(() => {
    if (!db) return null;
    return query(collection(db, 'officers'), orderBy('order'));
  }, [db]);
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

  // Second parent linking state — keyed by playerId
  const [linkEmail, setLinkEmail] = useState<Record<string, string>>({});
  const [linkLoading, setLinkLoading] = useState<Record<string, boolean>>({});
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
          const snap = await getDocs(
            query(collection(db, 'userProfiles'), where('__name__', '==', player.secondaryParentId))
          );
          if (!cancelled && !snap.empty) {
            const data = snap.docs[0].data();
            setLinkedParents(prev => ({
              ...prev,
              [player.id]: { uid: snap.docs[0].id, displayName: data.displayName || null, email: data.email || null },
            }));
          }
        } catch {}
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

  const handleLinkSecondParent = async (player: Player) => {
    const email = linkEmail[player.id]?.trim().toLowerCase();
    if (!email || !user || !db) return;

    setLinkLoading(prev => ({ ...prev, [player.id]: true }));
    try {
      // Look up the second parent's userProfile by email
      const snap = await getDocs(query(collection(db, 'userProfiles'), where('email', '==', email)));
      if (snap.empty) {
        toast({ title: "User Not Found", description: `No SYBA account found for "${email}". They must sign up first.`, variant: "destructive" });
        return;
      }
      const secondParentDoc = snap.docs[0];
      const secondParentUid = secondParentDoc.id;

      if (secondParentUid === user.uid) {
        toast({ title: "Invalid", description: "You cannot link your own account as a second parent.", variant: "destructive" });
        return;
      }

      if (player.secondaryParentId === secondParentUid) {
        toast({ title: "Already Linked", description: "This parent is already linked to this player." });
        return;
      }

      // Write secondaryParentId to the player doc
      const playerRef = doc(db, 'userProfiles', user.uid, 'players', player.id);
      await updateDoc(playerRef, { secondaryParentId: secondParentUid });

      // Grant the second parent access via enrolledPlayerIds on their profile
      const secondParentRef = doc(db, 'userProfiles', secondParentUid);
      await updateDoc(secondParentRef, { enrolledPlayerIds: arrayUnion(player.id) });

      const data = secondParentDoc.data();
      setLinkedParents(prev => ({
        ...prev,
        [player.id]: { uid: secondParentUid, displayName: data.displayName || null, email: data.email || null },
      }));
      setLinkEmail(prev => ({ ...prev, [player.id]: '' }));
      toast({ title: "Second Parent Linked", description: `${data.displayName || email} can now co-manage ${player.firstName}.` });
    } catch (error: any) {
      toast({ title: "Link Failed", description: error.message || "Could not link the second parent.", variant: "destructive" });
    } finally {
      setLinkLoading(prev => ({ ...prev, [player.id]: false }));
    }
  };

  const handleUnlinkSecondParent = async (player: Player) => {
    if (!user || !db || !player.secondaryParentId) return;
    try {
      const playerRef = doc(db, 'userProfiles', user.uid, 'players', player.id);
      await updateDoc(playerRef, { secondaryParentId: null });
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
                <CardDescription>Link a second parent or guardian to co-manage a player's profile.</CardDescription>
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
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                              className="pl-9 h-9 text-sm"
                              placeholder="Second parent's email"
                              type="email"
                              value={linkEmail[player.id] || ''}
                              onChange={(e) => setLinkEmail(prev => ({ ...prev, [player.id]: e.target.value }))}
                              onKeyDown={(e) => e.key === 'Enter' && handleLinkSecondParent(player)}
                            />
                          </div>
                          <Button
                            size="sm"
                            className="h-9 rounded-xl shrink-0"
                            disabled={!linkEmail[player.id] || linkLoading[player.id]}
                            onClick={() => handleLinkSecondParent(player)}
                          >
                            {linkLoading[player.id] ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
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
              <CardDescription>Contact information for SYBA board members.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="divide-y">
                {(officers ?? []).map((officer) => (
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
                  SYBA will never sell your data. This toggle only controls visibility within the "My Team" roster view for parents on the same team. Coaches and Administrators always have access to contact info for emergency purposes.
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
        </div>
      </main>
    </div>
  );
}
