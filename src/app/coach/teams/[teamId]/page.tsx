
"use client";

import { use, useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, collectionGroup, query, where } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Phone, 
  MessageSquare, 
  AlertTriangle, 
  Loader2, 
  CalendarCheck, 
  User as UserIcon,
  ChevronLeft,
  LifeBuoy,
  Users
} from 'lucide-react';
import Link from 'next/link';
import { differenceInYears } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface EmergencyContact {
  name: string;
  phone: string;
  relationship: string;
}

interface Player {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  medicalNotes?: string;
  parentUserId: string;
  emergencyContacts?: EmergencyContact[];
}

interface Enrollment {
  id: string;
  playerId: string;
  teamId: string;
  jerseyNumber?: string;
  divisionId: string;
  parentUserId: string;
}

interface UserProfile {
  id: string;
  displayName: string;
  phoneNumber?: string;
  email: string;
}

export default function TeamRosterPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = use(params);
  const db = useFirestore();

  // Query enrollments for this specific team
  const enrollmentsQuery = useMemoFirebase(() => {
    if (!db) return null;
    return query(collectionGroup(db, 'enrollments'), where('teamId', '==', teamId));
  }, [db, teamId]);

  // Query all players - we'll filter them in memory based on enrollments for the POC
  const playersQuery = useMemoFirebase(() => {
    if (!db) return null;
    return collectionGroup(db, 'players');
  }, [db]);

  // Query all user profiles to get parent info
  const usersQuery = useMemoFirebase(() => {
    if (!db) return null;
    return collection(db, 'userProfiles');
  }, [db]);

  const { data: enrollments, isLoading: loadingEnrollments } = useCollection<Enrollment>(enrollmentsQuery);
  const { data: allPlayers, isLoading: loadingPlayers } = useCollection<Player>(playersQuery);
  const { data: allUsers, isLoading: loadingUsers } = useCollection<UserProfile>(usersQuery);

  const calculateBaseballAge = (dob: string) => {
    if (!dob) return 'N/A';
    try {
      const birthDate = new Date(dob);
      const cutoffDate = new Date(new Date().getFullYear(), 4, 1);
      return differenceInYears(cutoffDate, birthDate);
    } catch (e) {
      return 'N/A';
    }
  };

  const isLoading = loadingEnrollments || loadingPlayers || loadingUsers;

  if (isLoading) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar role="coach" />
        <main className="flex-1 ml-64 p-8 flex items-center justify-center">
          <div className="text-center space-y-4">
            <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
            <p className="text-muted-foreground font-medium">Loading team roster...</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar role="coach" />
      <main className="flex-1 ml-64 p-8">
        <header className="mb-8">
          <Button variant="ghost" asChild className="mb-4 -ml-2">
            <Link href="/coach/teams"><ChevronLeft className="mr-2 h-4 w-4" /> Back to My Teams</Link>
          </Button>
          <h1 className="text-4xl font-bold font-headline">Team Roster</h1>
          <p className="text-muted-foreground mt-2">Detailed player profiles and parent contact hub.</p>
        </header>

        {!enrollments || enrollments.length === 0 ? (
          <Card className="border-none shadow-md py-20 text-center">
            <CardContent>
              <Users className="h-16 w-16 text-muted mx-auto mb-4" />
              <h3 className="text-xl font-bold font-headline">No Players Found</h3>
              <p className="text-muted-foreground">This team roster is currently empty or players are awaiting assignment.</p>
              <Button className="mt-6" asChild variant="outline">
                <Link href="/coach/teams">Check Other Teams</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {enrollments.map((enrollment) => {
              const player = allPlayers?.find(p => p.id === enrollment.playerId);
              const parent = allUsers?.find(u => u.id === enrollment.parentUserId);
              
              if (!player) return null;

              return (
                <Card key={enrollment.id} className="border-none shadow-lg overflow-hidden group hover:shadow-xl transition-all border-l-4 border-l-primary">
                  <CardHeader className="bg-primary/5 pb-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center text-white font-bold text-xl shadow-md">
                          {enrollment.jerseyNumber || player.firstName[0]}
                        </div>
                        <div>
                          <CardTitle className="font-headline text-lg">{player.firstName} {player.lastName}</CardTitle>
                          <CardDescription className="flex items-center gap-2 mt-1">
                            <Badge variant="secondary" className="bg-primary/10 text-primary border-none text-[10px]">
                              Age: {calculateBaseballAge(player.dateOfBirth)}
                            </Badge>
                            {enrollment.jerseyNumber && (
                              <Badge variant="outline" className="text-[10px]">#{enrollment.jerseyNumber}</Badge>
                            )}
                          </CardDescription>
                        </div>
                      </div>
                      {(player.medicalNotes || (player.emergencyContacts && player.emergencyContacts.length > 0)) && (
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="text-destructive bg-destructive/10 hover:bg-destructive/20 rounded-full h-10 w-10 animate-pulse">
                              <AlertTriangle className="h-5 w-5" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="rounded-2xl">
                            <DialogHeader>
                              <DialogTitle className="flex items-center gap-2 text-destructive font-headline">
                                <AlertTriangle className="h-5 w-5" /> Health & Safety: {player.firstName}
                              </DialogTitle>
                              <DialogDescription>
                                Critical medical notes and emergency contact tree.
                              </DialogDescription>
                            </DialogHeader>
                            
                            <div className="space-y-4 mt-4">
                              {player.medicalNotes && (
                                <div className="bg-destructive/5 p-4 rounded-xl border border-destructive/20">
                                  <h4 className="text-[10px] font-bold uppercase mb-2 tracking-widest text-destructive/70">Medical Alert</h4>
                                  <p className="font-bold text-destructive">{player.medicalNotes}</p>
                                </div>
                              )}

                              {player.emergencyContacts && player.emergencyContacts.length > 0 && (
                                <div className="space-y-3">
                                  <h4 className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 text-muted-foreground">
                                    <LifeBuoy className="h-4 w-4" /> Emergency Contacts
                                  </h4>
                                  {player.emergencyContacts.map((contact, i) => (
                                    <div key={i} className="bg-secondary/20 p-4 rounded-xl flex justify-between items-center border">
                                      <div>
                                        <p className="font-bold text-sm">{contact.name}</p>
                                        <p className="text-xs text-muted-foreground">{contact.relationship}</p>
                                      </div>
                                      <Button size="sm" variant="outline" className="rounded-full shadow-sm bg-white" asChild>
                                        <a href={`tel:${contact.phone}`}>
                                          <Phone className="h-3 w-3 mr-2 text-primary" /> {contact.phone}
                                        </a>
                                      </Button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </DialogContent>
                        </Dialog>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="pt-6 space-y-4">
                    <div className="space-y-3">
                      <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                        <UserIcon className="h-3 w-3" /> Primary Guardian
                      </h4>
                      {parent ? (
                        <div className="bg-secondary/20 p-4 rounded-xl space-y-3 border border-secondary">
                          <p className="font-bold text-sm">{parent.displayName}</p>
                          <div className="flex gap-2">
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="flex-1 rounded-full bg-white hover:bg-primary/5 text-xs shadow-sm"
                              asChild
                            >
                              <a href={`tel:${parent.phoneNumber}`}>
                                <Phone className="mr-2 h-3 w-3 text-primary" /> Call
                              </a>
                            </Button>
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="flex-1 rounded-full bg-white hover:bg-primary/5 text-xs shadow-sm"
                              asChild
                            >
                              <a href={`sms:${parent.phoneNumber}`}>
                                <MessageSquare className="mr-2 h-3 w-3 text-primary" /> Text
                              </a>
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="p-4 rounded-xl bg-muted/30 text-center border border-dashed">
                          <p className="text-xs italic text-muted-foreground">Guardian info not linked</p>
                        </div>
                      )}
                    </div>
                    
                    <div className="pt-4 border-t flex items-center justify-between">
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-bold uppercase tracking-wider">
                        <CalendarCheck className="h-3 w-3 text-primary" />
                        <span>Verified Member</span>
                      </div>
                      <Badge variant="outline" className="text-[10px] uppercase font-bold bg-secondary/30">
                        {enrollment.divisionId}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
