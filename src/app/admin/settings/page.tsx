"use client";

import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Settings, Save, Bell, CreditCard, Lock, Construction } from 'lucide-react';

export default function AdminSettingsPage() {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8">
        <header className="mb-8">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold font-headline">Global System Settings</h1>
            <span className="flex items-center gap-1 text-xs font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full border border-amber-200">
              <Construction className="h-3 w-3" /> Coming Soon
            </span>
          </div>
          <p className="text-muted-foreground">Configure association-wide parameters and security. Settings below are read-only previews.</p>
        </header>

        <div className="grid gap-8 max-w-4xl">
          <Card className="border-none shadow-md">
            <CardHeader className="flex flex-row items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                <Bell className="h-5 w-5" />
              </div>
              <div>
                <CardTitle>Notifications</CardTitle>
                <CardDescription>Manage automated broadcast settings</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Email Alerts</Label>
                  <p className="text-xs text-muted-foreground">Send automated emails for game rainouts</p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>In-App Broadcasts</Label>
                  <p className="text-xs text-muted-foreground">Enable site-wide banners for league announcements</p>
                </div>
                <Switch defaultChecked />
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-md">
            <CardHeader className="flex flex-row items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                <CreditCard className="h-5 w-5" />
              </div>
              <div>
                <CardTitle>Payments</CardTitle>
                <CardDescription>Configure Stripe integration and financial settings</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Stripe Public Key</Label>
                <Input placeholder="pk_test_..." value="pk_test_mock_values_syba" readOnly />
              </div>
              <div className="flex items-center justify-between pt-2">
                <div className="space-y-0.5">
                  <Label>Test Mode</Label>
                  <p className="text-xs text-muted-foreground">Use sandbox environment for all transactions</p>
                </div>
                <Switch defaultChecked />
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-md">
            <CardHeader className="flex flex-row items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center text-red-600">
                <Lock className="h-5 w-5" />
              </div>
              <div>
                <CardTitle>Security</CardTitle>
                <CardDescription>Manage system access rules</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>New User Registration</Label>
                  <p className="text-xs text-muted-foreground">Allow public account creation</p>
                </div>
                <Switch defaultChecked />
              </div>
              <Button className="w-full rounded-xl" disabled title="Settings management coming in a future release">
                <Save className="mr-2 h-4 w-4" /> Save System Settings
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
