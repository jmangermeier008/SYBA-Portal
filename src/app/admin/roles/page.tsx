
"use client";

import { Sidebar } from '@/components/navigation/sidebar';
import { updateDoc, doc, collection } from 'firebase/firestore';
import { useFirestore, useMemoFirebase, useCollection, useUser } from '@/firebase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ShieldCheck, User as UserIcon, Lock, UserCog } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import Link from 'next/link';

interface UserData {
  id: string;
  email: string;
  displayName: string;
  role: string;
  isAlsoCoach?: boolean;
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

  const handleRoleChange = async (uid: string, newRole: string) => {
    const userRef = doc(db, 'userProfiles', uid);
    const updateData: any = { role: newRole };
    // Clear the isAlsoCoach flag if the user is no longer an Admin
    if (newRole !== 'Admin') {
      updateData.isAlsoCoach = false;
    }
    updateDoc(userRef, updateData)
      .then(() => {
        toast({ title: "Role Updated", description: `User role has been changed to ${newRole}.` });
      })
      .catch((error) => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
          path: userRef.path,
          operation: 'update',
          requestResourceData: updateData
        }));
      });
  };

  const handleToggleAlsoCoach = async (uid: string, currentValue: boolean) => {
    const userRef = doc(db, 'userProfiles', uid);
    const updateData = { isAlsoCoach: !currentValue };
    updateDoc(userRef, updateData)
      .then(() => {
        toast({
          title: !currentValue ? "Coach Access Granted" : "Coach Access Removed",
          description: !currentValue
            ? "This admin can now access coach dashboards."
            : "Coach dashboard access has been removed.",
        });
      })
      .catch((error: any) => {
        if (error?.code === 'permission-denied') {
          errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: userRef.path,
            operation: 'update',
            requestResourceData: updateData
          }));
        } else {
          console.error('[roles] Update error:', error);
        }
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
        <Sidebar role="parent" />
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
      <Sidebar role="admin" />
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold font-headline">User Role Management</h1>
          <p className="text-muted-foreground">Manage system access levels for SYBA parents, coaches, and admins.</p>
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
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-6">User</TableHead>
                    <TableHead className="hidden md:table-cell">Email</TableHead>
                    <TableHead>Current Role</TableHead>
                    <TableHead className="text-center hidden md:table-cell">Also Coach?</TableHead>
                    <TableHead className="pr-6 text-right">Change Role</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
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
                            {user.isAlsoCoach && (
                              <div className="flex items-center gap-1 mt-0.5">
                                <UserCog className="h-3 w-3 text-primary" />
                                <span className="text-[10px] text-primary font-medium">Also Coach</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">{user.email}</TableCell>
                      <TableCell>
                        <Badge
                          variant={user.role === 'Admin' ? 'default' : user.role === 'Coach' ? 'secondary' : 'outline'}
                          className="rounded-full px-4"
                        >
                          {user.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center hidden md:table-cell">
                        {user.role === 'Admin' ? (
                          <Switch
                            checked={!!user.isAlsoCoach}
                            onCheckedChange={() => handleToggleAlsoCoach(user.id, !!user.isAlsoCoach)}
                            title="Allow this admin to also access coach dashboards"
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="pr-6 text-right">
                        <Select
                          defaultValue={user.role}
                          onValueChange={(val) => handleRoleChange(user.id, val)}
                        >
                          <SelectTrigger className="w-[130px] rounded-xl ml-auto">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Parent">Parent</SelectItem>
                            <SelectItem value="Coach">Coach</SelectItem>
                            <SelectItem value="Admin">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
