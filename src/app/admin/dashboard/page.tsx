"use client";

import { useMemo, useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useFirestore, useCollection, useUser } from '@/firebase';
import { useMemoFirebase } from '@/firebase/provider';
import { use } from 'react';
import { collection, collectionGroup, query, orderBy, limit, where } from 'firebase/firestore';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  MapPin,
  DollarSign,
  CalendarDays,
  ChevronRight,
  Users,
  Trophy,
  Loader2,
  Lock,
  ShoppingCart,
  ClipboardList,
  Settings,
  Megaphone,
  UserCheck,
  Layers,
  Inbox,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import Link from 'next/link';
import { format, parseISO, addDays } from 'date-fns';
import { cn } from '@/lib/utils';

// ─── Interfaces ────────────────────────────────────────────────────────────────

interface Enrollment {
  id: string;
  seasonId: string;
  payment_status?: string;
  paymentStatus?: string;
  status?: string;
  registrationFeeAmount?: number;
}

interface Season {
  id: string;
  name: string;
  isActive?: boolean;
  startDate?: string;
}

interface ConcessionSlot {
  id: string;
  gameDate: string;
  startTime: string;
  endTime: string;
  capacity: number;
  description?: string;
  signups: { parentUserId: string; displayName: string }[];
}

interface Field {
  id: string;
  name: string;
  maintenanceClosures?: { startDate: string; endDate: string; reason: string }[];
}

interface BoardMeeting {
  id: string;
  title: string;
  date: string;
  time: string;
  rsvps: { name: string; status: string }[];
}

interface Clearance {
  id: string;
  type: string;
  status: string;
  _ref?: { parent?: { parent?: { id?: string } } };
}

