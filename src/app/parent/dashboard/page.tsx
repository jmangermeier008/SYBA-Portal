"use client";

import { useState, useEffect, useMemo } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useUser, useFirestore, useMemoFirebase, useCollection, useSport } from '@/firebase';
import { collection, query, where, orderBy, collectionGroup, limit, doc, setDoc, updateDoc, writeBatch, arrayUnion } from 'firebase/firestore';
import { Users, Calendar, Trophy, Bell, Loader2, Check, X, HelpCircle, CheckCircle2, AlertCircle, CreditCard, AlertTriangle, ChevronRight, Upload, UserCheck } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { useIsMobile } from '@/hooks/use-mobile';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { LeagueCalendar } from '@/components/calendar/LeagueCalendar';
import type { CalendarEvent, LinkRequest } from '@/types/scheduling';

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

export default function ParentDashboard() {
  const { profile, user, loading: loadingUser } = useUser();
  const { activeSport } = useSport();
  const db = useFirestore();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [rsvpLoading, setRsvpLoading] = useState(false);
  const [resumingPayment, setResumingPayment] = useState(false);
  const [uploadingPhysicalFor, setUploadingPhysicalFor] = useState<string | null>(null);
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
    physicalFormUrl?: string;
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
          playerName: (() => {
            const p = players?.find(pl => pl.id === pendingEnrollment.playerId);
            return p ? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() : 'Player';
          })(),
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

  const handlePhysicalUpload = async (playerId: string, file: File) => {
    if (!user || !db) return;
    setUploadingPhysicalFor(playerId);
    try {
      const idToken = await user.getIdToken();
      const formData = new FormData();
      formData.append('file', file);
      formData.append('path', `players/${playerId}/physical_${Date.now()}`);
      const resp = await fetch('/api/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
        body: formData,
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Upload failed');
      await updateDoc(doc(db, 'userProfiles', user.uid, 'players', playerId), {
        physicalFormUrl: data.url,
        'compliance.physicalVerified': false,
        'compliance.verificationStatus': 'pending',
      });
      toast({ title: 'Physical form uploaded', description: "It will be reviewed by an admin." });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Upload failed', description: err.message });
    } finally {
      setUploadingPhysicalFor(null);
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

  // Incoming link requests — another parent requesting access to a player this parent owns
  const incomingLinkRequestsQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return query(
      collection(db, 'linkRequests'),
      where('targetParentUids', 'array-contains', user.uid),
      where('status', '==', 'pending'),
    );
  }, [db, user?.uid]);
  const { data: incomingLinkRequests } = useCollection<LinkRequest>(incomingLinkRequestsQuery);

  const playersNeedingAction = useMemo(() => {
    return players?.filter(p =>
      p.compliance?.verificationStatus === 'rejected' ||
      (p.compliance?.verificationStatus === 'pending' && p.birthCertificateUrl)
    ) ?? [];
  }, [players]);

  const playersMissingPhysical = useMemo(() => {
    if (!players || !enrollments) return [];
    const enrolledIds = new Set(enrollments.map(e => e.playerId));
    return players.filter(p =>
      enrolledIds.has(p.id) &&
      !p.physicalFormUrl &&
      p.compliance?.verificationStatus !== 'rejected'
    );
  }, [players, enrollments]);

  // Derived: pending player details for payment card
  const pendingPlayer = useMemo(() => {
    if (!pendingEnrollment || !players) return null;
    return players.find(p => p.id === pendingEnrollment.playerId) ?? null;
  }, [pendingEnrollment, players]);

  // Derived: contextual header CTA
  const headerCta = useMemo(() => {
    if (hasPendingPayment) return { label: 'Resume Payment', href: null, isPayment: true };
    const hasRejected = playersNeedingAction.some(p => p.compliance?.verificationStatus === 'rejected');
    if (hasRejected) return { label: 'Re-upload Document', href: '/parent/family', isPayment: false };
    return { label: 'Add Player', href: '/parent/enroll', isPayment: false };
  }, [hasPendingPayment, playersNeedingAction]);

  const handleApproveLinkRequest = async (req: LinkRequest) => {
    if (!db || !user) return;
    try {
      const batch = writeBatch(db);
      const playerRef = doc(db, 'userProfiles', req.primaryParentUid, 'players', req.playerId);
      batch.update(playerRef, {
        secondaryParentId: req.requestingParentUid,
        parentIds: arrayUnion(req.requestingParentUid),
      });
      batch.update(doc(db, 'linkRequests', req.id), { status: 'approved' });
      await batch.commit();
      toast({ title: "Access Approved", description: `${req.playerSnapshot.firstName} is now shared with the co-parent.` });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    }
  };

  const handleDenyLinkRequest = async (req: LinkRequest) => {
    if (!db) return;
    try {
      await updateDoc(doc(db, 'linkRequests', req.id), { status: 'denied' });
      toast({ title: "Request Denied" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    }
  };

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
      <main className="flex-1 md:ml-64 pb-20 md:pb-6 pt-16 md:pt-6 max-w-[1400px]">

        <div className="px-3 md:px-6">
          <header className="mb-2 md:mb-4 flex justify-between items-start gap-3">
            <div>
              <h1 className="text-xl md:text-2xl font-bold font-headline">Welcome back, {profile?.displayName?.split(' ')[0]}</h1>
              <p className="text-sm text-muted-foreground">Here&apos;s what&apos;s happening with your family&apos;s {activeSport ?? 'baseball'} activities.</p>
            </div>
            {headerCta.isPayment ? (
              <Button className="rounded-full shrink-0" onClick={handleResumePayment} disabled={resumingPayment}>
                {resumingPayment && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {headerCta.label}
              </Button>
            ) : (
              <Button asChild className="rounded-full shrink-0">
                <Link href={headerCta.href!}>{headerCta.label}</Link>
              </Button>
            )}
          </header>

          {/* Player switcher — sticky sub-header, drives the whole dashboard */}
          {(players?.length ?? 0) > 1 && (
            <div className="sticky top-14 z-20 -mx-3 md:-mx-6 px-3 md:px-6 py-2 bg-background/95 backdrop-blur border-b mb-4">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-primary shrink-0" />
                <span className="text-xs font-medium text-muted-foreground">Viewing:</span>
                <Select value={selectedPlayerId} onValueChange={setSelectedPlayerId}>
                  <SelectTrigger className="w-auto border-none shadow-none focus:ring-0 bg-transparent h-auto py-0 font-semibold text-sm text-primary">
                    <SelectValue placeholder="Select Player" />
                  </SelectTrigger>
                  <SelectContent>
                    {players?.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.firstName && p.lastName ? `${p.firstName} ${p.lastName}` : 'Player'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Incoming Co-Parent Link Requests */}
          {incomingLinkRequests && incomingLinkRequests.length > 0 && (
            <div className="space-y-2 mb-4">
              {incomingLinkRequests.map(req => (
                <div key={req.id} className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
                  <div className="flex items-start gap-3">
                    <UserCheck className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-blue-900">
                        Co-Parent Access Request for {req.playerSnapshot.firstName} {req.playerSnapshot.lastName}
                      </p>
                      <p className="text-xs text-blue-700 mt-0.5">
                        Another parent is requesting shared access to manage this player.
                      </p>
                      <div className="flex gap-2 mt-2">
                        <Button
                          size="sm"
                          className="h-8 rounded-full bg-blue-600 hover:bg-blue-700 text-white"
                          onClick={() => handleApproveLinkRequest(req)}
                        >
                          <Check className="h-3 w-3 mr-1.5" /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 rounded-full border-blue-300 text-blue-700 hover:bg-blue-100"
                          onClick={() => handleDenyLinkRequest(req)}
                        >
                          <X className="h-3 w-3 mr-1.5" /> Deny
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Compliance Alerts — reframed as neutral guidance, not destructive */}
          {playersNeedingAction.length > 0 && (
            <div className="space-y-2 mb-4">
              {playersNeedingAction.map(p => (
                p.compliance?.verificationStatus === 'rejected' ? (
                  <div key={p.id} className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                    <p className="text-sm font-semibold text-amber-900">One more step for {p.firstName}</p>
                    <p className="text-sm text-amber-800 mt-0.5">
                      {p.compliance.rejectionReason ?? 'A document needs to be re-submitted.'}
                    </p>
                    <Button size="sm" asChild className="mt-2 h-8 rounded-full bg-amber-600 hover:bg-amber-700">
                      <Link href="/parent/family">Re-upload document</Link>
                    </Button>
                  </div>
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

          {/* Physical form upload prompts */}
          {playersMissingPhysical.length > 0 && (
            <div className="space-y-2 mb-4">
              {playersMissingPhysical.map(p => (
                <div key={p.id} className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-blue-900">Physical form needed for {p.firstName}</p>
                    <p className="text-sm text-blue-800 mt-0.5">Upload a copy to complete {p.firstName}&apos;s registration.</p>
                  </div>
                  <Label className="cursor-pointer shrink-0 text-xs font-medium px-3 py-1.5 rounded-full border border-blue-300 text-blue-700 bg-white hover:bg-blue-100 transition-colors flex items-center gap-1.5">
                    {uploadingPhysicalFor === p.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Upload className="h-3.5 w-3.5" />}
                    Upload
                    <input
                      type="file"
                      className="hidden"
                      accept=".pdf,.jpg,.jpeg,.png"
                      disabled={!!uploadingPhysicalFor}
                      onChange={e => { const f = e.target.files?.[0]; if (f) handlePhysicalUpload(p.id, f); }}
                    />
                  </Label>
                </div>
              ))}
            </div>
          )}

          {/* ── Next Up Hero ── */}
          <Card className="border shadow-sm mb-4">
            <CardContent className="pt-4 pb-4">
              {loadingGames ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-8 w-48" />
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-12 w-full mt-2" />
                </div>
              ) : nextGame ? (
                <>
                  <p className="text-xs font-bold uppercase tracking-widest text-primary mb-1">
                    {format(new Date(nextGame.dateTime), 'EEEE')} · {countdown}
                  </p>
                  <p className="text-2xl font-bold tracking-tight mb-0.5">
                    {nextGame.type === 'Game' && nextGame.opponentName
                      ? `vs ${nextGame.opponentName}`
                      : nextGame.type === 'Game' ? 'Game' : 'Team Practice'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {format(new Date(nextGame.dateTime), 'h:mm a')}{nextGame.location ? ` · ${nextGame.location}` : ''}
                  </p>
                  {rsvps && (
                    <div className="flex gap-2 mt-2 flex-wrap">
                      <span className="text-xs px-2 py-1 bg-secondary rounded-full text-muted-foreground">
                        👥 {rsvps.filter(r => r.status === 'Attending').length} attending
                      </span>
                    </div>
                  )}
                  {selectedTeamId && selectedPlayerId && (
                    <div className={cn("mt-3", isMobile ? "flex gap-2" : "flex gap-1.5")}>
                      {rsvpLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      ) : (
                        <>
                          <button
                            onClick={() => handleDashboardRSVP('Attending')}
                            className={cn(
                              "flex items-center justify-center gap-1.5 border transition-colors font-semibold",
                              isMobile
                                ? "flex-1 min-h-[48px] rounded-xl text-sm px-3"
                                : "px-3 py-2 min-h-[40px] rounded-full text-xs",
                              currentRsvp?.status === 'Attending'
                                ? "bg-green-500 text-white border-green-500"
                                : "border-green-300 text-green-700 hover:bg-green-50"
                            )}
                          >
                            <Check className={isMobile ? "h-4 w-4" : "h-3 w-3"} />
                            {isMobile ? "I'll be there" : "Yes"}
                          </button>
                          <button
                            onClick={() => handleDashboardRSVP('Maybe')}
                            className={cn(
                              "flex items-center justify-center gap-1.5 border transition-colors font-semibold",
                              isMobile
                                ? "flex-1 min-h-[48px] rounded-xl text-sm px-3"
                                : "px-3 py-2 min-h-[40px] rounded-full text-xs",
                              currentRsvp?.status === 'Maybe'
                                ? "bg-yellow-400 text-white border-yellow-400"
                                : "border-yellow-300 text-yellow-700 hover:bg-yellow-50"
                            )}
                          >
                            <HelpCircle className={isMobile ? "h-4 w-4" : "h-3 w-3"} /> Maybe
                          </button>
                          <button
                            onClick={() => handleDashboardRSVP('Not Attending')}
                            className={cn(
                              "flex items-center justify-center gap-1.5 border transition-colors font-semibold",
                              isMobile
                                ? "flex-1 min-h-[48px] rounded-xl text-sm px-3"
                                : "px-3 py-2 min-h-[40px] rounded-full text-xs",
                              currentRsvp?.status === 'Not Attending'
                                ? "bg-red-500 text-white border-red-500"
                                : "border-red-300 text-red-700 hover:bg-red-50"
                            )}
                          >
                            <X className={isMobile ? "h-4 w-4" : "h-3 w-3"} />
                            {isMobile ? "Can't make it" : "No"}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-center gap-3 py-2">
                  <Calendar className="h-8 w-8 text-muted-foreground/40" />
                  <div>
                    <p className="font-semibold text-sm">No upcoming games</p>
                    <p className="text-xs text-muted-foreground">Your schedule will appear here once the league publishes games.</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2 mb-4">
            {/* Players stat */}
            <Card className="border shadow-sm">
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

            {/* Enrollment status */}
            {hasEnrollments && !hasPendingPayment ? (
              <Card className="border shadow-sm">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Enrollment</CardTitle>
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-600">Enrolled</div>
                  <p className="text-xs text-muted-foreground">Payment confirmed</p>
                  <Button asChild variant="ghost" size="sm" className="mt-2 h-7 px-0 text-xs text-primary">
                    <Link href="/parent/teams">View teams <ChevronRight className="h-3 w-3 ml-0.5" /></Link>
                  </Button>
                </CardContent>
              </Card>
            ) : hasPendingPayment ? (
              <Card className="border border-amber-200 bg-amber-50/50 shadow-sm">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-amber-700">Payment Due</CardTitle>
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-sm font-semibold text-amber-900 mb-0.5">
                    {pendingPlayer
                      ? `${pendingPlayer.firstName ?? ''} ${pendingPlayer.lastName ?? ''}`.trim()
                      : 'Enrollment'} — ${((pendingEnrollment?.registrationFeeAmount ?? 0) / 100).toFixed(2)} due
                  </div>
                  <Button
                    size="sm"
                    className="mt-2 h-8 rounded-full bg-amber-500 hover:bg-amber-600 text-white"
                    onClick={handleResumePayment}
                    disabled={resumingPayment}
                  >
                    {resumingPayment ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <CreditCard className="mr-1.5 h-3 w-3" />}
                    Pay ${((pendingEnrollment?.registrationFeeAmount ?? 0) / 100).toFixed(2)} →
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <Card className="border shadow-sm">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Enrollment</CardTitle>
                  <Trophy className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">Open</div>
                  <p className="text-xs text-muted-foreground mb-2">Register for the upcoming season</p>
                  <Button asChild variant="outline" size="sm" className="h-7 rounded-full text-xs">
                    <Link href="/parent/enroll">Enroll Now</Link>
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Announcements */}
          <Card className="border shadow-sm mb-4">
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
                          <p className="text-xs text-muted-foreground mt-1">
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

          {/* Season Schedule */}
          {selectedTeamId && (
            <Card className="border shadow-sm">
              <CardHeader>
                <CardTitle className="font-headline">Season Schedule</CardTitle>
                <CardDescription>Your team&apos;s full schedule for the season</CardDescription>
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
        </div>
      </main>
    </div>
  );
}
