"use client";

import { useState, useEffect, useMemo } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useUser, useFirestore, useMemoFirebase, useCollection, useSport } from '@/firebase';
import { use } from 'react';
import { collection, query, where, orderBy, collectionGroup, limit, doc, setDoc } from 'firebase/firestore';
import { Users, Calendar, Trophy, Bell, Loader2, Check, X, HelpCircle, CheckCircle2, AlertCircle, CreditCard, AlertTriangle, XCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { LeagueCalendar } from '@/components/calendar/LeagueCalendar';
import type { CalendarEvent } from '@/types/scheduling';

function useCountdown(targetDate: string | undefined) {
  const [label, setLabel] = useState('');
  useEffect(() => {
    if (!targetDate) return;
    const update = () => {
      const diff = new Date(targetDate).getTime() - Date.now();
      if (diff <= 0) { setLabel('Today!'); return; }
      const days = Math.floor(diff / 86400000);
      const hours = Math.floor((diff % 86400000) / 3600000);
      setLabel(days > 0 ? `In ${days}d ${hours}h` : `In ${hours}h`);
    };
    update();
    const t = setInterval(update, 60000);
    return () => clearInterval(t);
  }, [targetDate]);
  return label;
}

export default function ParentDashboard({
  params,
  searchParams,
}: {
  params: Promise<any>;
  searchParams: Promise<any>;
}) {
  use(params);
  use(searchParams);

  const { profile, user, loading: loadingUser } = useUser();
  const { activeSport } = useSport();
  const db = useFirestore();
  const { toast } = useToast();
  const [rsvpLoading, setRsvpLoading] = useState(false);
  const [resumingPayment, setResumingPayment] = useState(false);
  const [calendarFilters, setCalendarFilters] = useState({ games: true, practices: true, concessions: false });
  const [selectedPlayerId, setSelectedPlayerId] = useState('');
  const [selectedTeamId, setSelectedTeamId] = useState('');

  // Real player count
  const playersQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return collection(db, 'userProfiles', user.uid, 'players');
  }, [db, user?.uid]);
  const { data: players, isLoading: loadingPlayers } = useCollection<{
    id: string;
    firstName?: string;
    lastName?: string;
    birthCertificateUrl?: string;
    compliance?: {
      verificationStatus?: 'pending' | 'approved' | 'rejected';
      rejectionReason?: string;
    };
  }>(playersQuery);

  // Enrollments to derive team assignment + payment status
  const enrollmentsQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return query(collectionGroup(db, 'enrollments'), where('parentUserId', '==', user.uid));
  }, [db, user?.uid]);
  const { data: enrollments } = useCollection<{ id: string; playerId: string; teamId?: string; paymentStatus?: string; payment_status?: string; divisionId?: string; seasonId?: string; registrationFeeAmount?: number }>(enrollmentsQuery);

  // Set initial selected player when players load
  useEffect(() => {
    if (players?.length && !selectedPlayerId) {
      setSelectedPlayerId(players[0].id);
    }
  }, [players, selectedPlayerId]);

  // Derive team from selected player's enrollment
  useEffect(() => {
    if (!enrollments) return;
    const enrollment = selectedPlayerId
      ? enrollments.find(e => e.playerId === selectedPlayerId)
      : enrollments.find(e => e.teamId);
    setSelectedTeamId(enrollment?.teamId ?? '');
  }, [selectedPlayerId, enrollments]);

  // Enrollment status logic
  const hasEnrollments = (enrollments?.length ?? 0) > 0;
  const pendingEnrollment = enrollments?.find(e =>
    ['pending', 'pending_payment'].includes(e.paymentStatus ?? e.payment_status ?? '')
  );
  const hasPendingPayment = !!pendingEnrollment;

  // H9: Resume Payment — re-initiate Stripe checkout for a pending_payment enrollment
  const handleResumePayment = async () => {
    if (!user || !pendingEnrollment) return;
    setResumingPayment(true);
    try {
      const idToken = await user.getIdToken();
      const resp = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({
          enrollmentId: pendingEnrollment.id,
          userId: user.uid,
          fee: pendingEnrollment.registrationFeeAmount ?? 0,
          divisionName: pendingEnrollment.divisionId ?? '',
          playerName: players?.[0] ? `Player` : 'Player',
        }),
      });
      const data = await resp.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        toast({ variant: 'destructive', title: 'Checkout Error', description: data.error || 'Could not resume payment.' });
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setResumingPayment(false);
    }
  };

  // Next upcoming game for first assigned team
  const now = useMemo(() => new Date().toISOString(), []);
  const nextGameQuery = useMemoFirebase(() => {
    if (!db || !selectedTeamId) return null;
    return query(
      collection(db, 'teams', selectedTeamId, 'games'),
      where('dateTime', '>=', now),
      orderBy('dateTime', 'asc'),
      limit(1)
    );
  }, [db, selectedTeamId]);
  const { data: nextGames, isLoading: loadingGames } = useCollection<{ id: string; dateTime: string; location: string; type: string; opponentName?: string }>(nextGameQuery);
  const nextGame = nextGames?.[0];

  const allTeamGamesQuery = useMemoFirebase(() => {
    if (!db || !selectedTeamId) return null;
    return query(
      collection(db, 'teams', selectedTeamId, 'games'),
      orderBy('dateTime', 'asc')
    );
  }, [db, selectedTeamId]);
  const { data: allTeamGames, isLoading: loadingAllTeamGames } = useCollection<{ id: string; dateTime: string; location: string; type: string; opponentName?: string; cancelled?: boolean }>(allTeamGamesQuery);

  const countdown = useCountdown(nextGame?.dateTime);

  // Current RSVP for next game
  const rsvpsQuery = useMemoFirebase(() => {
    if (!db || !selectedTeamId || !nextGame?.id) return null;
    return collection(db, 'teams', selectedTeamId, 'games', nextGame.id, 'rsvps');
  }, [db, selectedTeamId, nextGame?.id]);
  const { data: rsvps } = useCollection<{ id: string; status: string; playerId: string; gameId?: string }>(rsvpsQuery);
  // H12: Fix RSVP lookup — check by canonical doc ID first (which encodes gameId), then
  // fall back to playerId+gameId match for older records that lack a composite doc ID.
  const currentRsvp = selectedPlayerId && nextGame
    ? rsvps?.find(r =>
        r.id === `${selectedPlayerId}_${nextGame.id}` ||
        (r.playerId === selectedPlayerId && r.gameId === nextGame.id)
      )
    : undefined;

  const handleDashboardRSVP = async (
    status: 'Attending' | 'Maybe' | 'Not Attending',
    gameId: string = nextGame?.id ?? '',
    teamId: string = selectedTeamId ?? ''
  ) => {
    if (!user || !db || !teamId || !selectedPlayerId || !gameId) return;
    setRsvpLoading(true);
    const rsvpId = `${selectedPlayerId}_${gameId}`;
    const rsvpRef = doc(db, 'teams', teamId, 'games', gameId, 'rsvps', rsvpId);
    try {
      await setDoc(rsvpRef, {
        id: rsvpId,
        gameId,
        playerId: selectedPlayerId,
        parentUserId: user.uid,
        status,
        timestamp: new Date().toISOString(),
        teamId,
      }, { merge: true });
      toast({ title: "RSVP Updated", description: `Marked as ${status}.` });
    } catch (err: any) {
      toast({ title: "RSVP Failed", description: err.message, variant: "destructive" });
    } finally {
      setRsvpLoading(false);
    }
  };

  const teamCalendarEvents = useMemo((): CalendarEvent[] => {
    if (!allTeamGames || !selectedTeamId) return [];
    return allTeamGames.map(g => {
      const dateTime = g.dateTime ?? '';
      return {
        id: g.id,
        eventType: g.type === 'Game' ? 'game' as const : 'practice' as const,
        date: dateTime.slice(0, 10),
        startTime: dateTime.slice(11, 16),
        title: g.type === 'Game' ? `vs ${g.opponentName || 'TBD'}` : 'Team Practice',
        status: (g.cancelled === true) ? 'cancelled' as const : 'scheduled' as const,
        fieldName: g.location,
        sourceType: 'team-game' as const,
        sourceId: g.id,
        teamId: selectedTeamId,
      };
    });
  }, [allTeamGames, selectedTeamId]);

  const handleCalendarRsvp = (gameId: string, teamId: string, status: 'Attending' | 'Not Attending' | 'Maybe') => {
    handleDashboardRSVP(status, gameId, teamId);
  };

  // Latest announcements — scoped to active sport
  const announcementsQuery = useMemoFirebase(() => {
    if (!db || !activeSport) return null;
    return query(collection(db, 'announcements'), where('sport', '==', activeSport), orderBy('publishedAt', 'desc'), limit(2));
  }, [db, activeSport]);
  const { data: announcements, isLoading: loadingAnnouncements } = useCollection<{ id: string; title: string; body: string; publishedAt?: string; createdAt?: string }>(announcementsQuery);

  const playersNeedingAction = useMemo(() => {
    return players?.filter(p =>
      p.compliance?.verificationStatus === 'rejected' ||
      (p.compliance?.verificationStatus === 'pending' && p.birthCertificateUrl)
    ) ?? [];
  }, [players]);

  if (loadingUser) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6 max-w-[1400px]">
        <header className="mb-4 md:mb-6 flex justify-between items-center">
          <div>
            <h1 className="text-xl md:text-2xl font-bold font-headline">Welcome back, {profile?.displayName?.split(' ')[0]}</h1>
            <p className="text-sm text-muted-foreground">Here's what's happening with your family's {activeSport ?? 'baseball'} activities.</p>
          </div>
          <Button asChild className="rounded-full">
            <Link href="/parent/enroll">Add New Player</Link>
          </Button>
        </header>

        {/* Compliance Alerts */}
        {playersNeedingAction.length > 0 && (
          <div className="space-y-2 mb-6">
            {playersNeedingAction.map(p => (
              p.compliance?.verificationStatus === 'rejected' ? (
                <Alert key={p.id} variant="destructive">
                  <XCircle className="h-4 w-4" />
                  <AlertDescription>
                    <span className="font-semibold">Action Required: {p.firstName} {p.lastName}</span>
                    {' — '}
                    {p.compliance.rejectionReason ?? 'A document was rejected.'}
                    {' '}
                    <Link href="/parent/family" className="underline font-medium">Log in and re-upload</Link> to resolve this.
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert key={p.id} className="border-yellow-300 bg-yellow-50 text-yellow-900">
                  <AlertTriangle className="h-4 w-4 text-yellow-600" />
                  <AlertDescription>
                    <span className="font-semibold">{p.firstName} {p.lastName}</span>
                    {' — Documents are pending admin review. We\'ll notify you once verified.'}
                  </AlertDescription>
                </Alert>
              )
            ))}
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-2 mb-8">
          <Card className="border-none shadow-md">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Players</CardTitle>
              <Users className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              {loadingPlayers ? (
                <><Skeleton className="h-8 w-12 mb-1" /><Skeleton className="h-3 w-28" /></>
              ) : (
                <>
                  <div className="text-2xl font-bold">{players?.length ?? 0}</div>
                  <p className="text-xs text-muted-foreground">
                    {players?.length === 1 ? 'Player registered' : 'Players registered'}
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="border-none shadow-md">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Next Game</CardTitle>
              <Calendar className="h-4 w-4 text-accent-foreground" />
            </CardHeader>
            <CardContent>
              {loadingGames ? (
                <><Skeleton className="h-8 w-24 mb-1" /><Skeleton className="h-3 w-32 mb-1" /><Skeleton className="h-3 w-20" /></>
              ) : nextGame ? (
                <>
                  <div className="text-2xl font-bold">{countdown || format(new Date(nextGame.dateTime), 'MMM d')}</div>
                  <p className="text-xs text-muted-foreground mb-1">
                    {format(new Date(nextGame.dateTime), 'EEE, MMM d')} · {format(new Date(nextGame.dateTime), 'h:mm a')}
                  </p>
                  {nextGame.opponentName && (
                    <p className="text-xs font-medium text-foreground mb-1">
                      {nextGame.type === 'Game' ? `vs ${nextGame.opponentName}` : nextGame.type}
                    </p>
                  )}
                  {rsvps && (
                    <p className="text-xs text-muted-foreground mb-2">
                      {rsvps.filter(r => r.status === 'Attending').length} attending
                    </p>
                  )}
                  {selectedTeamId && selectedPlayerId && (
                    <div className="flex gap-1.5 mt-2">
                      {rsvpLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      ) : (
                        <>
                          <button
                            onClick={() => handleDashboardRSVP('Attending')}
                            className={cn(
                              "flex items-center gap-1 px-3 py-2 min-h-[40px] rounded-full text-xs font-medium border transition-colors",
                              currentRsvp?.status === 'Attending'
                                ? "bg-green-500 text-white border-green-500"
                                : "border-green-300 text-green-700 hover:bg-green-50"
                            )}
                          >
                            <Check className="h-3 w-3" /> Yes
                          </button>
                          <button
                            onClick={() => handleDashboardRSVP('Maybe')}
                            className={cn(
                              "flex items-center gap-1 px-3 py-2 min-h-[40px] rounded-full text-xs font-medium border transition-colors",
                              currentRsvp?.status === 'Maybe'
                                ? "bg-yellow-400 text-white border-yellow-400"
                                : "border-yellow-300 text-yellow-700 hover:bg-yellow-50"
                            )}
                          >
                            <HelpCircle className="h-3 w-3" /> Maybe
                          </button>
                          <button
                            onClick={() => handleDashboardRSVP('Not Attending')}
                            className={cn(
                              "flex items-center gap-1 px-3 py-2 min-h-[40px] rounded-full text-xs font-medium border transition-colors",
                              currentRsvp?.status === 'Not Attending'
                                ? "bg-red-500 text-white border-red-500"
                                : "border-red-300 text-red-700 hover:bg-red-50"
                            )}
                          >
                            <X className="h-3 w-3" /> No
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="text-2xl font-bold">—</div>
                  <p className="text-xs text-muted-foreground">No upcoming games scheduled</p>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card className="border-none shadow-md">
            <CardHeader>
              <CardTitle className="font-headline">League Announcements</CardTitle>
              <CardDescription>Latest updates from the league</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingAnnouncements ? (
                <div className="space-y-3">
                  {[0, 1].map(i => (
                    <div key={i} className="flex items-start gap-4 p-3">
                      <Skeleton className="w-10 h-10 rounded-full shrink-0" />
                      <div className="flex-1 space-y-1.5">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-3 w-full" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : announcements && announcements.length > 0 ? (
                <div className="space-y-4">
                  {announcements.map((a) => (
                    <div key={a.id} className="flex items-start gap-4 p-3 rounded-lg bg-secondary/30">
                      <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary shrink-0">
                        <Bell className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold">{a.title}</p>
                        <p className="text-xs text-muted-foreground line-clamp-2">{a.body}</p>
                        {(a.publishedAt || a.createdAt) && (
                          <p className="text-[10px] text-muted-foreground mt-1">
                            {format(new Date(a.publishedAt || a.createdAt!), 'MMM d')}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                  <Button variant="ghost" size="sm" asChild className="w-full mt-2">
                    <Link href="/parent/announcements">View all announcements</Link>
                  </Button>
                </div>
              ) : (
                <div className="text-center py-8">
                  <Bell className="h-10 w-10 text-muted mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No announcements yet.</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Dynamic enrollment status card */}
          {hasEnrollments && !hasPendingPayment ? (
            <Card className="border-none shadow-md">
              <CardHeader>
                <CardTitle className="font-headline">Season Enrollment</CardTitle>
                <CardDescription>Your registration status</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center justify-center py-8 text-center">
                <CheckCircle2 className="h-12 w-12 text-green-500 mb-4" />
                <h3 className="font-semibold mb-1 text-green-700">Enrolled — Spring 2026</h3>
                <p className="text-sm text-muted-foreground mb-6">Your player is registered and payment is confirmed.</p>
                <Button asChild variant="outline" className="rounded-full px-8">
                  <Link href="/parent/teams">View My Teams</Link>
                </Button>
              </CardContent>
            </Card>
          ) : hasPendingPayment ? (
            <Card className="border-none shadow-md border-amber-200">
              <CardHeader>
                <CardTitle className="font-headline">Season Enrollment</CardTitle>
                <CardDescription>Action required</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center justify-center py-8 text-center">
                <AlertCircle className="h-12 w-12 text-amber-500 mb-4" />
                <h3 className="font-semibold mb-1 text-amber-700">Payment Required</h3>
                <p className="text-sm text-muted-foreground mb-6">You have an enrollment with a pending payment. Resume checkout to complete registration.</p>
                {/* H9: Resume Payment — re-initiates Stripe checkout for the pending enrollment */}
                <Button
                  className="rounded-full px-8 bg-amber-500 hover:bg-amber-600"
                  onClick={handleResumePayment}
                  disabled={resumingPayment}
                >
                  {resumingPayment
                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    : <CreditCard className="mr-2 h-4 w-4" />
                  }
                  Resume Payment
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-none shadow-md">
              <CardHeader>
                <CardTitle className="font-headline">Season Enrollment</CardTitle>
                <CardDescription>Register for upcoming seasons</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center justify-center py-8 text-center">
                <Trophy className="h-12 w-12 text-muted mb-4" />
                <h3 className="font-semibold mb-2">Enrollment Open</h3>
                <p className="text-sm text-muted-foreground mb-6">Register your players for the upcoming season.</p>
                <Button asChild variant="outline" className="rounded-full px-8">
                  <Link href="/parent/enroll">Enroll Now</Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Season Schedule */}
        {selectedTeamId && (
          <Card className="border-none shadow-md mt-6">
            <CardHeader className="flex flex-row items-start justify-between gap-4 flex-wrap">
              <div>
                <CardTitle className="font-headline">Season Schedule</CardTitle>
                <CardDescription>Your team's full schedule for the season</CardDescription>
              </div>
              {(players?.length ?? 0) > 1 && (
                <div className="flex items-center gap-2 bg-muted/50 rounded-xl px-3 py-1.5 border">
                  <Users className="h-4 w-4 text-primary shrink-0" />
                  <Select value={selectedPlayerId} onValueChange={setSelectedPlayerId}>
                    <SelectTrigger className="w-[160px] border-none shadow-none focus:ring-0 bg-transparent h-auto py-0">
                      <SelectValue placeholder="Select Player" />
                    </SelectTrigger>
                    <SelectContent>
                      {players?.map(p => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.firstName && p.lastName ? `${p.firstName} ${p.lastName}` : `Player`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </CardHeader>
            <CardContent>
              <LeagueCalendar
                events={teamCalendarEvents}
                isLoading={loadingAllTeamGames}
                filters={calendarFilters}
                onFilterChange={(key, val) => setCalendarFilters(prev => ({ ...prev, [key]: val }))}
                visibleFilters={['games', 'practices']}
                onRsvp={handleCalendarRsvp}
              />
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
