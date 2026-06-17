
"use client";

import { useState, useMemo, useEffect } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { updateDoc, doc, collection, setDoc, deleteDoc, deleteField } from 'firebase/firestore';
import { useFirestore, useMemoFirebase, useCollection, useUser } from '@/firebase';
import { useSport } from '@/firebase/sport-context';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ShieldCheck, User as UserIcon, Lock, Trash2, Plus, Mail, Pencil, Search, ToggleLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import Link from 'next/link';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut as firebaseSignOut, sendPasswordResetEmail } from 'firebase/auth';
import { firebaseConfig } from '@/firebase/config';
import { OFFICER_TITLES } from '@/data/officers';
import type { SportRole } from '@/types/scheduling';

// 'Parent' is no longer assignable — all authenticated users are implicit parents.
// 'Site Admin' is toggled via a dedicated boolean field, not via this array.
const ALL_SPORT_ROLES: SportRole[] = ['Coach', 'Board Member', 'Admin'];

interface UserData {
  id: string;
  email: string;
  displayName: string;
  isSiteAdmin?: boolean;
  role?: string;
  roles?: string[];
  sportRoles?: Record<string, string[]>;
  officerTitle?: string;
  officerTitles?: string[];
  phoneNumber?: string;
}

function getUserSportRoles(user: UserData, sport: string): string[] {
  if (user.sportRoles?.[sport]?.length) return user.sportRoles[sport];
  return [];
}

function getRoleBadgeVariant(role: string): 'destructive' | 'default' | 'secondary' | 'outline' {
  if (role === 'Site Admin') return 'destructive';
  if (role === 'Admin') return 'default';
  if (role === 'Coach') return 'secondary';
  return 'outline';
}

function getUserDisplayRoles(user: UserData, sport: string | null): string[] {
  if (user.isSiteAdmin) return ['Site Admin'];
  if (sport) return getUserSportRoles(user, sport);
  // "All Sports" view — flatten all sport roles deduplicated
  const all = Object.values(user.sportRoles ?? {}).flat();
  return [...new Set(all)];
}

const EMPTY_NEW_USER = {
  displayName: '',
  email: '',
  password: '',
  roles: [] as string[],
};

