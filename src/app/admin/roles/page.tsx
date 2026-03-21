
"use client";

import { useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { updateDoc, doc, collection, setDoc, deleteDoc } from 'firebase/firestore';
import { useFirestore, useMemoFirebase, useCollection, useUser } from '@/firebase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ShieldCheck, User as UserIcon, Lock, Trash2, Plus, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import Link from 'next/link';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut as firebaseSignOut, sendPasswordResetEmail } from 'firebase/auth';
import { firebaseConfig } from '@/firebase/config';
import { OFFICER_TITLES } from '@/data/officers';

const ALL_ROLES = ['Parent', 'Coach', 'Board Member', 'Admin'] as const;
type Role = typeof ALL_ROLES[number];

interface UserData {
  id: string;
  email: string;
  displayName: string;
  role: string;
  roles?: string[];
  officerTitle?: string;
}

function getUserRoles(user: UserData): string[] {
  if (user.roles && user.roles.length > 0) return user.roles;
  return [user.role];
}

const EMPTY_NEW_USER = {
  displayName: '',
  email: '',
  password: '',
  roles: ['Parent'] as string[],
};

export default function RolesPage() {
  const db = useFirestore();
  const { toast } = useToast();
  const { isAdmin, loading: loadingUser } = useUser();

  // Create user dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newUser, setNewUser] = useState(EMPTY_NEW_USER);

  // Remove user dialog
  const [removeTarget, setRemoveTarget] = useState<UserData | null>(null);
  const [removing, setRemoving] = useState(false);

  const usersQuery = useMemoFirebase(() => {
    if (!db || !isAdmin) return null;
    return collection(db, 'userProfiles');
  }, [db, isAdmin]);

  const { data: users, isLoading } = useCollection<UserData>(usersQuery);

  const handleRoleToggle = async (uid: string, role: Role, currentRoles: string[], checked: boolean) => {
    const newRoles = checked
      ? [...new Set([...currentRoles, role])]
      : currentRoles.filter((r) => r !== role);

    if (newRoles.length === 0) {
      toast({ title: "Cannot Remove All Roles", description: "A user must have at least one role.", variant: "destructive" });
      return;
    }

    const userRef = doc(db, 'userProfiles', uid);
    const primaryRole = newRoles.includes('Admin') ? 'Admin'
      : newRoles.includes('Coach') ? 'Coach'
      : newRoles.includes('Board Member') ? 'Admin'
      : 'Parent';

    updateDoc(userRef, { roles: newRoles, role: primaryRole })
      .then(() => {
        toast({ title: "Roles Updated", description: `User roles updated to: ${newRoles.join(', ')}.` });
      })
      .catch((error: any) => {
        toast({ title: "Update Failed", description: error.message || "Could not update user roles.", variant: "destructive" });
      });
  };

  const handleOfficerTitleChange = async (uid: string, title: string) => {
    const userRef = doc(db, 'userProfiles', uid);
    updateDoc(userRef, { officerTitle: title === 'none' ? null : title })
      .then(() => toast({ title: "Title Updated" }))
      .catch((error: any) => toast({ title: "Update Failed", description: error.message, variant: "destructive" }));
  };

  const handleCreateUser = async () => {
    if (!newUser.displayName.trim() || !newUser.email.trim() || newUser.password.length < 8) {
      toast({ title: "Missing Fields", description: "Name, email, and a password of at least 8 characters are required.", variant: "destructive" });
      return;
    }
    setCreating(true);
    const appName = `user-creator-${Date.now()}`;
    let secondaryApp: any = null;
    try {
      secondaryApp = initializeApp(firebaseConfig, appName);
      const secondaryAuth = getAuth(secondaryApp);
      const { user } = await createUserWithEmailAndPassword(secondaryAuth, newUser.email.trim(), newUser.password);

      const primaryRole = newUser.roles.includes('Admin') ? 'Admin'
        : newUser.roles.includes('Coach') ? 'Coach'
        : newUser.roles.includes('Board Member') ? 'Admin'
        : 'Parent';

      try {
        await setDoc(doc(db, 'userProfiles', user.uid), {
          id: user.uid,
          displayName: newUser.displayName.trim(),
          email: newUser.email.trim().toLowerCase(),
          role: primaryRole,
          roles: newUser.roles,
          createdAt: new Date().toISOString(),
        });
      } catch (firestoreError: any) {
        // H10: Firestore write failed — clean up orphaned Auth account
        await secondaryAuth.currentUser?.delete().catch(() => {});
        throw firestoreError;
      }

      await firebaseSignOut(secondaryAuth);
      toast({ title: "User Created", description: "Share the temporary password with them." });
      setNewUser(EMPTY_NEW_USER);
      setCreateOpen(false);
    } catch (error: any) {
      toast({ title: "Creation Failed", description: error.message, variant: "destructive" });
    } finally {
      if (secondaryApp) await deleteApp(secondaryApp);
      setCreating(false);
    }
  };

  const handleRemoveUser = async () => {
    if (!removeTarget || !db) return;
    setRemoving(true);
    try {
      await deleteDoc(doc(db, 'userProfiles', removeTarget.id));
      toast({ title: "User Removed", description: `${removeTarget.displayName} has been removed from the portal.` });
      setRemoveTarget(null);
    } catch (error: any) {
      toast({ title: "Removal Failed", description: error.message, variant: "destructive" });
    } finally {
      setRemoving(false);
    }
  };

  const handlePasswordReset = async (email: string, name: string) => {
    try {
      const auth = getAuth();
      await sendPasswordResetEmail(auth, email);
      toast({ title: "Reset Email Sent", description: `Password reset email sent to ${name}.` });
    } catch (error: any) {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
    }
  };

  if (loadingUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8 flex items-center justify-center">
          <Card className="max-w-md text-center border-none shadow-xl">
            <CardHeader>
              <Lock className="h-12 w-12 text-destructive mx-auto mb-4" />
              <CardTitle className="font-headline text-2xl">Access Denied</CardTitle>
              <CardDescription>You do not have the required permissions to manage system roles.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="rounded-full px-8">
                <Link href="/">Return Home</Link>
              </Button>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8">
        <header className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold font-headline">User Role Management</h1>
            <p className="text-muted-foreground">Assign roles, officer titles, and manage portal access.</p>
          </div>
          <Button className="rounded-full px-6" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Add User
          </Button>
        </header>

        <Card className="border-none shadow-xl overflow-hidden">
          <CardHeader className="bg-primary text-primary-foreground">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-6 w-6" />
              <div>
                <CardTitle className="text-xl font-headline">System Users</CardTitle>
                <CardDescription className="text-primary-foreground/80">
                  Manage the {users?.length || 0} registered accounts
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex justify-center items-center py-20">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
              </div>
            ) : !users || users.length === 0 ? (
              <div className="text-center py-20 text-muted-foreground">No users found.</div>
            ) : (
              <div className="overflow-x-auto w-full">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-6">User</TableHead>
                      <TableHead className="hidden md:table-cell">Email</TableHead>
                      {ALL_ROLES.map((role) => (
                        <TableHead key={role} className="text-center hidden md:table-cell">{role}</TableHead>
                      ))}
                      <TableHead className="hidden md:table-cell">Officer Title</TableHead>
                      <TableHead className="w-24" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((user) => {
                      const userRoles = getUserRoles(user);
                      const isBoardMember = userRoles.includes('Board Member');
                      return (
                        <TableRow key={user.id} className="group hover:bg-secondary/20 transition-colors">
                          <TableCell className="pl-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold overflow-hidden">
                                {user.displayName ? user.displayName[0].toUpperCase() : <UserIcon className="h-5 w-5" />}
                              </div>
                              <div>
                                <span className="font-semibold">{user.displayName || 'Unnamed User'}</span>
                                <div className="flex flex-wrap gap-1 mt-0.5">
                                  {userRoles.map((r) => (
                                    <Badge
                                      key={r}
                                      variant={r === 'Admin' ? 'default' : r === 'Coach' ? 'secondary' : 'outline'}
                                      className="rounded-full px-2 text-[10px]"
                                    >
                                      {r}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="hidden md:table-cell">{user.email}</TableCell>
                          {ALL_ROLES.map((role) => (
                            <TableCell key={role} className="text-center hidden md:table-cell">
                              <Checkbox
                                checked={userRoles.includes(role)}
                                onCheckedChange={(checked) =>
                                  handleRoleToggle(user.id, role, userRoles, !!checked)
                                }
                              />
                            </TableCell>
                          ))}
                          <TableCell className="hidden md:table-cell">
                            {isBoardMember ? (
                              <Select
                                value={user.officerTitle || 'none'}
                                onValueChange={(val) => handleOfficerTitleChange(user.id, val)}
                              >
                                <SelectTrigger className="rounded-xl w-48 text-xs h-8">
                                  <SelectValue placeholder="Assign title…" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">— No Title —</SelectItem>
                                  {OFFICER_TITLES.map((t) => (
                                    <SelectItem key={t} value={t}>{t}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="pr-4">
                            <div className="flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 text-muted-foreground hover:text-primary"
                                title="Send password reset email"
                                onClick={() => handlePasswordReset(user.email, user.displayName || user.email)}
                              >
                                <Mail className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                title="Remove user"
                                onClick={() => setRemoveTarget(user)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      {/* Create User Dialog */}
      <Dialog open={createOpen} onOpenChange={(o) => { if (!creating) { setCreateOpen(o); if (!o) setNewUser(EMPTY_NEW_USER); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-headline">Add New User</DialogTitle>
            <DialogDescription>Create a portal account. Share the temporary password with the user — they should change it on first login.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Display Name</Label>
              <Input
                className="rounded-xl"
                placeholder="Jane Smith"
                value={newUser.displayName}
                onChange={(e) => setNewUser({ ...newUser, displayName: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                className="rounded-xl"
                placeholder="jane@example.com"
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Temporary Password</Label>
              <Input
                type="password"
                className="rounded-xl"
                placeholder="Min. 8 characters"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Roles</Label>
              <div className="flex flex-wrap gap-3 pt-1">
                {ALL_ROLES.map((role) => (
                  <label key={role} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={newUser.roles.includes(role)}
                      onCheckedChange={(checked) => {
                        const next = checked
                          ? [...new Set([...newUser.roles, role])]
                          : newUser.roles.filter((r) => r !== role);
                        if (next.length > 0) setNewUser({ ...newUser, roles: next });
                      }}
                    />
                    {role}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</Button>
            <Button onClick={handleCreateUser} disabled={creating}>
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Create User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove User Dialog */}
      <Dialog open={!!removeTarget} onOpenChange={(o) => { if (!removing && !o) setRemoveTarget(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-headline">Remove User?</DialogTitle>
            <DialogDescription>
              <strong>{removeTarget?.displayName || removeTarget?.email}</strong> will no longer be able to access the portal. Their Firebase Auth account will remain. Note: subcollection data (enrollments, players, clearances) may not be fully removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveTarget(null)} disabled={removing}>Cancel</Button>
            <Button variant="destructive" onClick={handleRemoveUser} disabled={removing}>
              {removing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
