"use client";

import { useUser, useSport, useFirestore, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import { setActiveSport as writeActiveSport, clearActiveSport } from '@/hooks/use-active-sport';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import Link from 'next/link';
import Image from 'next/image';
import { AlertTriangle, Loader2, Megaphone, Calendar, Pin, Users } from 'lucide-react';
import { collection, query, where, limit, orderBy, doc } from 'firebase/firestore';
import type { Announcement, ComplexClosuresDocument, Game, LeagueOfficer, Sport } from '@/types/scheduling';
import { SPORT_CONFIG, HUB_LOGO_URL } from '@/config/sports';
import { cn } from '@/lib/utils';
import { EXECUTIVE_TITLES } from '@/data/officers';

const HUB_contactEmail = 'info@syba.blue';

// Add sponsor image files to public/sponsors/ — images with load errors are auto-hidden.
const SPONSOR_IMAGES = [
  '/sponsors/sponsor1.png',
  '/sponsors/sponsor2.png',
  '/sponsors/sponsor3.png',
];

interface ActiveSeason {
  id: string;
  name: string;
  registrationOpen: string;
  registrationClose: string;
  isActive?: boolean;
}

function formatDate(dateStr: string) {
  const d = dateStr.length > 10 ? new Date(dateStr) : new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function formatGameDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

function formatTime(timeStr: string) {
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${m.toString().padStart(2, '0')} ${ampm}`;
}

export default function Home() {
  const { user, profile, loading } = useUser();
  const { activeSport: contextSport, isAdmin, isBoardMember, isCoach } = useSport();
  const router = useRouter();
  const db = useFirestore();

  // Public sport selector — localStorage-only (no auth required)
  const [publicSport, setPublicSportState] = useState<Sport | null>(null);
  const [sportInitialized, setSportInitialized] = useState(false);
  // Track whether the user explicitly selected a sport on this page.
  // When true, we suppress the auto-redirect so they can click Register Player.
  const sportSelectedOnPage = useRef(false);
  useEffect(() => {
    const saved = localStorage.getItem('syba_active_sport') as Sport | null;
    if (saved === 'baseball' || saved === 'football') {
      setPublicSportState(saved);
    }
    setSportInitialized(true);
  }, []);
  function selectPublicSport(sport: Sport) {
    sportSelectedOnPage.current = true;
    setPublicSportState(sport);
    writeActiveSport(sport);
  }

  const todayISO = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);
  const weekEndISO = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  // Active season — registration banner (sport-specific, only when a sport is selected)
  const activeSeasonQuery = useMemoFirebase(() => {
    if (!db || !publicSport) return null;
    return query(collection(db, 'seasons'), where('sport', '==', publicSport), where('status', '==', 'active'), limit(1));
  }, [db, publicSport]);
  const { data: activeSeasons } = useCollection<ActiveSeason>(activeSeasonQuery);
  const activeSeason = activeSeasons?.[0] ?? null;

  // Complex closure — per-sport document (only loaded when a sport is selected)
  const closuresRef = useMemoFirebase(() => {
    if (!db || !publicSport) return null;
    return doc(db, 'settings', `complexClosures_${publicSport}`);
  }, [db, publicSport]);
  const { data: complexClosuresDoc } = useDoc<ComplexClosuresDocument>(closuresRef);

  // This week's games — only runs after a sport is selected
  const gamesQuery = useMemoFirebase(() => {
    if (!db || !publicSport) return null;
    return query(
      collection(db, 'games'),
      where('sport', '==', publicSport),
      where('date', '>=', todayISO),
      where('date', '<=', weekEndISO),
      orderBy('date', 'asc'),
      orderBy('time', 'asc'),
      limit(20)
    );
  }, [db, publicSport, todayISO, weekEndISO]);
  const { data: rawWeekGames } = useCollection<Game>(gamesQuery);

  // Announcements — scoped to selected sport (only loads after sport is chosen)
  const announcementsQuery = useMemoFirebase(() => {
    if (!db || !publicSport) return null;
    return query(collection(db, 'announcements'), where('sport', '==', publicSport), orderBy('publishedAt', 'desc'), limit(10));
  }, [db, publicSport]);
  const { data: rawAnnouncements } = useCollection<Announcement>(announcementsQuery);

  // Derived: sport-specific contact email (falls back to hub address when no sport selected)
  const contactEmail = publicSport ? SPORT_CONFIG[publicSport].contactEmail : HUB_contactEmail;

  // Officers (league leadership grid) — scoped to selected sport
  const officersQuery = useMemoFirebase(() => {
    if (!db || !publicSport) return null;
    return query(collection(db, 'officers'), where('sport', '==', publicSport), orderBy('order'));
  }, [db, publicSport]);
  const { data: officers } = useCollection<LeagueOfficer>(officersQuery);

  // Derived: registration banner
  const registrationBanner = useMemo(() => {
    if (!activeSeason) return null;
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (today < activeSeason.registrationOpen) {
      return { text: `Registration opens ${formatDate(activeSeason.registrationOpen)} for ${activeSeason.name}`, closed: false };
    }
    if (today <= activeSeason.registrationClose) {
      return { text: `Registration open for ${activeSeason.name} — closes ${formatDate(activeSeason.registrationClose)}`, closed: false };
    }
    return { text: `Registration for ${activeSeason.name} is now closed.`, closed: true };
  }, [activeSeason]);

  // Derived: today's complex closure (if any)
  const todayClosure = useMemo(
    () => complexClosuresDoc?.closures?.find(c => c.date === todayISO) ?? null,
    [complexClosuresDoc, todayISO],
  );

  // Derived: non-cancelled games this week, games only
  const visibleGames = useMemo(() => {
    if (!rawWeekGames) return [];
    return rawWeekGames.filter(g => g.type === 'game' && g.status !== 'cancelled');
  }, [rawWeekGames]);

  // Derived: games grouped by division name, "Unassigned" last
  const gamesByDivision = useMemo(() => {
    const map = new Map<string, typeof visibleGames>();
    for (const g of visibleGames) {
      const key = g.division ?? 'Unassigned';
      map.set(key, [...(map.get(key) ?? []), g]);
    }
    return map;
  }, [visibleGames]);

  const divisionOrder = useMemo(
    () => Array.from(gamesByDivision.keys()).sort((a, b) =>
      a === 'Unassigned' ? 1 : b === 'Unassigned' ? -1 : a.localeCompare(b)
    ),
    [gamesByDivision],
  );

  const filteredOfficers = useMemo(() => {
    if (!officers) return [];
    return officers.filter(o =>
      EXECUTIVE_TITLES.includes(o.title) &&
      o.name != null && o.name !== ''
    );
  }, [officers]);

  const fullBoardOfficers = useMemo(() => {
    if (!officers) return [];
    return officers.filter(o =>
      o.name != null && o.name !== ''
    );
  }, [officers]);

  // Derived: pinned announcements first, max 3
  const announcements = useMemo(() => {
    if (!rawAnnouncements) return [];
    return [...rawAnnouncements]
      .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
      .slice(0, 3);
  }, [rawAnnouncements]);

  useEffect(() => {
    // Wait for sport selection before redirecting — prevents an infinite loop where
    // the redirect fires before the user picks a sport, then the dashboard route triggers
    // <RedirectToHome />, which sends them back here, and so on.
    // Skip the auto-redirect if the user explicitly selected a sport on this page —
    // they are likely about to click "Register Player" and should not be redirected away.
    if (!loading && user && profile && contextSport && !sportSelectedOnPage.current) {
      if (isAdmin || isBoardMember) {
        router.push('/admin/dashboard');
      } else if (isCoach) {
        router.push('/coach/dashboard');
      } else {
        router.push('/parent/dashboard');
      }
    }
  }, [user, profile, loading, router, isAdmin, isBoardMember, isCoach, contextSport]);

  if (user && profile && contextSport && !sportSelectedOnPage.current) return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-10 w-10 animate-spin text-primary" />
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col items-center bg-gradient-to-b from-blue-50 to-white px-4 py-12">

      {/* ── Hero ── */}
      <div className="flex flex-col items-center text-center space-y-6 max-w-sm w-full">
        <Image
          src={publicSport ? SPORT_CONFIG[publicSport].logoUrl : HUB_LOGO_URL}
          alt={publicSport ? SPORT_CONFIG[publicSport].label : 'The League'}
          width={160}
          height={160}
          className="object-contain drop-shadow-md transition-all duration-300"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
        <div className="space-y-1">
          <h1 className="text-2xl font-bold font-headline tracking-tight text-primary">
            {publicSport ? SPORT_CONFIG[publicSport].label : 'The League'}
          </h1>
          <p className="text-muted-foreground text-sm">
            {publicSport ? 'Sharpsville Youth Athletics' : 'The online home for youth athletics'}
          </p>
        </div>

        {/* Register / Sign In — only after sport selection. Register Player is
            the primary action: on day one nearly every visitor is here to register. */}
        {publicSport && (
          <div className="w-full space-y-4">
            <div className="flex gap-3 justify-center">
              <Button size="lg" className="rounded-full px-8 shadow-md shadow-primary/20" asChild>
                <Link href={user
                  ? `/parent/enroll?sport=${publicSport}`
                  : `/login?redirect=/parent/enroll&sport=${publicSport}`
                }>
                  Register Player
                </Link>
              </Button>
              <Button variant="outline" size="lg" className="rounded-full px-8" asChild>
                <Link href={`/login?sport=${publicSport}`}>Sign In</Link>
              </Button>
            </div>
            {registrationBanner && !registrationBanner.closed && (
              <div className="w-full rounded-xl bg-primary/10 border border-primary/20 px-4 py-2.5 text-sm font-medium text-primary text-balance">
                {registrationBanner.text}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Sport Selection Gate — shown only for new visitors (no localStorage preference) ── */}
      {sportInitialized && !publicSport ? (
        <div className="mt-10 w-full max-w-lg text-center">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-6">
            Pick Your Sport
          </p>
          <div className="grid grid-cols-2 gap-8">
            {(Object.entries(SPORT_CONFIG) as [Sport, typeof SPORT_CONFIG[Sport]][]).map(([sport, cfg]) => (
              <button
                key={sport}
                onClick={() => selectPublicSport(sport)}
                className="flex flex-col items-center gap-3 p-4 rounded-2xl hover:scale-105 active:scale-95 transition-transform duration-150"
              >
                <Image
                  src={cfg.logoUrl}
                  alt={cfg.label}
                  width={120}
                  height={120}
                  className="object-contain drop-shadow-md"
                  onError={(e) => {
                    const img = e.target as HTMLImageElement;
                    img.style.display = 'none';
                    const fallback = img.nextElementSibling as HTMLElement | null;
                    if (fallback) fallback.style.display = 'block';
                  }}
                />
                <span className="text-5xl hidden" role="img" aria-label={cfg.label}>{cfg.icon}</span>
                <div>
                  <p className="text-xl font-bold font-headline">{cfg.label}</p>
                  <p className="text-sm text-muted-foreground">Youth {cfg.label} Association</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : publicSport ? (
        <>
          <button
            onClick={() => {
              setPublicSportState(null);
              clearActiveSport();
            }}
            className="mt-2 text-xs text-muted-foreground hover:text-primary underline underline-offset-2 transition-colors"
          >
            Change sport
          </button>

          {/* Contact */}
          <p className="mt-3 text-sm text-muted-foreground text-center">
            Have a question?{' '}
            <Link href="/contact" className="text-primary hover:underline font-medium">Contact us</Link>
          </p>
        </>
      ) : null}

      {/* ── Schedule & Content (visible only after sport selection) ── */}
      {publicSport && <>

      {/* Complex closure alert */}
      {todayClosure && (
        <div className="mt-6 w-full max-w-sm rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-2.5 text-sm text-destructive font-medium text-center flex items-center justify-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Complex closed today{todayClosure.reason ? ` — ${todayClosure.reason}` : ''}
        </div>
      )}

      {/* Registration banner — closed-only variant (open registration shown in hero eyebrow) */}
      {registrationBanner?.closed && (
        <div className="mt-4 w-full max-w-sm rounded-xl border px-4 py-2.5 text-sm font-medium text-center text-balance bg-muted/20 border-muted/30 text-muted-foreground">
          {registrationBanner.text}
        </div>
      )}

      {/* ── This Week's Games ── */}
      <div className="mt-10 w-full max-w-2xl">
        <div className="flex items-center gap-2 mb-3">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
            This Week&apos;s Games
          </p>
        </div>
        {visibleGames.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No games scheduled this week</p>
        ) : (
          <>
            {/* Mobile: date-pill scroller */}
            {(() => {
              const dates = [...new Set(visibleGames.map(g => g.date))];
              return dates.length > 1 ? (
                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2 mb-3 md:hidden">
                  {dates.map(d => {
                    const label = new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                    return (
                      <a
                        key={d}
                        href={`#games-${d}`}
                        className="shrink-0 px-3 py-1.5 rounded-full border bg-white/80 text-xs font-medium text-muted-foreground hover:text-primary hover:border-primary transition-colors whitespace-nowrap"
                      >
                        {label}
                      </a>
                    );
                  })}
                </div>
              ) : null;
            })()}
            {/* Desktop: 2-column grid grouped by day; Mobile: single column with day anchors */}
            {divisionOrder.map((div, divIdx) => (
              <div key={div}>
                <p className={cn(
                  'text-xs font-bold uppercase tracking-widest text-primary/60 mb-1.5 px-1',
                  divIdx > 0 && 'mt-3',
                )}>
                  {div}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {(gamesByDivision.get(div) ?? []).map(g => (
                    <div
                      key={g.id}
                      id={`games-${g.date}`}
                      className="rounded-xl border bg-white/80 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1"
                    >
                      <div>
                        <p className="font-medium text-sm">
                          {g.homeTeamName ?? 'TBD'} vs. {g.awayTeamName ?? 'TBD'}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-medium">{formatGameDate(g.date)}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatTime(g.time)}{g.fieldName ? ` · ${g.fieldName}` : ''}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* ── Announcements ── */}
      {announcements.length > 0 && (
        <div className="mt-10 w-full max-w-xl">
          <div className="flex items-center gap-2 mb-3">
            <Megaphone className="h-4 w-4 text-muted-foreground" />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
              Announcements
            </p>
          </div>
          <div className="flex flex-col gap-2">
            {announcements.map(a => (
              <div key={a.id} className="rounded-xl border bg-white/80 px-4 py-3">
                <div className="flex items-start gap-2">
                  {a.pinned && <Pin className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />}
                  <div className="min-w-0">
                    <p className="font-medium text-sm">{a.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{a.body}</p>
                    <p className="text-xs text-muted-foreground/70 mt-1">
                      {formatDate(a.publishedAt.slice(0, 10))}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-center mt-3">
            <Link href="/login" className="text-xs text-primary hover:underline">
              Sign in to see all announcements →
            </Link>
          </p>
        </div>
      )}

      {/* ── League Leadership ── */}
      {filteredOfficers.length > 0 && (
        <div className="mt-10 w-full max-w-xl">
          <div className="flex items-center gap-2 mb-3">
            <Users className="h-4 w-4 text-muted-foreground" />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
              League Leadership
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {filteredOfficers.map((o) => (
              <div key={o.id} className="rounded-xl border bg-white/80 px-4 py-3 flex flex-col gap-1.5">
                <p className="text-xs text-muted-foreground font-medium">{o.title}</p>
                <p className="text-sm font-semibold">{o.name ?? 'Position Vacant'}</p>
                {o.contactHint && (
                  <p className="text-xs text-muted-foreground">{o.contactHint}</p>
                )}
                <Link
                  href={`/contact?topic=${o.mappedTopic ?? 'general'}`}
                  className="text-xs text-primary hover:underline font-medium mt-auto"
                >
                  Message →
                </Link>
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-center">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="ghost" size="sm" className="text-xs text-primary">
                  View Full Board →
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Full Board of Directors</DialogTitle>
                </DialogHeader>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 py-2">
                  {fullBoardOfficers.map((o) => (
                    <div key={o.id} className="rounded-lg border bg-white/80 px-3 py-2">
                      <p className="text-xs text-muted-foreground leading-tight">{o.title}</p>
                      <p className="text-sm font-semibold leading-tight mt-0.5">{o.name}</p>
                    </div>
                  ))}
                </div>
                <div className="pt-2 flex justify-center">
                  <Button asChild size="sm">
                    <Link href="/contact">Contact the Board</Link>
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      )}

      {/* ── Sponsors ── */}
      {SPONSOR_IMAGES.length > 0 && (
        <div className="mt-12 flex flex-col items-center gap-4 w-full max-w-2xl">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Our Sponsors</p>
          <div className="flex flex-wrap items-center justify-center gap-8">
            {SPONSOR_IMAGES.map((src, i) => (
              <Image
                key={i}
                src={src}
                alt={`Sponsor ${i + 1}`}
                width={240}
                height={80}
                className="h-20 w-auto object-contain transition-all duration-300"
                style={{ width: 'auto' }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            ))}
          </div>
        </div>
      )}

      </>}

      {/* ── Footer ── */}
      <footer className="mt-12 text-xs text-muted-foreground text-center space-y-1">
        <p>© {new Date().getFullYear()} The League. All rights reserved.</p>
        <p>
          General inquiries:{' '}
          <a href={`mailto:${contactEmail}`} className="hover:text-primary hover:underline transition-colors">
            {contactEmail}
          </a>
        </p>
      </footer>
    </div>
  );
}
