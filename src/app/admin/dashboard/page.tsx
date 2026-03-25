"use client";

import { useMemo, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { LeagueCalendar } from '@/components/calendar/LeagueCalendar';
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
  UserCheck,
  Inbox,
  FileText,
  Dumbbell,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import Link from 'next/link';
import { format, parseISO, addDays } from 'date-fns';
import { cn } from '@/lib/utils';
import type { CalendarEvent, PracticeSlot, ConcessionSlot as ConcessionSlotType } from '@/types/scheduling';

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
  status?: string;
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

interface Game {
  id: string;
  type: 'game' | 'practice';
  date: string;
  time: string;
  fieldName: string;
  homeTeamName?: string;
  awayTeamName?: string;
  teamName?: string;
  division?: string;
  notes?: string;
  status?: string;
  seasonId?: string;
  umpireName?: string;
  umpireNotified?: boolean;
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

// ─── Calendar event normalizers (mirrors /admin/calendar/page.tsx) ──────────────

function normalizeGame(g: Game): CalendarEvent {
  return {
    id: g.id,
    eventType: g.type === 'practice' ? 'practice' : 'game',
    date: g.date,
    startTime: g.time,
    title:
      g.homeTeamName && g.awayTeamName
        ? `${g.homeTeamName} vs. ${g.awayTeamName}`
        : g.teamName ?? 'Game',
    status: g.status ?? 'scheduled',
    fieldName: g.fieldName,
    sourceType: 'global-game',
    sourceId: g.id,
    homeTeamName: g.homeTeamName,
    awayTeamName: g.awayTeamName,
    division: g.division,
    notes: g.notes,
    umpireName: g.umpireName,
    umpireNotified: g.umpireNotified,
  };
}

function normalizePracticeSlot(s: PracticeSlot): CalendarEvent {
  return {
    id: s.id,
    eventType: 'practice',
    date: s.date,
    startTime: s.startTime,
    endTime: s.endTime,
    title: s.teamName ? `${s.teamName} Practice` : `${s.fieldName} Practice`,
    status: s.status,
    fieldName: s.fieldName,
    sourceType: 'practice-slot',
    sourceId: s.id,
    teamId: s.teamId,
    teamName: s.teamName,
    notes: s.notes,
  };
}

function normalizeConcessionSlot(s: ConcessionSlotType): CalendarEvent {
  return {
    id: s.id,
    eventType: 'concession',
    date: s.gameDate,
    startTime: s.startTime,
    endTime: s.endTime,
    title: s.description || 'Concession Shift',
    status: s.status ?? 'active',
    sourceType: 'concession-slot',
    sourceId: s.id,
    capacity: s.capacity,
    claimedCount: s.signups?.length ?? s.claimedCount ?? 0,
  };
}

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
  const router = useRouter();
  const { isAdmin, isBoardMember, loading: loadingUser } = useUser();

  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('calendar');
  const [calendarFilters, setCalendarFilters] = useState({ games: true, practices: true, concessions: true });
  const tabScrollRef = useRef<HTMLDivElement>(null);
  const [showLeftFade, setShowLeftFade] = useState(false);

  const handleTabScroll = useCallback(() => {
    if (tabScrollRef.current) {
      setShowLeftFade(tabScrollRef.current.scrollLeft > 4);
    }
  }, []);

  const todayISO = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);
  const nextWeekISO = useMemo(() => format(addDays(new Date(), 7), 'yyyy-MM-dd'), []);

  // ── Queries ──────────────────────────────────────────────────────────────────

  const seasonsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return query(collection(db, 'seasons'), orderBy('name', 'desc'));
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

  // This week's concession slots (for Concessions tab)
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

  // This week's games (for Games tab)
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

  // All games, practice slots, all concession slots — for the Calendar tab only
  const allGamesQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember) || activeTab !== 'calendar') return null;
    return collection(db, 'games');
  }, [db, isAdmin, isBoardMember, activeTab]);

  const practiceSlotsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember) || activeTab !== 'calendar') return null;
    return collection(db, 'practiceSlots');
  }, [db, isAdmin, isBoardMember, activeTab]);

  const allTeamsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return collection(db, 'teams');
  }, [db, isAdmin, isBoardMember]);

  const allConcessionSlotsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember) || activeTab !== 'calendar') return null;
    return collection(db, 'concessionSlots');
  }, [db, isAdmin, isBoardMember, activeTab]);

  const { data: seasons } = useCollection<Season>(seasonsQuery);
  const { data: allEnrollments } = useCollection<Enrollment>(enrollmentsQuery);
  const { data: coaches } = useCollection<any>(coachesQuery);
  const { data: allClearances } = useCollection<any>(allClearancesQuery);
  const { data: concessionSlots } = useCollection<ConcessionSlot>(concessionSlotsQuery);
  const { data: fields } = useCollection<Field>(fieldsQuery);
  const { data: boardMeetings } = useCollection<BoardMeeting>(boardMeetingsQuery);
  const { data: thisWeekGames } = useCollection<Game>(gamesQuery);
  const { data: openInquiries } = useCollection<{ id: string; status: string }>(inquiriesQuery);
  const { data: allGames, isLoading: loadingAllGames } = useCollection<Game>(allGamesQuery);
  const { data: practiceSlots, isLoading: loadingPracticeSlots } = useCollection<PracticeSlot>(practiceSlotsQuery);
  const { data: allConcessionSlots, isLoading: loadingAllConcessions } = useCollection<ConcessionSlotType>(allConcessionSlotsQuery);
  const { data: allTeams } = useCollection<{ id: string; name: string }>(allTeamsQuery);

  // ── Derived data ─────────────────────────────────────────────────────────────

  const activeSeason = useMemo(() => {
    if (!seasons?.length) return null;
    return seasons.find((s) => s.status === 'active' || s.isActive) ?? seasons[0];
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

  const { clearedCoachCount, totalCoachCount, coachesWithIssues } = useMemo(() => {
    if (!coaches || !allClearances) return { clearedCoachCount: 0, totalCoachCount: 0, coachesWithIssues: false };
    const REQUIRED = ['child_abuse', 'criminal', 'fbi'];
    const clearancesByCoach: Record<string, Record<string, string>> = {};

    allClearances.forEach((c) => {
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

  const fieldsWithClosures = useMemo(() => {
    if (!fields) return [];
    return fields.filter((f) =>
      (f.maintenanceClosures ?? []).some(
        (c) => c.startDate <= nextWeekISO && c.endDate >= todayISO
      )
    );
  }, [fields, todayISO, nextWeekISO]);

  const undercoveredSlots = useMemo(
    () => (concessionSlots ?? []).filter((s) => (s.signups?.length ?? 0) < s.capacity),
    [concessionSlots]
  );

  const alerts = useMemo(() => {
    const items: { severity: 'red' | 'orange' | 'blue'; message: string; href: string }[] = [];

    if (coachesWithIssues) {
      items.push({ severity: 'red', message: 'Coaches missing clearance approvals', href: '/admin/compliance' });
    }
    if (undercoveredSlots.length > 0) {
      items.push({
        severity: 'orange',
        message: `${undercoveredSlots.length} concession slot${undercoveredSlots.length > 1 ? 's' : ''} need more volunteers`,
        href: '/admin/concessions',
      });
    }
    if (fieldsWithClosures.length > 0) {
      items.push({
        severity: 'orange',
        message: `${fieldsWithClosures.length} field${fieldsWithClosures.length > 1 ? 's' : ''} closed this week`,
        href: '/admin/fields',
      });
    }
    if (pendingPaymentCount > 0) {
      items.push({
        severity: 'blue',
        message: `${pendingPaymentCount} pending payment${pendingPaymentCount > 1 ? 's' : ''}`,
        href: '/admin/registration',
      });
    }
    if (waitlistedCount > 0) {
      items.push({
        severity: 'blue',
        message: `${waitlistedCount} on waitlist`,
        href: '/admin/registration',
      });
    }
    const openInquiryCount = openInquiries?.length ?? 0;
    if (openInquiryCount > 0) {
      items.push({
        severity: 'blue',
        message: `${openInquiryCount} open ${openInquiryCount === 1 ? 'inquiry' : 'inquiries'}`,
        href: '/admin/inquiries',
      });
    }

    // Umpire alerts — check today's and this week's games
    const now = new Date();
    (thisWeekGames ?? []).forEach(g => {
      if (g.type !== 'game') return;
      const gameDateTime = new Date(`${g.date}T${g.time}`);
      const hoursUntil = (gameDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);

      // Condition A: scheduled game today, starting in < 6 hours, no umpire assigned
      if (g.status !== 'cancelled' && g.date === todayISO && hoursUntil < 6 && hoursUntil > 0 && !g.umpireName) {
        items.push({
          severity: 'red',
          message: `Missing umpire: ${g.homeTeamName ?? ''} vs. ${g.awayTeamName ?? ''} at ${formatTime(g.time)}`,
          href: '/admin/games',
        });
      }

      // Condition B: cancelled game has umpire not yet notified
      if (g.status === 'cancelled' && g.umpireName && !g.umpireNotified) {
        items.push({
          severity: 'orange',
          message: `Notify umpire of cancellation: ${g.homeTeamName ?? ''} vs. ${g.awayTeamName ?? ''}`,
          href: '/admin/games',
        });
      }
    });

    return items;
  }, [coachesWithIssues, undercoveredSlots, fieldsWithClosures, pendingPaymentCount, waitlistedCount, openInquiries, thisWeekGames, todayISO]);

  // Calendar tab events
  const calendarEvents = useMemo<CalendarEvent[]>(() => {
    const events: CalendarEvent[] = [];
    (allGames ?? []).forEach(g => events.push(normalizeGame(g)));
    (practiceSlots ?? []).forEach(s => events.push(normalizePracticeSlot(s)));
    (allConcessionSlots ?? []).forEach(s => events.push(normalizeConcessionSlot(s)));
    return events.sort((a, b) => {
      const dateComp = a.date.localeCompare(b.date);
      if (dateComp !== 0) return dateComp;
      return (a.startTime ?? '').localeCompare(b.startTime ?? '');
    });
  }, [allGames, practiceSlots, allConcessionSlots]);

  const calendarLoading = loadingAllGames || loadingPracticeSlots || loadingAllConcessions;

  const practiceSlotCoverage = useMemo(() => {
    const totalTeams = (allTeams ?? []).length;
    const claimedTeamIds = new Set(
      (practiceSlots ?? []).filter(s => s.status === 'claimed' && s.teamId).map(s => s.teamId!)
    );
    return { totalTeams, teamsWithSlots: claimedTeamIds.size };
  }, [allTeams, practiceSlots]);

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

  // ── Alert styles ──────────────────────────────────────────────────────────────

  const chipBg: Record<string, string> = {
    red: 'bg-red-50 border-red-200 text-red-800 hover:bg-red-100',
    orange: 'bg-orange-50 border-orange-200 text-orange-800 hover:bg-orange-100',
    blue: 'bg-blue-50 border-blue-200 text-blue-800 hover:bg-blue-100',
  };
  const chipIcon: Record<string, React.ReactNode> = {
    red: <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0" />,
    orange: <AlertTriangle className="h-3.5 w-3.5 text-orange-500 shrink-0" />,
    blue: <Clock className="h-3.5 w-3.5 text-blue-500 shrink-0" />,
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-4 md:p-6 pt-16 md:pt-6 min-w-0 overflow-x-auto">

        {/* ── Zone 1: Header ── */}
        <header className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold font-headline">League Command Center</h1>
            <p className="text-muted-foreground text-sm">
              {displaySeason ? displaySeason.name : 'Loading season…'}
            </p>
          </div>
          {seasons && seasons.length > 0 && (
            <Select
              value={selectedSeasonId ?? (activeSeason?.id ?? '')}
              onValueChange={(v) => setSelectedSeasonId(v)}
            >
              <SelectTrigger className="w-[180px] rounded-xl border shadow-sm text-sm">
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

        {/* ── Zone 1: Alerts ── */}
        <div className="mb-4">
          {alerts.length === 0 ? (
            <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-2.5 text-green-800 text-sm font-medium">
              <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
              All clear — nothing needs attention right now
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {alerts.map((alert, i) => (
                <Link key={i} href={alert.href}>
                  <div className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer',
                    chipBg[alert.severity]
                  )}>
                    {chipIcon[alert.severity]}
                    <span>{alert.message}</span>
                    <ChevronRight className="h-3 w-3 opacity-60" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* ── Zone 2: Season Pulse — compact stat row ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <Link href="/admin/registration">
            <Card className="border-none shadow-sm hover:shadow-md transition-shadow cursor-pointer">
              <CardContent className="px-4 py-3 flex items-center gap-3">
                <Users className="h-4 w-4 text-blue-500 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground leading-none mb-0.5">Enrolled</p>
                  <p className="text-xl font-bold leading-none">{paidEnrollments.length}</p>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/admin/registration">
            <Card className="border-none shadow-sm hover:shadow-md transition-shadow cursor-pointer">
              <CardContent className="px-4 py-3 flex items-center gap-3">
                <DollarSign className="h-4 w-4 text-green-500 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground leading-none mb-0.5">Revenue</p>
                  <p className="text-xl font-bold leading-none">{formatCents(revenueCollected)}</p>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/admin/compliance">
            <Card className="border-none shadow-sm hover:shadow-md transition-shadow cursor-pointer">
              <CardContent className="px-4 py-3 flex items-center gap-3">
                <UserCheck className="h-4 w-4 text-purple-500 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground leading-none mb-0.5">Coaches Cleared</p>
                  <p className="text-xl font-bold leading-none">
                    {clearedCoachCount}<span className="text-sm font-normal text-muted-foreground"> / {totalCoachCount}</span>
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/admin/registration">
            <Card className="border-none shadow-sm hover:shadow-md transition-shadow cursor-pointer">
              <CardContent className="px-4 py-3 flex items-center gap-3">
                <Clock className="h-4 w-4 text-orange-500 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground leading-none mb-0.5">Pending Payments</p>
                  <p className="text-xl font-bold leading-none">{pendingPaymentCount}</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>

        {/* ── Zone 2.5: Practice Slot Coverage ── */}
        <Link href="/admin/practice-slots?tab=distribution">
          <Card className="border-none shadow-sm hover:shadow-md transition-shadow cursor-pointer mb-4">
            <CardContent className="px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Dumbbell className="h-4 w-4 text-green-500 shrink-0" />
                  <p className="text-xs font-medium text-muted-foreground">Practice Slot Coverage</p>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {practiceSlotCoverage.teamsWithSlots}
                  </span>
                  <span>of</span>
                  <span className="font-semibold text-foreground">{practiceSlotCoverage.totalTeams}</span>
                  <span>teams have claimed a slot</span>
                  <ChevronRight className="h-3.5 w-3.5 opacity-50" />
                </div>
              </div>
              <Progress
                value={practiceSlotCoverage.totalTeams > 0
                  ? (practiceSlotCoverage.teamsWithSlots / practiceSlotCoverage.totalTeams) * 100
                  : 0}
                className="h-1.5"
              />
            </CardContent>
          </Card>
        </Link>

        {/* ── Zone 3: This Week — tabbed card ── */}
        <Card className="border-none shadow-md">
          <CardHeader className="pb-0 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="font-headline text-base">This Week</CardTitle>
              <span className="text-xs text-muted-foreground">Next 7 days</span>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-3">
            <Tabs defaultValue="calendar" value={activeTab} onValueChange={setActiveTab}>
              <div className="relative mb-3">
                {showLeftFade && (
                  <div className="pointer-events-none absolute left-0 top-0 h-full w-8 bg-gradient-to-r from-card to-transparent z-10" />
                )}
                <div
                  ref={tabScrollRef}
                  onScroll={handleTabScroll}
                  className="overflow-x-auto -mx-4 px-4 no-scrollbar scroll-smooth"
                >
                  <TabsList className="h-8 w-max">
                    <TabsTrigger
                      value="calendar"
                      className="text-xs px-3 h-7 flex items-center gap-1.5"
                      onClick={(e) => (e.currentTarget as HTMLElement).scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })}
                    >
                      <Trophy className="h-3.5 w-3.5" />
                      Calendar
                    </TabsTrigger>
                    <TabsTrigger
                      value="games"
                      className="text-xs px-3 h-7 flex items-center gap-1.5"
                      onClick={(e) => (e.currentTarget as HTMLElement).scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })}
                    >
                      <CalendarDays className="h-3.5 w-3.5" />
                      Games & Practices
                    </TabsTrigger>
                    <TabsTrigger
                      value="concessions"
                      className="text-xs px-3 h-7 flex items-center gap-1.5"
                      onClick={(e) => (e.currentTarget as HTMLElement).scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })}
                    >
                      <ShoppingCart className="h-3.5 w-3.5" />
                      Concessions
                    </TabsTrigger>
                    <TabsTrigger
                      value="meetings"
                      className="text-xs px-3 h-7 flex items-center gap-1.5"
                      onClick={(e) => (e.currentTarget as HTMLElement).scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })}
                    >
                      <Inbox className="h-3.5 w-3.5" />
                      Board Meetings
                    </TabsTrigger>
                  </TabsList>
                </div>
                <div className="pointer-events-none absolute right-0 top-0 h-full w-8 bg-gradient-to-l from-card to-transparent" />
              </div>

              {/* Tab: Games & Practices */}
              <TabsContent value="games" className="mt-0">
                {!thisWeekGames || thisWeekGames.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    No games or practices in the next 7 days.{' '}
                    <Link href="/admin/games" className="text-primary hover:underline">Add one →</Link>
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {thisWeekGames.map((g) => {
                      const gameTitle =
                        g.type === 'game'
                          ? `${g.homeTeamName} vs. ${g.awayTeamName}`
                          : `${g.teamName} Practice`;
                      const typeLabel = g.type === 'game' ? 'League Game' : 'Practice';
                      const headerColor = g.type === 'game' ? 'bg-primary' : 'bg-green-600';

                      return (
                        <Popover key={g.id}>
                          <PopoverTrigger asChild>
                            <div
                              className="flex items-center justify-between rounded-lg bg-secondary/20 px-3 py-2.5 hover:bg-secondary/40 transition-colors cursor-pointer group"
                              role="button"
                              tabIndex={0}
                            >
                              <div>
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-medium">{gameTitle}</p>
                                  <Badge
                                    variant="outline"
                                    className={g.type === 'game'
                                      ? 'border-blue-200 text-blue-700 text-[10px]'
                                      : 'border-green-200 text-green-700 text-[10px]'}
                                  >
                                    {g.type === 'game' ? 'Game' : 'Practice'}
                                  </Badge>
                                </div>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {format(parseISO(g.date), 'EEE, MMM d')} · {formatTime(g.time)} · <MapPin className="h-3 w-3 inline -mt-0.5" /> {g.fieldName}
                                </p>
                              </div>
                              <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors shrink-0" />
                            </div>
                          </PopoverTrigger>
                          <PopoverContent className="w-72 p-0 shadow-lg" align="start">
                            <div className="overflow-hidden rounded-lg">
                              {/* Colored header */}
                              <div className={cn('px-4 py-3 text-white', headerColor)}>
                                <p className="font-semibold text-sm leading-tight">{gameTitle}</p>
                                <p className="text-xs opacity-80 mt-0.5">{typeLabel}</p>
                              </div>
                              {/* Details */}
                              <div className="px-4 py-3 space-y-1.5">
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                  <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                                  <span>{format(parseISO(g.date), 'EEE, MMM d')} · {formatTime(g.time)}</span>
                                </div>
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                                  <span>{g.fieldName}</span>
                                </div>
                                {g.division && (
                                  <div className="flex items-center gap-2 text-sm">
                                    <Trophy className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                    <span className="text-primary/80 font-medium text-sm">{g.division}</span>
                                  </div>
                                )}
                                {g.notes && (
                                  <div className="flex items-start gap-2 text-sm">
                                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-0.5" />
                                    <span className="text-muted-foreground italic">{g.notes}</span>
                                  </div>
                                )}
                              </div>
                              {/* Footer: view full record */}
                              <div className="px-4 py-2.5 border-t">
                                <Link
                                  href={`/admin/games/${g.id}`}
                                  className="text-xs text-primary hover:underline flex items-center gap-1 font-medium"
                                >
                                  View full record <ChevronRight className="h-3 w-3" />
                                </Link>
                              </div>
                            </div>
                          </PopoverContent>
                        </Popover>
                      );
                    })}
                  </div>
                )}
                <div className="mt-3 pt-3 border-t">
                  <Link href="/admin/games" className="text-xs text-primary hover:underline flex items-center gap-1">
                    Manage game schedule <ChevronRight className="h-3 w-3" />
                  </Link>
                </div>
              </TabsContent>

              {/* Tab: Concessions */}
              <TabsContent value="concessions" className="mt-0">
                {!concessionSlots || concessionSlots.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    No concession slots in the next 7 days.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {concessionSlots.map((slot) => {
                      const filled = slot.signups?.length ?? 0;
                      const cap = slot.capacity;
                      const pct = cap > 0 ? filled / cap : 0;
                      const colorClass = pct >= 1 ? 'bg-green-100 text-green-800' : pct > 0 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800';
                      return (
                        <Link key={slot.id} href="/admin/concessions">
                          <div className="flex items-center justify-between rounded-lg bg-secondary/20 px-3 py-2.5 hover:bg-secondary/40 transition-colors cursor-pointer group">
                            <div>
                              <p className="text-sm font-medium">
                                {format(parseISO(slot.gameDate), 'EEE, MMM d')} · {formatTime(slot.startTime)}
                              </p>
                              {slot.description && (
                                <p className="text-xs text-muted-foreground">{slot.description}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', colorClass)}>
                                {filled} / {cap}
                              </span>
                              <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors shrink-0" />
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
                <div className="mt-3 pt-3 border-t">
                  <Link href="/admin/concessions" className="text-xs text-primary hover:underline flex items-center gap-1">
                    Manage concessions <ChevronRight className="h-3 w-3" />
                  </Link>
                </div>
              </TabsContent>

              {/* Tab: Board Meetings */}
              <TabsContent value="meetings" className="mt-0">
                {!boardMeetings || boardMeetings.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    No board meetings scheduled in the next 7 days.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {boardMeetings.map((meeting) => {
                      const attending = (meeting.rsvps ?? []).filter((r) => r.status === 'Attending').length;
                      return (
                        <Link key={meeting.id} href="/admin/board-meetings">
                          <div className="flex items-center justify-between rounded-lg bg-secondary/20 px-3 py-2.5 hover:bg-secondary/40 transition-colors cursor-pointer group">
                            <div>
                              <p className="text-sm font-medium">{meeting.title}</p>
                              <p className="text-xs text-muted-foreground">
                                {format(parseISO(meeting.date), 'EEE, MMM d')} · {meeting.time}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">{attending} attending</span>
                              <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors shrink-0" />
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
                <div className="mt-3 pt-3 border-t">
                  <Link href="/admin/board-meetings" className="text-xs text-primary hover:underline flex items-center gap-1">
                    Manage board meetings <ChevronRight className="h-3 w-3" />
                  </Link>
                </div>
              </TabsContent>

              {/* Tab: Calendar */}
              <TabsContent value="calendar" className="mt-0">
                <LeagueCalendar
                  events={calendarEvents}
                  isLoading={calendarLoading}
                  filters={calendarFilters}
                  onFilterChange={(key, val) => setCalendarFilters(f => ({ ...f, [key]: val }))}
                  visibleFilters={['games', 'practices', 'concessions']}
                  defaultView="week"
                  showUmpire
                  onViewRecord={(event) => {
                    if (event.sourceType === 'global-game' || event.sourceType === 'practice-slot') {
                      router.push(`/admin/games/${event.sourceId}`);
                    }
                  }}
                />
              </TabsContent>

            </Tabs>
          </CardContent>
        </Card>

      </main>
    </div>
  );
}