interface Game {
  id: string;
  type: 'game' | 'practice';
  date: string;
  time: string;
  fieldName: string;
  homeTeamName?: string;
  awayTeamName?: string;
  teamName?: string;
  notes?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function getEnrollmentStatus(e: Enrollment) {
  return e.payment_status ?? e.paymentStatus ?? 'pending';
}

function formatCents(cents: number) {
  return `$${(cents / 100).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function formatTime(t: string) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

const QUICK_LINKS = [
  { label: 'Game Schedule', href: '/admin/games', icon: CalendarDays },
  { label: 'Registrations', href: '/admin/registration', icon: ClipboardList },
  { label: 'Master Roster', href: '/admin/roster', icon: Users },
  { label: 'Compliance', href: '/admin/compliance', icon: UserCheck },
  { label: 'Teams', href: '/admin/teams', icon: Layers },
  { label: 'Fields', href: '/admin/fields', icon: MapPin },
  { label: 'Concessions', href: '/admin/concessions', icon: ShoppingCart },
  { label: 'Sponsorships', href: '/admin/sponsorships', icon: DollarSign },
  { label: 'Announcements', href: '/admin/announcements', icon: Megaphone },
  { label: 'Board Meetings', href: '/admin/board-meetings', icon: CalendarDays },
  { label: 'Inquiries', href: '/admin/inquiries', icon: Inbox },
  { label: 'User Roles', href: '/admin/roles', icon: Settings },
  { label: 'Seasons', href: '/admin/seasons', icon: Trophy },
];

// ─── Component ─────────────────────────────────────────────────────────────────

export default function AdminDashboard({
  params,
  searchParams,
}: {
  params: Promise<any>;
  searchParams: Promise<any>;
}) {
  use(params);
  use(searchParams);

  const db = useFirestore();
  const { isAdmin, isBoardMember, loading: loadingUser } = useUser();

  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);

  const todayISO = format(new Date(), 'yyyy-MM-dd');
  const nextWeekISO = format(addDays(new Date(), 7), 'yyyy-MM-dd');

  // ── Queries ──────────────────────────────────────────────────────────────────

  const seasonsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return collection(db, 'seasons');
  }, [db, isAdmin, isBoardMember]);

  const enrollmentsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return collectionGroup(db, 'enrollments');
  }, [db, isAdmin, isBoardMember]);

  const coachesQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return query(collection(db, 'userProfiles'), where('roles', 'array-contains', 'Coach'));
  }, [db, isAdmin, isBoardMember]);

  const allClearancesQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return collectionGroup(db, 'clearances');
  }, [db, isAdmin, isBoardMember]);

  const concessionSlotsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return query(
      collection(db, 'concessionSlots'),
      where('gameDate', '>=', todayISO),
      where('gameDate', '<=', nextWeekISO),
      orderBy('gameDate', 'asc')
    );
  }, [db, isAdmin, isBoardMember, todayISO, nextWeekISO]);

  const fieldsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return collection(db, 'fields');
  }, [db, isAdmin, isBoardMember]);

  const boardMeetingsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return query(
      collection(db, 'boardMeetings'),
      where('date', '>=', todayISO),
      orderBy('date', 'asc'),
      limit(5)
    );
  }, [db, isAdmin, isBoardMember, todayISO]);

  const gamesQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return query(
      collection(db, 'games'),
      where('date', '>=', todayISO),
      where('date', '<=', nextWeekISO),
      orderBy('date', 'asc'),
      orderBy('time', 'asc')
    );
  }, [db, isAdmin, isBoardMember, todayISO, nextWeekISO]);

  const inquiriesQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return query(collection(db, 'inquiries'), where('status', 'in', ['open', 'in_progress']));
  }, [db, isAdmin, isBoardMember]);

  const { data: seasons } = useCollection<Season>(seasonsQuery);
  const { data: allEnrollments } = useCollection<Enrollment>(enrollmentsQuery);
  const { data: coaches } = useCollection<any>(coachesQuery);
  const { data: allClearances } = useCollection<any>(allClearancesQuery);
  const { data: concessionSlots } = useCollection<ConcessionSlot>(concessionSlotsQuery);
  const { data: fields } = useCollection<Field>(fieldsQuery);
  const { data: boardMeetings } = useCollection<BoardMeeting>(boardMeetingsQuery);
  const { data: thisWeekGames } = useCollection<Game>(gamesQuery);
  const { data: openInquiries } = useCollection<{ id: string; status: string }>(inquiriesQuery);

  // ── Derived data ─────────────────────────────────────────────────────────────

  const activeSeason = useMemo(() => {
    if (!seasons?.length) return null;
    return seasons.find((s) => s.isActive) ?? seasons[0];
  }, [seasons]);

  const displaySeason = useMemo(() => {
    if (!seasons?.length) return null;
    if (selectedSeasonId) return seasons.find((s) => s.id === selectedSeasonId) ?? activeSeason;
    return activeSeason;
  }, [seasons, selectedSeasonId, activeSeason]);

  const seasonEnrollments = useMemo(() => {
    if (!allEnrollments || !displaySeason) return [];
    return allEnrollments.filter((e) => e.seasonId === displaySeason.id);
  }, [allEnrollments, displaySeason]);

  const paidEnrollments = useMemo(
    () => seasonEnrollments.filter((e) => ['paid', 'fee_waived'].includes(getEnrollmentStatus(e))),
    [seasonEnrollments]
  );

  const pendingPaymentCount = useMemo(
    () => seasonEnrollments.filter((e) => getEnrollmentStatus(e) === 'pending_payment').length,
    [seasonEnrollments]
  );

  const waitlistedCount = useMemo(
    () => seasonEnrollments.filter((e) => e.status === 'waitlisted').length,
    [seasonEnrollments]
  );

  const revenueCollected = useMemo(
    () => paidEnrollments.reduce((sum, e) => sum + (e.registrationFeeAmount ?? 0), 0),
    [paidEnrollments]
  );

  // Clearance stats: group clearances by coach userId
  const { clearedCoachCount, totalCoachCount, coachesWithIssues } = useMemo(() => {
    if (!coaches || !allClearances) return { clearedCoachCount: 0, totalCoachCount: 0, coachesWithIssues: false };
    const REQUIRED = ['child_abuse', 'criminal', 'fbi'];
    const clearancesByCoach: Record<string, Record<string, string>> = {};

    allClearances.forEach((c) => {
      // Prefer userId field stored on the document; fall back to path parsing for old docs
      const uid: string | undefined = (c as any).userId ?? (() => {
        const parts = ((c as any)._ref?.path ?? '').split('/');
        return parts.length >= 4 ? parts[1] : undefined;
      })();
      if (!uid) return;
      if (!clearancesByCoach[uid]) clearancesByCoach[uid] = {};
      clearancesByCoach[uid][c.type] = c.status;
    });

    let cleared = 0;
    let issues = false;
    coaches.forEach((coach: any) => {
      const cMap = clearancesByCoach[coach.id] ?? {};
      const allApproved = REQUIRED.every((t) => cMap[t] === 'approved');
      if (allApproved) cleared++;
      else issues = true;
    });

    return { clearedCoachCount: cleared, totalCoachCount: coaches.length, coachesWithIssues: issues };
  }, [coaches, allClearances]);

  // Field closure alerts (next 7 days)
  const fieldsWithClosures = useMemo(() => {
    if (!fields) return [];
    return fields.filter((f) =>
      (f.maintenanceClosures ?? []).some(
        (c) => c.startDate <= nextWeekISO && c.endDate >= todayISO
      )
    );
  }, [fields, todayISO, nextWeekISO]);

  // Concession slots that are not fully covered
  const undercoveredSlots = useMemo(
    () => (concessionSlots ?? []).filter((s) => (s.signups?.length ?? 0) < s.capacity),
    [concessionSlots]
  );

  // ── Alert items ───────────────────────────────────────────────────────────────

  const alerts = useMemo(() => {
    const items: { severity: 'red' | 'orange' | 'blue'; message: string; href: string }[] = [];

    if (coachesWithIssues) {
      items.push({ severity: 'red', message: 'One or more coaches are missing clearance approvals', href: '/admin/compliance' });
    }
    if (undercoveredSlots.length > 0) {
      items.push({
        severity: 'orange',
        message: `${undercoveredSlots.length} concession slot${undercoveredSlots.length > 1 ? 's' : ''} this week ${undercoveredSlots.length > 1 ? 'need' : 'needs'} more volunteers`,
        href: '/admin/concessions',
      });
    }
    if (fieldsWithClosures.length > 0) {
      items.push({
        severity: 'orange',
        message: `${fieldsWithClosures.length} field${fieldsWithClosures.length > 1 ? 's have' : ' has'} a maintenance closure in the next 7 days`,
        href: '/admin/fields',
      });
    }
    if (pendingPaymentCount > 0) {
      items.push({
        severity: 'blue',
        message: `${pendingPaymentCount} enrollment${pendingPaymentCount > 1 ? 's' : ''} with pending payment`,
        href: '/admin/registration',
      });
    }
    if (waitlistedCount > 0) {
      items.push({
        severity: 'blue',
        message: `${waitlistedCount} player${waitlistedCount > 1 ? 's' : ''} on the waitlist`,
        href: '/admin/registration',
      });
    }
    const openInquiryCount = openInquiries?.length ?? 0;
    if (openInquiryCount > 0) {
      items.push({
        severity: 'blue',
        message: `${openInquiryCount} open ${openInquiryCount === 1 ? 'inquiry needs' : 'inquiries need'} attention`,
        href: '/admin/inquiries',
      });
    }
    return items;
  }, [coachesWithIssues, undercoveredSlots, fieldsWithClosures, pendingPaymentCount, waitlistedCount, openInquiries]);

  // ── Loading / access guard ────────────────────────────────────────────────────

  if (loadingUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAdmin && !isBoardMember) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8 flex items-center justify-center">
          <Card className="max-w-md text-center border-none shadow-xl">
            <CardHeader>
              <Lock className="h-12 w-12 text-destructive mx-auto mb-4" />
              <CardTitle className="font-headline text-2xl">Access Denied</CardTitle>
              <p className="text-muted-foreground text-sm">You do not have the required permissions to view the admin dashboard.</p>
            </CardHeader>
            <CardContent>
              <Button asChild className="rounded-full px-8">
                <a href="/">Return Home</a>
              </Button>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const alertBg: Record<string, string> = {
    red: 'bg-red-50 border-red-200 text-red-800',
    orange: 'bg-orange-50 border-orange-200 text-orange-800',
    blue: 'bg-blue-50 border-blue-200 text-blue-800',
  };
  const alertIcon: Record<string, React.ReactNode> = {
    red: <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />,
    orange: <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0 mt-0.5" />,
    blue: <Clock className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />,
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8">

        {/* Header */}
        <header className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold font-headline">League Command Center</h1>
            <p className="text-muted-foreground">
              {displaySeason ? `Viewing: ${displaySeason.name}` : 'Loading season…'}
            </p>
          </div>
          {seasons && seasons.length > 0 && (
            <Select
              value={selectedSeasonId ?? (activeSeason?.id ?? '')}
              onValueChange={(v) => setSelectedSeasonId(v)}
            >
              <SelectTrigger className="w-[200px] rounded-xl border shadow-sm">
                <SelectValue placeholder="Select season" />
              </SelectTrigger>
              <SelectContent>
                {seasons.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                    {s.isActive && <span className="ml-2 text-[10px] text-primary font-semibold">Active</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </header>

        {/* Section 1 — Alerts */}
        <div className="mb-8 space-y-2">
          {alerts.length === 0 ? (
            <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-green-800 text-sm font-medium">
              <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
              All clear — nothing needs attention right now
            </div>
          ) : (
            alerts.map((alert, i) => (
              <Link key={i} href={alert.href}>
                <div className={cn(
                  'flex items-start gap-3 rounded-xl border px-4 py-3 text-sm font-medium hover:opacity-80 transition-opacity cursor-pointer',
                  alertBg[alert.severity]
                )}>
                  {alertIcon[alert.severity]}
                  <span className="flex-1">{alert.message}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 mt-0.5 opacity-60" />
                </div>
              </Link>
            ))
          )}
        </div>

        {/* Section 2 — Stat Cards */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-8">
          <Link href="/admin/registration">
            <Card className="border-none shadow-md hover:shadow-lg transition-shadow cursor-pointer">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Players Enrolled</CardTitle>
                <div className="bg-blue-100 p-2 rounded-lg">
                  <Users className="h-4 w-4 text-blue-600" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{paidEnrollments.length}</div>
                <p className="text-xs text-muted-foreground mt-1">paid or fee waived</p>
              </CardContent>
            </Card>
          </Link>

          <Link href="/admin/registration">
            <Card className="border-none shadow-md hover:shadow-lg transition-shadow cursor-pointer">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Revenue Collected</CardTitle>
                <div className="bg-green-100 p-2 rounded-lg">
                  <DollarSign className="h-4 w-4 text-green-600" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCents(revenueCollected)}</div>
                <p className="text-xs text-muted-foreground mt-1">this season</p>
              </CardContent>
            </Card>
          </Link>

          <Link href="/admin/compliance">
            <Card className="border-none shadow-md hover:shadow-lg transition-shadow cursor-pointer">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Coaches Cleared</CardTitle>
                <div className="bg-purple-100 p-2 rounded-lg">
                  <UserCheck className="h-4 w-4 text-purple-600" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {clearedCoachCount} <span className="text-base font-normal text-muted-foreground">/ {totalCoachCount}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">all clearances approved</p>
              </CardContent>
            </Card>
          </Link>

          <Link href="/admin/registration">
            <Card className="border-none shadow-md hover:shadow-lg transition-shadow cursor-pointer">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Pending Payments</CardTitle>
                <div className="bg-orange-100 p-2 rounded-lg">
                  <Clock className="h-4 w-4 text-orange-600" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{pendingPaymentCount}</div>
                <p className="text-xs text-muted-foreground mt-1">awaiting payment</p>
              </CardContent>
            </Card>
          </Link>
        </div>

        {/* Section 3 — Two Column */}
        <div className="grid gap-6 lg:grid-cols-3">

          {/* Left: This Week */}
          <div className="lg:col-span-2 space-y-6">
            {/* Games */}
            <Card className="border-none shadow-md">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle className="font-headline">This Week — Games & Practices</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">Next 7 days</p>
                </div>
                <Link href="/admin/games" className="text-sm text-primary hover:underline flex items-center gap-1">
                  Manage <ChevronRight className="h-3 w-3" />
                </Link>
              </CardHeader>
              <CardContent>
                {!thisWeekGames || thisWeekGames.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No games or practices scheduled in the next 7 days. <Link href="/admin/games" className="text-primary hover:underline">Add one →</Link></p>
                ) : (
                  <div className="space-y-2">
                    {thisWeekGames.map((g) => (
                      <div key={g.id} className="flex items-center justify-between rounded-lg bg-secondary/20 px-4 py-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium">
                              {g.type === 'game'
                                ? `${g.homeTeamName} vs. ${g.awayTeamName}`
                                : `${g.teamName} Practice`}
                            </p>
                            <Badge variant="outline" className={g.type === 'game' ? 'border-blue-200 text-blue-700 text-[10px]' : 'border-green-200 text-green-700 text-[10px]'}>
                              {g.type === 'game' ? 'Game' : 'Practice'}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {format(parseISO(g.date), 'EEE, MMM d')} · {formatTime(g.time)} · {g.fieldName}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Concession Slots */}
            <Card className="border-none shadow-md">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle className="font-headline">This Week — Concessions</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">Next 7 days of concession coverage</p>
                </div>
                <Link href="/admin/concessions" className="text-sm text-primary hover:underline flex items-center gap-1">
                  Manage <ChevronRight className="h-3 w-3" />
                </Link>
              </CardHeader>
              <CardContent>
                {!concessionSlots || concessionSlots.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No concession slots scheduled in the next 7 days.</p>
                ) : (
                  <div className="space-y-2">
                    {concessionSlots.map((slot) => {
                      const filled = slot.signups?.length ?? 0;
                      const cap = slot.capacity;
                      const pct = cap > 0 ? filled / cap : 0;
                      const colorClass = pct >= 1 ? 'bg-green-100 text-green-800' : pct > 0 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800';
                      return (
                        <div key={slot.id} className="flex items-center justify-between rounded-lg bg-secondary/20 px-4 py-3">
                          <div>
                            <p className="text-sm font-medium">
                              {format(parseISO(slot.gameDate), 'EEE, MMM d')} · {formatTime(slot.startTime)}
                            </p>
                            {slot.description && (
                              <p className="text-xs text-muted-foreground">{slot.description}</p>
                            )}
                          </div>
                          <span className={cn('text-xs font-semibold px-2 py-1 rounded-full', colorClass)}>
                            {filled} / {cap} spots
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Board Meetings */}
            <Card className="border-none shadow-md">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle className="font-headline">This Week — Board Meetings</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">Upcoming in the next 7 days</p>
                </div>
                <Link href="/admin/board-meetings" className="text-sm text-primary hover:underline flex items-center gap-1">
                  Manage <ChevronRight className="h-3 w-3" />
                </Link>
              </CardHeader>
              <CardContent>
                {!boardMeetings || boardMeetings.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No board meetings scheduled in the next 7 days.</p>
                ) : (
                  <div className="space-y-2">
                    {boardMeetings.map((meeting) => {
                      const attending = (meeting.rsvps ?? []).filter((r) => r.status === 'Attending').length;
                      return (
                        <div key={meeting.id} className="flex items-center justify-between rounded-lg bg-secondary/20 px-4 py-3">
                          <div>
                            <p className="text-sm font-medium">{meeting.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {format(parseISO(meeting.date), 'EEE, MMM d')} · {meeting.time}
                            </p>
                          </div>
                          <span className="text-xs text-muted-foreground">{attending} attending</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right: Quick Links */}
          <div>
            <Card className="border-none shadow-md">
              <CardHeader className="pb-2">
                <CardTitle className="font-headline">Quick Links</CardTitle>
                <p className="text-sm text-muted-foreground">Jump to any management page</p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2">
                  {QUICK_LINKS.map(({ label, href, icon: Icon }) => (
                    <Link key={href} href={href}>
                      <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-secondary/20 px-3 py-4 text-center hover:bg-secondary/40 transition-colors cursor-pointer">
                        <Icon className="h-5 w-5 text-primary" />
                        <span className="text-xs font-medium leading-tight">{label}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

        </div>
      </main>
    </div>
  );
}
