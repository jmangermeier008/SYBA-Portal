
"use client";

import { Sidebar } from '@/components/navigation/sidebar';
import { updateDoc, doc, collection } from 'firebase/firestore';
import { useFirestore, useMemoFirebase, useCollection, useUser } from '@/firebase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ShieldCheck, User as UserIcon, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import Link from 'next/link';

const ALL_ROLES = ['Parent', 'Coach', 'Board Member', 'Admin'] as const;
type Role = typeof ALL_ROLES[number];

interface UserData {
  id: string;
  email: string;
  displayName: string;
  role: string;
  roles?: string[];
}

function getUserRoles(user: UserData): string[] {
  if (user.roles && user.roles.length > 0) return user.roles;
  return [user.role];
}

export default function RolesPage() {
  const db = useFirestore();
  const { toast } = useToast();
  const { isAdmin, loading: loadingUser } = useUser();

  const usersQuery = useMemoFirebase(() => {
    if (!db || !isAdmin) return null;
    return collection(db, 'userProfiles');
  }, [db, isAdmin]);

  const { data: users, isLoading } = useCollection<UserData>(usersQuery);

  const handleRoleToggle = async (uid: string, role: Role, currentRoles: string[], checked: boolean) => {
    const newRoles = checked
      ? [...new Set([...currentRoles, role])]
      : currentRoles.filter((r) => r !== role);

    // Must keep at least one role
    if (newRoles.length === 0) {
      toast({ title: "Cannot Remove All Roles", description: "A user must have at least one role.", variant: "destructive" });
      return;
    }

    const userRef = doc(db, 'userProfiles', uid);
    // Keep legacy 'role' field in sync with primary role for backward compat
    const primaryRole = newRoles.includes('Admin') ? 'Admin'
      : newRoles.includes('Coach') ? 'Coach'
      : newRoles.includes('Board Member') ? 'Admin' // Board Member maps to Admin in legacy field
      : 'Parent';

    const updateData = { roles: newRoles, role: primaryRole };

    updateDoc(userRef, updateData)
      .then(() => {
        toast({ title: "Roles Updated", description: `User roles updated to: ${newRoles.join(', ')}.` });
      })
      .catch((error: any) => {
        toast({ title: "Update Failed", description: error.message || "Could not update user roles.", variant: "destructive" });
      });
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
        <header className="mb-8">
          <h1 className="text-3xl font-bold font-headline">User Role Management</h1>
          <p className="text-muted-foreground">Assign one or more roles to each user. Users see all sections for every role they hold.</p>
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
              <div className="text-center py-20 text-muted-foreground">
                No users found.
              </div>
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => {
                    const userRoles = getUserRoles(user);
                    return (
                      <TableRow key={user.id} className="group hover:bg-secondary/20 transition-colors">
                        <TableCell className="pl-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold overflow-hidden">
                              {user.displayName ? (
                                user.displayName[0].toUpperCase()
                              ) : (
                                <UserIcon className="h-5 w-5" />
                              )}
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
    </div>
  );
}
