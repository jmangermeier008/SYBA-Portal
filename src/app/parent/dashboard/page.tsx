"use client";

import { useState, useEffect, useMemo } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useUser, useFirestore, useMemoFirebase, useCollection, useSport } from '@/firebase';
import { collection, query, where, orderBy, collectionGroup, limit, doc, setDoc, updateDoc } from 'firebase/firestore';
import { Users, Calendar, Trophy, Bell, Loader2, Check, X, HelpCircle, CheckCircle2, AlertCircle, ChevronRight, Printer } from 'lucide-react';
import { openPrintTab } from '@/lib/print-job';
import { TaskCenter } from '@/components/parent/task-center';
import { useIsMobile } from '@/hooks/use-mobile';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { prepareDocumentForUpload, uploadExtensionFor } from '@/lib/upload-compressor';
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
    dateOfBirth?: string;
    streetAddress?: string;
    city?: string;
    schoolEnrolled?: string;
    grade?: string;
    waiverSignatureUrl?: string;
    waiverSignedAt?: string;
    waiverSignedRelationship?: string;
    waiverSignedName?: string;
    birthCertificateUrl?: string;
    physicalFormUrl?: string;
    compliance?: {
      verificationStatus?: 'pending' | 'approved' | 'rejected';
      rejectionReason?: string;
      parentalAgreementSigned?: boolean;
    };
  }>(playersQuery);

  // Enrollments to derive team assignment + payment status
  const enrollmentsQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return query(collectionGroup(db, 'enrollments'), where('parentUserId', '==', user.uid));
  }, [db, user?.uid]);
  const { data: enrollments } = useCollection<{ id: string; playerId: string; teamId?: string; paymentStatus?: string; payment_status?: string; divisionId?: string; seasonId?: string; registrationFeeAmount?: number; sport?: string; parentWeightEstimate?: number; registered_at?: string; emergencyContacts?: { name: string; phone: string; relationship: string }[] }>(enrollmentsQuery);

  // Most recent football enrollment per player — drives the league waiver print action
  const footballEnrollmentByPlayer = useMemo(() => {
    const map = new Map<string, { parentWeightEstimate?: number; emergencyContacts?: { name: string; phone: string; relationship: string }[] }>();
    (enrollments ?? [])
      .filter(e => e.sport === 'football')
      .sort((a, b) => (a.registered_at ?? '').localeCompare(b.registered_at ?? ''))
      .forEach(e => map.set(e.playerId, e)); // last write wins = most recent
    return map;
  }, [enrollments]);


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
          enrollmentIds: [pendingEnrollment.id],
          userId: user.uid,
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

  const handlePhysicalUpload = async (playerId: string, files: File[]) => {
    if (!user || !db) return;
    setUploadingPhysicalFor(playerId);
    try {
      // Validates type/size, compresses oversized photos, and merges multiple
      // photos into one PDF; throws user-friendly messages.
      const file = await prepareDocumentForUpload(files, 'physical');
      const idToken = await user.getIdToken();
      const formData = new FormData();
      formData.append('file', file);
      formData.append('path', `players/${playerId}/physical_${Date.now()}.${uploadExtensionFor(file)}`);
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

  // Next upcoming game for first assigned team. Team-game dateTime strings are
  // naive local time (no Z), so the comparison value must be too — comparing
  // against UTC toISOString() makes today's game vanish hours before kickoff.
  const now = useMemo(() => format(new Date(), "yyyy-MM-dd'T'HH:mm:ss"), []);
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
    );
  }, [db, user?.uid]);
  const { data: incomingLinkRequestsRaw } = useCollection<LinkRequest>(incomingLinkRequestsQuery);
  const incomingLinkRequests = incomingLinkRequestsRaw?.filter(r => r.status === 'pending') ?? null;

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

  const rejectedPlayers = useMemo(() =>
    playersNeedingAction
      .filter(p => p.compliance?.verificationStatus === 'rejected')
      .map(p => ({ id: p.id, firstName: p.firstName, reason: p.compliance?.rejectionReason })),
  [playersNeedingAction]);

  const pendingReviewPlayers = useMemo(() =>
    playersNeedingAction.filter(p => p.compliance?.verificationStatus === 'pending'),
  [playersNeedingAction]);

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
      await updateDoc(
        doc(db, 'userProfiles', req.primaryParentUid, 'players', req.playerId),
        {
          secondaryParentId: req.requestingParentUid,
          parentIds: [req.primaryParentUid, req.requestingParentUid],
        }
      );
      await updateDoc(doc(db, 'linkRequests', req.id), { status: 'approved' });
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
            <div className="sticky top-14 md:top-0 z-20 -mx-3 md:-mx-6 px-3 md:px-6 py-2 bg-background border-b mb-4">
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

          {/* Action Required — single task center consolidating payment, document, and access tasks */}
          <TaskCenter
            pendingPayment={hasPendingPayment ? {
              playerName: pendingPlayer
                ? `${pendingPlayer.firstName ?? ''} ${pendingPlayer.lastName ?? ''}`.trim() || 'Enrollment'
                : 'Enrollment',
              amountCents: pendingEnrollment?.registrationFeeAmount ?? 0,
            } : null}
            onResumePayment={handleResumePayment}
            resumingPayment={resumingPayment}
            rejectedPlayers={rejectedPlayers}
            missingPhysicalPlayers={playersMissingPhysical}
            uploadingPhysicalFor={uploadingPhysicalFor}
            onPhysicalUpload={handlePhysicalUpload}
            linkRequests={incomingLinkRequests ?? []}
            onApproveLink={handleApproveLinkRequest}
            onDenyLink={handleDenyLinkRequest}
            pendingReviewPlayers={pendingReviewPlayers}
          />

          {/* League paperwork — printable Shenango Valley forms for football players */}
          {activeSport === 'football' && footballEnrollmentByPlayer.size > 0 && (
            <div className="rounded-xl border px-4 py-3 mb-4">
              <p className="text-sm font-semibold">League Paperwork</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Print the league Registration Form and Parent/Player Agreement (Child/Parent
                Contract + Adult Code of Ethics). Anything not signed digitally during
                registration must be signed by hand and given to your coach.
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                {players?.filter(p => footballEnrollmentByPlayer.has(p.id)).map(p => (
                  <Button
                    key={p.id}
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-full"
                    onClick={() => openPrintTab({
                      kind: 'waivers',
                      entries: [{
                        player: {
                          firstName: p.firstName ?? '',
                          lastName: p.lastName ?? '',
                          dateOfBirth: p.dateOfBirth,
                          streetAddress: p.streetAddress,
                          city: p.city,
                          schoolEnrolled: p.schoolEnrolled,
                          grade: p.grade,
                          waiverSignatureUrl: p.waiverSignatureUrl,
                          waiverSignedAt: p.waiverSignedAt,
                          waiverSignedRelationship: p.waiverSignedRelationship,
                          waiverSignedName: p.waiverSignedName,
                        },
                        weightEstimate: footballEnrollmentByPlayer.get(p.id)?.parentWeightEstimate,
                        parentPhone: footballEnrollmentByPlayer.get(p.id)?.emergencyContacts?.[0]?.phone
                          ?? profile?.phoneNumber,
                        parentName: profile?.displayName ?? undefined,
                        parentalAgreementSigned: p.compliance?.parentalAgreementSigned === true,
                      }],
                    })}
                  >
                    <Printer className="h-3.5 w-3.5 mr-1.5" />
                    Print League Forms — {p.firstName}
                  </Button>
                ))}
              </div>
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
              <Card className="border shadow-sm">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Enrollment</CardTitle>
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-amber-600">Payment pending</div>
                  <p className="text-xs text-muted-foreground">
                    Finish up in the Action Required list above.
                  </p>
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