export default function RolesPage() {
  const db = useFirestore();
  const { toast } = useToast();
  const { isSiteAdmin, loading: loadingUser } = useUser();
  const { activeSport, isBoardMember } = useSport();

  // Create user dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newUser, setNewUser] = useState(EMPTY_NEW_USER);

  // Remove user dialog
  const [removeTarget, setRemoveTarget] = useState<UserData | null>(null);
  const [removing, setRemoving] = useState(false);

  // Mobile edit roles dialog
  const [editTarget, setEditTarget] = useState<UserData | null>(null);

  // Grant sport access dialog
  const [grantAccessOpen, setGrantAccessOpen] = useState(false);
  const [grantAccessSearch, setGrantAccessSearch] = useState('');

  // Edit user profile dialog
  const [editUserDialog, setEditUserDialog] = useState<{
    open: boolean;
    user: UserData | null;
    form: { displayName: string; phoneNumber: string };
    loading: boolean;
  }>({ open: false, user: null, form: { displayName: '', phoneNumber: '' }, loading: false });

  // Board Members are locked to their active sport; Site Admins can see all sports
  const [sportFilter, setSportFilter] = useState<string>('all');
  useEffect(() => {
    if (activeSport) {
      // Board members (non-site-admin) are locked to their sport
      setSportFilter(activeSport);
    }
  }, [activeSport]);

  const usersQuery = useMemoFirebase(() => {
    if (!db) return null;
    if (!isSiteAdmin && !isBoardMember) return null;
    return collection(db, 'userProfiles');
  }, [db, isSiteAdmin, isBoardMember]);

  const { data: users, isLoading } = useCollection<UserData>(usersQuery);

  // Officer titles are now admin-defined per sport (officers collection). The title picker
  // reads the live list instead of a hardcoded array.
  const officersQuery = useMemoFirebase(() => {
    if (!db) return null;
    if (!isSiteAdmin && !isBoardMember) return null;
    return collection(db, 'officers');
  }, [db, isSiteAdmin, isBoardMember]);
  const { data: officerRecords } = useCollection<{ id: string; title: string; sport?: string; order?: number }>(officersQuery);

  const availableTitles = useMemo(() => {
    const fromDirectory = (officerRecords ?? [])
      .filter((o) => sportFilter === 'all' || o.sport === sportFilter)
      .map((o) => o.title);
    // Union with seed defaults so the picker is never empty before any role is saved.
    const merged = [...new Set([...OFFICER_TITLES, ...fromDirectory])];
    return merged.sort((a, b) => a.localeCompare(b));
  }, [officerRecords, sportFilter]);

  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');

  const usersWithoutSportAccess = useMemo(() => {
    if (!users || sportFilter === 'all') return [];
    return users.filter((user) => {
      if (user.isSiteAdmin) return false;
      return user.sportRoles?.[sportFilter] === undefined;
    });
  }, [users, sportFilter]);

  const filteredGrantUsers = useMemo(() => {
    if (!grantAccessSearch.trim()) return usersWithoutSportAccess;
    const q = grantAccessSearch.toLowerCase();
    return usersWithoutSportAccess.filter(u =>
      u.displayName?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q)
    );
  }, [usersWithoutSportAccess, grantAccessSearch]);

  const filteredUsers = useMemo(() => {
    if (!users) return [];
    const activeSportFilter = sportFilter !== 'all' ? sportFilter : null;
    return users.filter((user) => {
      const displayRoles = getUserDisplayRoles(user, activeSportFilter);
      const matchesSearch =
        !searchQuery ||
        user.displayName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        user.email?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesSport =
        sportFilter === 'all' || user.sportRoles?.[sportFilter] !== undefined || user.isSiteAdmin;
      const matchesRole =
        roleFilter === 'all' || displayRoles.includes(roleFilter);
      return matchesSearch && matchesSport && matchesRole;
    });
  }, [users, searchQuery, roleFilter, sportFilter]);

  const handleRoleToggle = async (uid: string, role: SportRole, sport: string, checked: boolean) => {
    const current = getUserSportRoles(users?.find(u => u.id === uid)!, sport);
    const updated = checked
      ? [...new Set([...current, role])]
      : current.filter((r) => r !== role);

    const userRef = doc(db, 'userProfiles', uid);
    updateDoc(userRef, { [`sportRoles.${sport}`]: updated })
      .then(() => {
        toast({ title: "Roles Updated", description: `Updated ${role} for ${sport}.` });
      })
      .catch((error: any) => {
        toast({ title: "Update Failed", description: error.message || "Could not update roles.", variant: "destructive" });
      });
  };

  const handleSiteAdminToggle = async (uid: string, enabled: boolean) => {
    const userRef = doc(db, 'userProfiles', uid);
    updateDoc(userRef, { isSiteAdmin: enabled })
      .then(() => toast({ title: enabled ? "Site Admin Granted" : "Site Admin Removed" }))
      .catch((error: any) => toast({ title: "Update Failed", description: error.message, variant: "destructive" }));
  };

  const handleOfficerTitlesChange = async (uid: string, titles: string[]) => {
    const userRef = doc(db, 'userProfiles', uid);
    updateDoc(userRef, { officerTitles: titles })
      .then(() => toast({ title: "Titles Updated" }))
      .catch((error: any) => toast({ title: "Update Failed", description: error.message, variant: "destructive" }));
  };

  const handleSportAccessToggle = async (uid: string, sport: string, enabled: boolean) => {
    const userRef = doc(db, 'userProfiles', uid);
    const updateData: Record<string, any> = enabled
      ? { [`sportRoles.${sport}`]: [] }
      : { [`sportRoles.${sport}`]: deleteField() };
    updateDoc(userRef, updateData)
      .then(() => {
        toast({
          title: enabled ? "Sport Access Granted" : "Sport Access Removed",
          description: enabled
            ? `User now has access to the ${sport} portal.`
            : `User's ${sport} access has been revoked.`,
        });
      })
      .catch((error: any) => {
        toast({ title: "Update Failed", description: error.message, variant: "destructive" });
      });
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

      try {
        await setDoc(doc(db, 'userProfiles', user.uid), {
          id: user.uid,
          displayName: newUser.displayName.trim(),
          email: newUser.email.trim().toLowerCase(),
          ...(activeSport && newUser.roles.length > 0 ? { sportRoles: { [activeSport]: newUser.roles } } : {}),
          createdAt: new Date().toISOString(),
        });
      } catch (firestoreError: any) {
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

  const handleSaveUserEdit = async () => {
    if (!db || !editUserDialog.user) return;
    setEditUserDialog(prev => ({ ...prev, loading: true }));
    try {
      await updateDoc(doc(db, 'userProfiles', editUserDialog.user.id), {
        displayName: editUserDialog.form.displayName.trim(),
        phoneNumber: editUserDialog.form.phoneNumber.trim(),
        updatedAt: new Date().toISOString(),
      });
      toast({ title: "User Updated" });
      setEditUserDialog(prev => ({ ...prev, open: false }));
    } catch (error: any) {
      toast({ title: "Update Failed", description: error.message, variant: "destructive" });
    } finally {
      setEditUserDialog(prev => ({ ...prev, loading: false }));
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

  if (!isSiteAdmin && !isBoardMember) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6 flex items-center justify-center">
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

  const activeSportFilter = sportFilter !== 'all' ? sportFilter : null;

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6">
        <header className="mb-4 md:mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl md:text-2xl font-bold font-headline">User Role Management</h1>
            <p className="text-sm text-muted-foreground">Assign roles, officer titles, and manage portal access.</p>
          </div>
          <Button className="rounded-full px-6" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Add User
          </Button>
        </header>

        <div className="mb-6 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or email…"
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          {/* Board members are locked to their sport; site admins can see all */}
          <Select
            value={sportFilter}
            onValueChange={setSportFilter}
            disabled={!isSiteAdmin}
          >
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue placeholder="All Sports" />
            </SelectTrigger>
            <SelectContent>
              {isSiteAdmin && <SelectItem value="all">All Sports</SelectItem>}
              <SelectItem value="baseball">Baseball</SelectItem>
              <SelectItem value="football">Football</SelectItem>
            </SelectContent>
          </Select>
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="All Roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              {isSiteAdmin && <SelectItem value="Site Admin">Site Admin</SelectItem>}
              {ALL_SPORT_ROLES.map((r) => (
                <SelectItem key={r} value={r}>{r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {activeSportFilter && isSiteAdmin && (
            <Button
              variant="outline"
              className="rounded-full px-4 shrink-0"
              onClick={() => { setGrantAccessSearch(''); setGrantAccessOpen(true); }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Grant {activeSportFilter.charAt(0).toUpperCase() + activeSportFilter.slice(1)} Access
            </Button>
          )}
        </div>

        <Card className="border-none shadow-xl overflow-hidden">
          <CardHeader className="bg-primary text-primary-foreground">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-6 w-6" />
              <div>
                <CardTitle className="text-xl font-headline">System Users</CardTitle>
                <CardDescription className="text-primary-foreground/80">
                  {roleFilter !== 'all' || searchQuery
                    ? `Showing ${filteredUsers.length} of ${users?.length || 0} registered accounts`
                    : `Manage the ${users?.length || 0} registered accounts`}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex justify-center items-center py-12">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
              </div>
            ) : !users || users.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">No users found.</div>
            ) : filteredUsers.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">No users match your filters.</div>
            ) : (
              <>
                {/* ── Desktop table ─────────────────────────────────────── */}
                <div className="hidden md:block overflow-x-auto w-full">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="pl-6">User</TableHead>
                        <TableHead>Email</TableHead>
                        {activeSportFilter && (
                          <TableHead className="text-center">
                            <div className="flex items-center justify-center gap-1">
                              <ToggleLeft className="h-3.5 w-3.5" />
                              Sport Access
                            </div>
                          </TableHead>
                        )}
                        {activeSportFilter && ALL_SPORT_ROLES.map((role) => (
                          <TableHead key={role} className="text-center">{role}</TableHead>
                        ))}
                        {isSiteAdmin && <TableHead className="text-center">Site Admin</TableHead>}
                        <TableHead>Officer Titles</TableHead>
                        <TableHead className="w-24" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredUsers.map((user) => {
                        const sportRoles = activeSportFilter ? getUserSportRoles(user, activeSportFilter) : [];
                        const isBoardMemberUser = sportRoles.includes('Board Member') || sportRoles.includes('Admin') || user.isSiteAdmin;
                        const userSports = Object.entries(user.sportRoles ?? {})
                          .filter(([, roles]) => roles.length > 0)
                          .map(([sport]) => sport);
                        const displayRoles = getUserDisplayRoles(user, activeSportFilter);
                        return (
                          <TableRow key={user.id} className="group hover:bg-secondary/20 transition-colors">
                            <TableCell className="pl-6 py-3">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold overflow-hidden">
                                  {user.displayName ? user.displayName[0].toUpperCase() : <UserIcon className="h-5 w-5" />}
                                </div>
                                <div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-semibold">{user.displayName || 'Unnamed User'}</span>
                                    {userSports.includes('baseball') && (
                                      <span className="text-[9px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">BB</span>
                                    )}
                                    {userSports.includes('football') && (
                                      <span className="text-[9px] font-bold bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full">FB</span>
                                    )}
                                  </div>
                                  <div className="flex flex-wrap gap-1 mt-0.5">
                                    {displayRoles.map((r) => (
                                      <Badge
                                        key={r}
                                        variant={getRoleBadgeVariant(r)}
                                        className="rounded-full px-2 text-[10px]"
                                      >
                                        {r}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>{user.email}</TableCell>
                            {activeSportFilter && (
                              <TableCell className="text-center">
                                {user.isSiteAdmin ? (
                                  <span className="text-[10px] font-medium text-muted-foreground">Full Access</span>
                                ) : (
                                  <div className="flex justify-center">
                                    <Switch
                                      checked={(user.sportRoles?.[activeSportFilter] !== undefined)}
                                      onCheckedChange={(enabled) =>
                                        handleSportAccessToggle(user.id, activeSportFilter, enabled)
                                      }
                                    />
                                  </div>
                                )}
                              </TableCell>
                            )}
                            {activeSportFilter && ALL_SPORT_ROLES.map((role) => (
                              <TableCell key={role} className="text-center">
                                <Checkbox
                                  checked={sportRoles.includes(role)}
                                  onCheckedChange={(checked) =>
                                    handleRoleToggle(user.id, role, activeSportFilter, !!checked)
                                  }
                                />
                              </TableCell>
                            ))}
                            {isSiteAdmin && (
                              <TableCell className="text-center">
                                <div className="flex justify-center">
                                  <Switch
                                    checked={user.isSiteAdmin === true}
                                    onCheckedChange={(enabled) => handleSiteAdminToggle(user.id, enabled)}
                                  />
                                </div>
                              </TableCell>
                            )}
                            <TableCell>
                              {isBoardMemberUser ? (() => {
                                const currentTitles = user.officerTitles ?? (user.officerTitle ? [user.officerTitle] : []);
                                return (
                                  <Popover>
                                    <PopoverTrigger asChild>
                                      <Button variant="outline" size="sm" className="rounded-xl w-48 text-xs h-8 justify-start font-normal truncate">
                                        {currentTitles.length > 0 ? currentTitles.join(', ') : '— No Titles —'}
                                      </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-64 p-3" align="start">
                                      <p className="text-xs font-semibold mb-2 text-muted-foreground">Assign Officer Titles</p>
                                      <div className="space-y-1.5 max-h-64 overflow-y-auto">
                                        {availableTitles.map((t) => (
                                          <label key={t} className="flex items-center gap-2 text-xs cursor-pointer">
                                            <Checkbox
                                              checked={currentTitles.includes(t)}
                                              onCheckedChange={(checked) => {
                                                const next = checked
                                                  ? [...currentTitles, t]
                                                  : currentTitles.filter((x) => x !== t);
                                                handleOfficerTitlesChange(user.id, next);
                                              }}
                                            />
                                            {t}
                                          </label>
                                        ))}
                                      </div>
                                    </PopoverContent>
                                  </Popover>
                                );
                              })() : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="pr-4">
                              <div className="flex items-center gap-1 opacity-100 group-hover:opacity-100 transition-opacity">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8 text-muted-foreground hover:text-primary"
                                  title="Edit profile"
                                  onClick={() => setEditUserDialog({
                                    open: true,
                                    user,
                                    form: { displayName: user.displayName || '', phoneNumber: user.phoneNumber || '' },
                                    loading: false,
                                  })}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
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

                {/* ── Mobile card list ───────────────────────────────────── */}
                <div className="md:hidden divide-y">
                  {filteredUsers.map((user) => {
                    const displayRoles = getUserDisplayRoles(user, activeSportFilter);
                    const userSports = Object.entries(user.sportRoles ?? {})
                      .filter(([, roles]) => roles.length > 0)
                      .map(([sport]) => sport);
                    return (
                      <div key={user.id} className="flex items-center gap-3 p-4">
                        <div className="w-10 h-10 shrink-0 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                          {user.displayName ? user.displayName[0].toUpperCase() : <UserIcon className="h-5 w-5" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="font-semibold truncate">{user.displayName || 'Unnamed User'}</p>
                            {userSports.includes('baseball') && (
                              <span className="text-[9px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">BB</span>
                            )}
                            {userSports.includes('football') && (
                              <span className="text-[9px] font-bold bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full">FB</span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {displayRoles.length > 0
                              ? displayRoles.map((r) => (
                                <Badge key={r} variant={getRoleBadgeVariant(r)} className="rounded-full px-2 text-[10px]">
                                  {r}
                                </Badge>
                              ))
                              : <span className="text-xs text-muted-foreground">No roles</span>
                            }
                          </div>
                        </div>
                        <div className="flex flex-col gap-1 shrink-0">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs rounded-full px-3"
                            onClick={() => setEditTarget(user)}
                          >
                            <ShieldCheck className="h-3.5 w-3.5 mr-1" />
                            Roles
                          </Button>
                          <div className="flex gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-muted-foreground hover:text-primary"
                              title="Edit profile"
                              onClick={() => setEditUserDialog({
                                open: true,
                                user,
                                form: { displayName: user.displayName || '', phoneNumber: user.phoneNumber || '' },
                                loading: false,
                              })}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              title="Remove user"
                              onClick={() => setRemoveTarget(user)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </main>

      {/* Grant Sport Access Dialog */}
      {activeSportFilter && (
        <Dialog open={grantAccessOpen} onOpenChange={(o) => { if (!o) setGrantAccessOpen(false); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="font-headline">
                Grant {activeSportFilter.charAt(0).toUpperCase() + activeSportFilter.slice(1)} Access
              </DialogTitle>
              <DialogDescription>
                Find an existing user and add them to the {activeSportFilter} portal. You can assign their roles after granting access.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or email…"
                  className="pl-9"
                  value={grantAccessSearch}
                  onChange={(e) => setGrantAccessSearch(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="max-h-72 overflow-y-auto space-y-0.5">
                {filteredGrantUsers.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    {grantAccessSearch.trim()
                      ? 'No users found matching that search.'
                      : `All existing users already have ${activeSportFilter} access.`}
                  </p>
                ) : filteredGrantUsers.map((user) => (
                  <button
                    key={user.id}
                    className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-secondary/40 transition-colors text-left"
                    onClick={async () => {
                      await handleSportAccessToggle(user.id, activeSportFilter, true);
                      setGrantAccessOpen(false);
                    }}
                  >
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                      {user.displayName ? user.displayName[0].toUpperCase() : <UserIcon className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{user.displayName || 'Unnamed User'}</p>
                      <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" className="rounded-full" onClick={() => setGrantAccessOpen(false)}>Cancel</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

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
            {activeSport && (
              <div className="space-y-1.5">
                <Label>Initial {activeSport.charAt(0).toUpperCase() + activeSport.slice(1)} Roles</Label>
                <div className="flex flex-wrap gap-3 pt-1">
                  {ALL_SPORT_ROLES.map((role) => (
                    <label key={role} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={newUser.roles.includes(role)}
                        onCheckedChange={(checked) => {
                          const next = checked
                            ? [...new Set([...newUser.roles, role])]
                            : newUser.roles.filter((r) => r !== role);
                          setNewUser({ ...newUser, roles: next });
                        }}
                      />
                      {role}
                    </label>
                  ))}
                </div>
              </div>
            )}
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

      {/* Mobile Edit Roles Dialog */}
      {(() => {
        const liveEditUser = editTarget ? (users?.find(u => u.id === editTarget.id) ?? editTarget) : null;
        const editSport = activeSportFilter ?? activeSport ?? '';
        const editRoles = liveEditUser && editSport ? getUserSportRoles(liveEditUser, editSport) : [];
        return (
          <Dialog open={!!editTarget} onOpenChange={(o) => { if (!o) setEditTarget(null); }}>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle className="font-headline">Edit Roles</DialogTitle>
                <DialogDescription>
                  {liveEditUser?.displayName || liveEditUser?.email}
                  {editSport && <span className="ml-1 text-muted-foreground">· {editSport}</span>}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2 py-2">
                {editSport ? ALL_SPORT_ROLES.map((role) => (
                  <div key={role} className="flex items-center gap-3 h-11">
                    <Checkbox
                      id={`mobile-role-${role}`}
                      checked={editRoles.includes(role)}
                      onCheckedChange={(checked) =>
                        liveEditUser && editSport && handleRoleToggle(liveEditUser.id, role, editSport, !!checked)
                      }
                    />
                    <Label htmlFor={`mobile-role-${role}`} className="flex-1 cursor-pointer text-sm">{role}</Label>
                  </div>
                )) : (
                  <p className="text-sm text-muted-foreground">Select a sport filter to edit roles.</p>
                )}
                {isSiteAdmin && liveEditUser && (
                  <div className="flex items-center gap-3 h-11 border-t pt-2 mt-2">
                    <Switch
                      id="mobile-site-admin"
                      checked={liveEditUser.isSiteAdmin === true}
                      onCheckedChange={(enabled) => handleSiteAdminToggle(liveEditUser.id, enabled)}
                    />
                    <Label htmlFor="mobile-site-admin" className="flex-1 cursor-pointer text-sm text-destructive font-medium">Site Admin</Label>
                  </div>
                )}
              </div>
              {liveEditUser && (editRoles.includes('Board Member') || editRoles.includes('Admin') || liveEditUser.isSiteAdmin) && (() => {
                const currentTitles = liveEditUser.officerTitles ?? (liveEditUser.officerTitle ? [liveEditUser.officerTitle] : []);
                return (
                  <div className="space-y-1.5 pt-2 border-t">
                    <Label className="text-xs text-muted-foreground">Officer Titles</Label>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {availableTitles.map((t) => (
                        <label key={t} className="flex items-center gap-2 text-xs cursor-pointer">
                          <Checkbox
                            checked={currentTitles.includes(t)}
                            onCheckedChange={(checked) => {
                              const next = checked
                                ? [...currentTitles, t]
                                : currentTitles.filter((x) => x !== t);
                              handleOfficerTitlesChange(liveEditUser.id, next);
                            }}
                          />
                          {t}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })()}
              <DialogFooter>
                <Button className="w-full rounded-full" onClick={() => setEditTarget(null)}>Done</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}

      {/* Edit User Dialog */}
      <Dialog open={editUserDialog.open} onOpenChange={(open) => !editUserDialog.loading && setEditUserDialog(prev => ({ ...prev, open }))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-headline">Edit User Profile</DialogTitle>
            <DialogDescription>Update display name and phone number. Email changes must be done via Firebase Console.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Email</Label>
              <p className="text-sm text-muted-foreground rounded-xl border bg-secondary/30 px-3 py-2">{editUserDialog.user?.email}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-user-name">Display Name</Label>
              <Input
                id="edit-user-name"
                className="rounded-xl"
                value={editUserDialog.form.displayName}
                onChange={e => setEditUserDialog(prev => ({ ...prev, form: { ...prev.form, displayName: e.target.value } }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-user-phone">Phone Number</Label>
              <Input
                id="edit-user-phone"
                type="tel"
                className="rounded-xl"
                placeholder="e.g. 724-555-0100"
                value={editUserDialog.form.phoneNumber}
                onChange={e => setEditUserDialog(prev => ({ ...prev, form: { ...prev.form, phoneNumber: e.target.value } }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditUserDialog({ open: false, user: null, form: { displayName: '', phoneNumber: '' }, loading: false })}
              disabled={editUserDialog.loading}
            >
              Cancel
            </Button>
            <Button onClick={handleSaveUserEdit} disabled={editUserDialog.loading || !editUserDialog.form.displayName.trim()}>
              {editUserDialog.loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Pencil className="mr-2 h-4 w-4" />}
              Save Changes
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
