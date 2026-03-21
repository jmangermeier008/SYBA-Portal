
"use client";

import { useState, useEffect } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useUser, useFirestore } from '@/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { ShieldCheck, Save, Loader2, User as UserIcon, Phone, Mail, Users } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { OFFICERS } from '@/data/officers';

export default function ParentSettingsPage() {
  const { user, profile } = useUser();
  const db = useFirestore();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    displayName: '',
    phoneNumber: '',
    shareContactInfo: false,
  });

  useEffect(() => {
    if (profile) {
      setFormData({
        displayName: profile.displayName || '',
        phoneNumber: (profile as any).phoneNumber || '',
        shareContactInfo: (profile as any).shareContactInfo || false,
      });
    }
  }, [profile]);

  const handleSave = async () => {
    if (!user || !db) return;
    setLoading(true);

    const userRef = doc(db, 'userProfiles', user.uid);
    const updateData = {
      ...formData,
      updatedAt: new Date().toISOString(),
    };

    try {
      await updateDoc(userRef, updateData);
      toast({ title: "Settings Saved", description: "Your profile has been updated." });
    } catch (error: any) {
      toast({ title: "Save Failed", description: error.message || "Could not save your settings. Please try again.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold font-headline">Privacy & Settings</h1>
          <p className="text-muted-foreground">Manage your personal information and team visibility.</p>
        </header>

        <div className="max-w-2xl space-y-6">
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
          </Card>

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
                {OFFICERS.map((officer) => {
                  const tips: Record<string, string> = {
                    'Treasurer': 'Payment questions',
                    'Secretary': 'Registration questions',
                  };
                  const tip = tips[officer.title];
                  return (
                    <div key={officer.title} className="flex items-center justify-between py-3">
                      <div>
                        <p className="text-sm text-muted-foreground">{officer.title}</p>
                        {tip && <p className="text-[10px] text-muted-foreground/70">{tip}</p>}
                      </div>
                      <p className="text-sm font-semibold">{officer.name ?? <span className="text-muted-foreground italic font-normal">TBA</span>}</p>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

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
              <Button onClick={handleSave} className="w-full h-11 rounded-xl" disabled={loading}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Privacy Settings
              </Button>
            </CardFooter>
          </Card>
        </div>
      </main>
    </div>
  );
}
