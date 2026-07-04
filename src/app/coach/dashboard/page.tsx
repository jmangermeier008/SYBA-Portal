
"use client";

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useUser, useFirestore, useMemoFirebase, useCollection, useSport } from '@/firebase';
import { collection, collectionGroup, query, where, orderBy, limit } from 'firebase/firestore';
import { Dumbbell, Users, Calendar, Star, Loader2, UserCheck, Megaphone, ClipboardList, Phone, ChevronRight, ShieldAlert } from 'lucide-react';
import { isBefore, addMonths } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { LeagueCalendar } from '@/components/calendar/LeagueCalendar';
import { isAnnouncementActive, type CalendarEvent } from '@/types/scheduling';

interface Team {
  id: string;
  name: string;
  divisionId?: string;
  seasonId?: string;
}

interface Enrollment {
  id: string;
  teamId: string;
  playerId: string;
}

interface GameEvent {
  id: string;
  type: string;
  opponentName?: string;
  location: string;
  dateTime: string;
  teamId: string;
  cancelled?: boolean;
}

export default function CoachDashboard() {
  const { user, profile, loading: loadingUser } = useUser();
  const db = useFirestore();
  const { activeSport } = useSport();

  const [selectedTeamIndex, setSelectedTeamIndex] = useState(0);

  // Query teams assigned to this coach, scoped to the active sport
  const teamsQuery = useMemoFirebase(() => {
    if (!db || !user || !activeSport) return null;
    return query(collection(db, 'teams'), where('coachIds', 'array-contains', user.uid), where('sport', '==', activeSport));
  }, [db, user?.uid, activeSport]);

  const { data: teams, isLoading: loadingTeams } = useCollection<Team>(teamsQuery);

  // Query enrollments for the coach's teams to count players
  const teamIds = useMemo(() => teams?.map(t => t.id) ?? [], [teams]);
  const enrollmentsQuery = useMemoFirebase(() => {
    if (!db || teamIds.length === 0) return null;
    return query(collectionGroup(db, 'enrollments'), where('teamId', 'in', teamIds));
  }, [db, teamIds]);

  const { data: enrollments } = useCollection<Enrollment>(enrollmentsQuery);

  // Get upcoming games for the selected team (supports multi-team coaches)
  const clampedTeamIndex = Math.min(selectedTeamIndex, Math.max(0, (teams?.length ?? 1) - 1));
  const firstTeamId = teams?.[clampedTeamIndex]?.id;
  const gamesQuery = useMemoFirebase(() => {
    if (!db || !firstTeamId) return null;
    return query(
      collection(db, 'teams', firstTeamId, 'games'),
      orderBy('dateTime', 'asc'),
      limit(5)
    );
  }, [db, firstTeamId]);

  const { data: games, isLoading: loadingGames } = useCollection<GameEvent>(gamesQuery);

  const [scheduleView, setScheduleView] = useState<'list' | 'calendar'>('list');
  const [calendarFilters, setCalendarFilters] = useState({ games: true, practices: true, concessions: false });
  const router = useRouter();

  const allGamesQuery = useMemoFirebase(() => {
    if (!db || !firstTeamId || scheduleView !== 'calendar') return null;
    return query(
      collection(db, 'teams', firstTeamId, 'games'),
      orderBy('dateTime', 'asc')
    );
  }, [db, firstTeamId, scheduleView]);
  const { data: allGames, isLoading: loadingAllGames } = useCollection<GameEvent>(allGamesQuery);

  const nextGame = games?.[0];
  const playerCount = enrollments?.length ?? 0;

  // RSVP attendance rate for the next game
  const rsvpsQuery = useMemoFirebase(() => {
    if (!db || !firstTeamId || !nextGame?.id) return null;
    return collection(db, 'teams', firstTeamId, 'games', nextGame.id, 'rsvps');
  }, [db, firstTeamId, nextGame?.id]);
  const { data: rsvps } = useCollection(rsvpsQuery);

  const attendingCount = rsvps?.filter((r: any) => r.status === 'Attending').length ?? 0;
  const maybeCount = rsvps?.filter((r: any) => r.status === 'Maybe').length ?? 0;
  const notAttendingCount = rsvps?.filter((r: any) => r.status === 'Not Attending').length ?? 0;
  const totalRsvpCount = rsvps?.length ?? 0;
  const unrepliedCount = Math.max(0, (enrollments?.filter(e => e.teamId === firstTeamId).length ?? 0) - totalRsvpCount);

  // Contextual primary action — changes based on when next event is
  const contextualAction = useMemo(() => {
    if (!nextGame) return { label: 'View Schedule', href: '/coach/schedules', icon: Calendar };
    const now = new Date();
    const eventTime = new Date(nextGame.dateTime);
    const hoursDiff = (eventTime.getTime() - now.getTime()) / 3600000;
    if (nextGame.type === 'Practice' && hoursDiff > 0 && hoursDiff <= 24) {
      return { label: 'Claim Practice Slot', href: '/coach/practice-slots', icon: ClipboardList };
    }
    if (nextGame.type === 'Game' && hoursDiff >= -2 && hoursDiff <= 4) {
      return { label: 'Take Attendance', href: '/coach/teams', icon: UserCheck };
    }
    if (nextGame.type === 'Game' && hoursDiff < -2 && hoursDiff > -26) {
      return { label: 'Log Score', href: '/coach/schedules', icon: ClipboardList };
    }
    return { label: 'View Schedule', href: '/coach/schedules', icon: Calendar };
  }, [nextGame]);

  // Latest announcements — scoped to active sport. Fetch a few extra so expired
  // ones can be filtered out client-side while still showing two.
  const announcementsQuery = useMemoFirebase(() => {
    if (!db || !activeSport) return null;
    return query(collection(db, 'announcements'), where('sport', '==', activeSport), orderBy('publishedAt', 'desc'), limit(5));
  }, [db, activeSport]);
  const { data: rawAnnouncements, isLoading: loadingAnnouncements } = useCollection<{ id: string; title: string; body: string; publishedAt?: string; expiresAt?: string }>(announcementsQuery);
  const announcements = useMemo(() => {
    if (!rawAnnouncements) return rawAnnouncements;
    const d = new Date();
    const todayISO = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return rawAnnouncements.filter(a => isAnnouncementActive(a, todayISO)).slice(0, 2);
  }, [rawAnnouncements]);

  // Surface expiring/expired clearances here — the compliance page computes the
  // same thresholds, but coaches only see it if they happen to open that page.
  const clearancesQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return collection(db, 'userProfiles', user.uid, 'clearances');
  }, [db, user?.uid]);
  const { data: clearances } = useCollection<{ id: string; expirationDate?: string }>(clearancesQuery);

  const clearanceAlert = useMemo(() => {
    if (!clearances || clearances.length === 0) return null;
    const now = new Date();
    const expired = clearances.some(c => c.expirationDate && isBefore(new Date(c.expirationDate), now));
    if (expired) return 'expired' as const;
    const expiringSoon = clearances.some(c => c.expirationDate && isBefore(new Date(c.expirationDate), addMonths(now, 2)));
    return expiringSoon ? ('expiring' as const) : null;
  }, [clearances]);

  const calendarEvents = useMemo((): CalendarEvent[] => {
    if (!allGames || !firstTeamId) return [];
    return allGames.map(g => {
      const dateTime = g.dateTime ?? '';
      return {
        id: g.id,
        eventType: g.type === 'Game' ? 'game' as const : 'practice' as const,
        date: dateTime.slice(0, 10),
        startTime: dateTime.slice(11, 16),
        title: g.type === 'Game' ? `vs ${g.opponentName || 'TBD'}` : 'Team Practice',
        status: g.cancelled ? 'cancelled' as const : 'scheduled' as const,
        fieldName: g.location,
        sourceType: 'team-game' as const,
        sourceId: g.id,
        teamId: firstTeamId,
      };
    });
  }, [allGames, firstTeamId]);

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
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6 pb-20 md:pb-6">
        <header className="mb-4">
          <h1 className="text-2xl font-bold font-headline">
            Coach Dashboard
            {teams && teams.length > 1 && teams[clampedTeamIndex] && (
              <span className="ml-2 text-base font-normal text-muted-foreground">· {teams[clampedTeamIndex].name}</span>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">Manage your teams and plan your next practice.</p>
        </header>

        {clearanceAlert && (
          <div className={cn(
            'mb-4 flex items-start gap-3 p-4 rounded-xl border',
            clearanceAlert === 'expired'
              ? 'bg-destructive/10 border-destructive/20 text-destructive'
              : 'bg-yellow-50 border-yellow-200 text-yellow-800 dark:bg-yellow-950/20 dark:border-yellow-900 dark:text-yellow-300'
          )}>
            <ShieldAlert className="h-5 w-5 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="font-bold text-sm">
                {clearanceAlert === 'expired' ? 'Clearance Expired' : 'Clearance Expiring Soon'}
              </p>
              <p className="text-sm">
                {clearanceAlert === 'expired'
                  ? 'One of your background clearances has expired — you may not be eligible to coach until it\'s renewed.'
                  : 'One of your background clearances expires within 2 months. Renew it early to avoid losing coach access.'}
              </p>
            </div>
            <Button asChild size="sm" variant={clearanceAlert === 'expired' ? 'destructive' : 'outline'} className="shrink-0">
              <Link href="/coach/compliance">Renew</Link>
            </Button>
          </div>
        )}

        {/* Team selector — tap-to-switch, shows team name in title */}
        {teams && teams.length > 1 && (
          <div className="mb-4 overflow-x-auto no-scrollbar">
            <div className="flex items-center gap-2 w-max">
              {teams.map((team, i) => (
                <button
                  key={team.id}
                  onClick={() => setSelectedTeamIndex(i)}
                  className={cn(
                    'px-4 py-2 rounded-full border text-xs font-semibold whitespace-nowrap transition-colors',
                    clampedTeamIndex === i
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-muted text-muted-foreground border-transparent'
                  )}
                >
                  {team.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Contextual primary action — changes based on event timing */}
        <Link
          href={contextualAction.href}
          className="flex items-center justify-between gap-3 rounded-xl bg-primary text-primary-foreground px-4 py-3.5 mb-4 active:scale-[.98] transition-transform shadow-sm"
        >
          <div className="flex items-center gap-3">
            <contextualAction.icon className="h-5 w-5 shrink-0" />
            <span className="font-semibold text-sm">{contextualAction.label}</span>
          </div>
          <ChevronRight className="h-4 w-4 opacity-70" />
        </Link>

        {/* Secondary quick actions */}
        <div className="grid grid-cols-4 gap-2 mb-5">
          {[
            { href: '/coach/teams', icon: Users, label: 'Roster' },
            { href: '/coach/drills', icon: Dumbbell, label: 'Drills' },
            { href: '/coach/schedules', icon: ClipboardList, label: 'Schedule' },
            { href: '/coach/contact', icon: Phone, label: 'Contact' },
          ].map(({ href, icon: Icon, label }) => (
            <Link
              key={href}
              href={href}
              className="flex flex-col items-center gap-1.5 rounded-xl border bg-card p-2.5 active:scale-95 transition-transform text-center"
            >
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Icon className="h-4 w-4 text-primary" />
              </div>
              <p className="text-xs font-medium leading-tight text-muted-foreground">{label}</p>
            </Link>
          ))}
        </div>

        {/* Stats strip — 2 cols on mobile, 4 on desktop */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <Card className="border shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-3 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">My Teams</CardTitle>
              <Users className="h-3.5 w-3.5 text-primary" />
            </CardHeader>
            <CardContent className="px-4 pb-3">
              {loadingTeams ? (
                <><Skeleton className="h-7 w-8 mb-1" /><Skeleton className="h-3 w-24" /></>
              ) : (
                <>
                  <div className="text-xl font-bold">{teams?.length ?? 0}</div>
                  <p className="text-xs text-muted-foreground truncate">
                    {teams?.map(t => t.name).join(', ') || 'No teams assigned'}
                  </p>
                </>
              )}
            </CardContent>
          </Card>
          <Card className="border shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-3 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">Players</CardTitle>
              <Star className="h-3.5 w-3.5 text-accent-foreground" />
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="text-xl font-bold">{playerCount}</div>
              <p className="text-xs text-muted-foreground">Roster size</p>
            </CardContent>
          </Card>
          <Card className="border shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-3 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">Next Event</CardTitle>
              <Calendar className="h-3.5 w-3.5 text-primary" />
            </CardHeader>
            <CardContent className="px-4 pb-3">
              {nextGame ? (
                <>
                  <div className="text-xl font-bold">{nextGame.type}</div>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(nextGame.dateTime), 'EEE, MMM d @ h:mm a')}
                  </p>
                </>
              ) : (
                <>
                  <div className="text-xl font-bold">—</div>
                  <p className="text-xs text-muted-foreground">No upcoming events</p>
                </>
              )}
            </CardContent>
          </Card>
          <Card className="border shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-3 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">Attendance</CardTitle>
              <UserCheck className="h-3.5 w-3.5 text-accent-foreground" />
            </CardHeader>
            <CardContent className="px-4 pb-3">
              {totalRsvpCount > 0 ? (
                <>
                  <div className="text-sm font-bold text-foreground mb-1">
                    {unrepliedCount > 0
                      ? `${unrepliedCount} haven't replied`
                      : `${attendingCount} confirmed`}
                  </div>
                  {/* RSVP bar: attending / maybe / no / unreplied */}
                  <div className="flex h-1.5 rounded-full overflow-hidden gap-px mb-1">
                    {attendingCount > 0 && <div className="bg-green-500 rounded-full" style={{ flex: attendingCount }} />}
                    {maybeCount > 0 && <div className="bg-yellow-400 rounded-full" style={{ flex: maybeCount }} />}
                    {notAttendingCount > 0 && <div className="bg-red-400 rounded-full" style={{ flex: notAttendingCount }} />}
                    {unrepliedCount > 0 && <div className="bg-muted-foreground/20 rounded-full" style={{ flex: unrepliedCount }} />}
                  </div>
                  {unrepliedCount > 0 && (
                    <Link href="/coach/teams" className="text-xs text-primary font-medium">
                      Tap to nudge →
                    </Link>
                  )}
                </>
              ) : (
                <>
                  <div className="text-xl font-bold">—</div>
                  <p className="text-xs text-muted-foreground">No RSVPs yet</p>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          <Card className="md:col-span-2 border shadow-sm">
            <CardHeader className="flex flex-row items-start justify-between pb-3">
              <div>
                <CardTitle className="font-headline text-base">Team Schedule</CardTitle>
                <CardDescription className="text-xs">
                  Upcoming games and practices{teams?.[clampedTeamIndex] ? ` for ${teams[clampedTeamIndex].name}` : ''}
                </CardDescription>
              </div>
              <div className="flex items-center rounded-full border bg-muted p-0.5 text-sm shrink-0">
                <button
                  onClick={() => setScheduleView('list')}
                  className={cn('px-3 py-1.5 min-h-[36px] rounded-full transition-colors text-xs font-semibold', scheduleView === 'list' ? 'bg-white shadow text-foreground' : 'text-muted-foreground')}
                >List</button>
                <button
                  onClick={() => setScheduleView('calendar')}
                  className={cn('px-3 py-1.5 min-h-[36px] rounded-full transition-colors text-xs font-semibold', scheduleView === 'calendar' ? 'bg-white shadow text-foreground' : 'text-muted-foreground')}
                >Calendar</button>
              </div>
            </CardHeader>
            <CardContent>
              {scheduleView === 'calendar' ? (
                <LeagueCalendar
                  events={calendarEvents}
                  isLoading={loadingAllGames}
                  filters={calendarFilters}
                  onFilterChange={(key, val) => setCalendarFilters(prev => ({ ...prev, [key]: val }))}
                  visibleFilters={['games', 'practices']}
                />
              ) : loadingGames ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-7 w-7 animate-spin text-primary" />
                </div>
              ) : !games || games.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Calendar className="h-10 w-10 mx-auto mb-3 opacity-20" />
                  <p className="text-sm">No scheduled events yet.</p>
                  <Button variant="link" asChild className="mt-1">
                    <Link href="/coach/schedules">Add an event</Link>
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {games.map((game) => (
                    <div key={game.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-secondary/20">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-9 h-9 rounded-lg flex items-center justify-center font-bold text-white text-sm shadow-sm shrink-0",
                          game.type === 'Game' ? "bg-primary" : "bg-accent"
                        )}>
                          {game.type[0]}
                        </div>
                        <div>
                          <p className="text-sm font-semibold leading-tight">
                            {game.type === 'Game' ? `vs ${game.opponentName || 'TBD'}` : 'Team Practice'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(game.dateTime), 'EEE, MMM d')} · {format(new Date(game.dateTime), 'h:mm a')}
                          </p>
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" className="h-7 text-xs px-2" asChild>
                        <Link href="/coach/schedules">Manage</Link>
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="font-headline text-base">Announcements</CardTitle>
              <CardDescription className="text-xs">Latest updates from the league</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingAnnouncements ? (
                <div className="space-y-3">
                  {[0, 1].map(i => (
                    <div key={i} className="flex items-start gap-3 p-2">
                      <Skeleton className="w-8 h-8 rounded-full shrink-0" />
                      <div className="flex-1 space-y-1.5">
                        <Skeleton className="h-3.5 w-3/4" />
                        <Skeleton className="h-3 w-full" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : announcements && announcements.length > 0 ? (
                <div className="space-y-3">
                  {announcements.map((a) => (
                    <div key={a.id} className="flex items-start gap-3 p-2 rounded-lg bg-secondary/30">
                      <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary shrink-0">
                        <Megaphone className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold">{a.title}</p>
                        <p className="text-xs text-muted-foreground line-clamp-2">{a.body}</p>
                        {a.publishedAt && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {format(new Date(a.publishedAt), 'MMM d')}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                  <Button variant="ghost" size="sm" asChild className="w-full text-xs">
                    <Link href="/coach/announcements">View all</Link>
                  </Button>
                </div>
              ) : (
                <div className="text-center py-6">
                  <Megaphone className="h-8 w-8 text-muted mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">No announcements yet.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
