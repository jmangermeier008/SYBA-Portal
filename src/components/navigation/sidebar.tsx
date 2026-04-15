"use client";

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useUser, useAuth, useFirestore, useMemoFirebase, useCollection, useSport } from '@/firebase';
import { SPORT_CONFIG, HUB_LOGO_URL } from '@/config/sports';
import { collection, query, orderBy, limit } from 'firebase/firestore';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Trophy,
  LayoutDashboard,
  Users,
  Calendar,
  Settings,
  ShieldCheck,
  Dumbbell,
  LogOut,
  User as UserIcon,
  ClipboardList,
  FileCheck,
  Database,
  Menu,
  X,
  BarChart3,
  MapPin,
  ShoppingCart,
  Handshake,
  Bell,
  BookOpen,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Inbox,
  Layers,
  Megaphone,
  Briefcase,
  FlaskConical,
} from 'lucide-react';
import { where, limit as firestoreLimit } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// ── Role context helpers ─────────────────────────────────────────────────────

type RoleContext = 'admin' | 'coach' | 'parent';

function getRoleContexts(roles: string[]): { context: RoleContext; label: string }[] {
  const contexts: { context: RoleContext; label: string }[] = [];
  if (roles.some(r => ['Board Member', 'Admin', 'Site Admin'].includes(r))) {
    contexts.push({ context: 'admin', label: 'League Admin' });
  }
  if (roles.includes('Coach')) contexts.push({ context: 'coach', label: 'Coach' });
  if (roles.includes('Parent')) contexts.push({ context: 'parent', label: 'Parent' });
  return contexts;
}

function getDefaultContext(roles: string[]): RoleContext {
  if (roles.some(r => ['Board Member', 'Admin', 'Site Admin'].includes(r))) return 'admin';
  if (roles.includes('Coach')) return 'coach';
  return 'parent';
}

// ── Admin nav groups ──────────────────────────────────────────────────────────

const adminSeasonItems = [
  { label: 'Game Schedule', icon: CalendarDays, href: '/admin/games' },
  { label: 'Standings', icon: BarChart3, href: '/admin/standings' },
  { label: 'League Calendar', icon: Calendar, href: '/admin/calendar' },
  { label: 'Practice Slots', icon: Dumbbell, href: '/admin/practice-slots' },
  { label: 'Seasons', icon: Trophy, href: '/admin/seasons' },
  { label: 'Concessions', icon: ShoppingCart, href: '/admin/concessions' },
];

const adminPeopleItems = [
  { label: 'Registrations', icon: BarChart3, href: '/admin/registration' },
  { label: 'Master Roster', icon: ClipboardList, href: '/admin/roster' },
  { label: 'Compliance Report', icon: FileCheck, href: '/admin/compliance' },
  { label: 'Teams', icon: Users, href: '/admin/teams' },
  { label: 'Divisions', icon: Layers, href: '/admin/divisions' },
];

const adminFacilitiesItems = [
  { label: 'Fields', icon: MapPin, href: '/admin/fields' },
  { label: 'Sponsorships', icon: Handshake, href: '/admin/sponsorships' },
];

const adminCommsItems = [
  { label: 'Announcements', icon: Bell, href: '/admin/announcements' },
  { label: 'Board Meetings', icon: BookOpen, href: '/admin/board-meetings' },
  { label: 'Inquiries', icon: Inbox, href: '/admin/inquiries' },
];

const adminSystemBaseItems = [
  { label: 'Data Management', icon: Database, href: '/admin/import' },
];

const adminSystemAdminItems = [
  { label: 'User Roles', icon: ShieldCheck, href: '/admin/roles' },
  { label: 'Settings', icon: Settings, href: '/admin/settings' },
  { label: 'Developer', icon: FlaskConical, href: '/admin/developer' },
];

function getAdminSectionForPath(p: string): string | null {
  if (['/admin/games', '/admin/standings', '/admin/calendar', '/admin/practice-slots', '/admin/seasons', '/admin/concessions'].some(r => p === r || p.startsWith(r + '/'))) return 'Season Management';
  if (['/admin/registration', '/admin/roster', '/admin/compliance', '/admin/teams', '/admin/divisions'].some(r => p === r || p.startsWith(r + '/'))) return 'People & Teams';
  if (['/admin/fields', '/admin/sponsorships'].some(r => p === r || p.startsWith(r + '/'))) return 'Facilities & Finance';
  if (['/admin/announcements', '/admin/board-meetings', '/admin/inquiries'].some(r => p === r || p.startsWith(r + '/'))) return 'Communications';
  if (['/admin/import', '/admin/roles', '/admin/settings', '/admin/developer'].some(r => p === r || p.startsWith(r + '/'))) return 'System';
  return null;
}

const coachItems = [
  { label: 'Dashboard', icon: LayoutDashboard, href: '/coach/dashboard' },
  { label: 'My Teams', icon: Users, href: '/coach/teams' },
  { label: 'Clearances', icon: FileCheck, href: '/coach/compliance' },
  { label: 'Schedules', icon: Calendar, href: '/coach/schedules' },
  { label: 'Practice Slots', icon: Dumbbell, href: '/coach/practice-slots' },
  { label: 'Announcements', icon: Megaphone, href: '/coach/announcements' },
  { label: 'Notifications', icon: Bell, href: '/coach/notifications' },
  { label: 'Contact Us', icon: MessageSquare, href: '/coach/contact' },
];

const parentItems = [
  { label: 'Dashboard', icon: LayoutDashboard, href: '/parent/dashboard' },
  { label: 'My Family', icon: UserIcon, href: '/parent/family' },
  { label: 'Season Enrollment', icon: ClipboardList, href: '/parent/enroll' },
  { label: 'My Teams', icon: Users, href: '/parent/teams' },
  { label: 'Schedules', icon: Calendar, href: '/parent/schedules' },
  { label: 'Announcements', icon: Bell, href: '/parent/announcements' },
  { label: 'Concessions', icon: ShoppingCart, href: '/parent/concessions' },
  { label: 'Notifications', icon: Inbox, href: '/parent/notifications' },
  { label: 'Contact Us', icon: MessageSquare, href: '/parent/contact' },
  { label: 'Settings', icon: Settings, href: '/parent/settings' },
];

function NavSection({
  label,
  items,
  pathname,
  onNavigate,
  isOpen,
  onToggle,
  collapsed,
  sectionIcon,
}: {
  label: string;
  items: { label: string; icon: React.ElementType; href: string; badge?: boolean; comingSoon?: boolean }[];
  pathname: string;
  onNavigate: () => void;
  isOpen: boolean;
  onToggle: () => void;
  collapsed: boolean;
  sectionIcon?: React.ElementType;
}) {
  const [flyoutOpen, setFlyoutOpen] = useState(false);

  const isSectionActive = items.some(
    item => pathname === item.href || pathname.startsWith(item.href + '/')
  );

  if (collapsed) {
    const Icon = sectionIcon ?? items[0]?.icon ?? LayoutDashboard;

    return (
      <div
        className="relative flex flex-col items-center mt-2"
        onMouseEnter={() => setFlyoutOpen(true)}
        onMouseLeave={() => setFlyoutOpen(false)}
      >
        <button
          title={label}
          className={cn(
            "flex items-center justify-center w-11 h-11 rounded-lg transition-colors",
            isSectionActive
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-secondary hover:text-primary"
          )}
        >
          <Icon className="h-4 w-4 shrink-0" />
        </button>

        {flyoutOpen && (
          <div className="absolute left-full top-0 ml-2 z-50 bg-white border border-border rounded-lg shadow-lg py-1 min-w-[200px]">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest px-3 py-1.5 border-b border-border/40">
              {label}
            </p>
            {items.map((item) =>
              item.comingSoon ? (
                <div
                  key={item.href}
                  className="flex items-center gap-2.5 px-3 py-2 text-sm font-medium text-muted-foreground/40 cursor-not-allowed"
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                  <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/50">Soon</span>
                </div>
              ) : (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => { onNavigate(); setFlyoutOpen(false); }}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2 text-sm font-medium transition-colors",
                    pathname === item.href || pathname.startsWith(item.href + '/')
                      ? "bg-primary text-white"
                      : "text-muted-foreground hover:bg-secondary hover:text-primary"
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                  {item.badge && (
                    <span aria-hidden="true" className="ml-auto w-2 h-2 bg-red-500 rounded-full shrink-0" />
                  )}
                </Link>
              )
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <button
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-label={`${label} navigation section`}
        className="w-full flex items-center justify-between px-3 py-2 mt-4 rounded-lg hover:bg-secondary/50 transition-colors"
      >
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">{label}</p>
        <ChevronDown className={cn(
          "h-3 w-3 text-muted-foreground transition-transform duration-200",
          isOpen && "rotate-180"
        )} />
      </button>
      <div className={cn(
        "overflow-hidden transition-all duration-200",
        isOpen ? "max-h-[600px] opacity-100" : "max-h-0 opacity-0"
      )}>
        {items.map((item) =>
          item.comingSoon ? (
            <div
              key={item.href}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground/40 cursor-not-allowed"
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
              <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/50">Coming Soon</span>
            </div>
          ) : (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                pathname === item.href || pathname.startsWith(item.href + '/')
                  ? "bg-primary text-white shadow-md shadow-primary/20"
                  : "text-muted-foreground hover:bg-secondary hover:text-primary"
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
              {item.badge && (
                <span aria-hidden="true" className="ml-auto w-2 h-2 bg-red-500 rounded-full shrink-0" />
              )}
            </Link>
          )
        )}
      </div>
    </>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { profile, roles } = useUser();
  const { activeSport, isAdmin, isSiteAdmin, isBoardMember, isCoach, isParent } = useSport();
  const auth = useAuth();
  const db = useFirestore();
  const router = useRouter();
  const isMobile = useIsMobile();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const [hasUnreadCoach, setHasUnreadCoach] = useState(false);
  const [hasUnreadNotifs, setHasUnreadNotifs] = useState(false);
  const [activeContext, setActiveContext] = useState<RoleContext | null>(null);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    const adminSection = getAdminSectionForPath(pathname);
    return {
      'Season Management': adminSection === 'Season Management',
      'People & Teams': adminSection === 'People & Teams',
      'Facilities & Finance': adminSection === 'Facilities & Finance',
      'Communications': adminSection === 'Communications',
      'System': adminSection === 'System',
      'Coaching': pathname.startsWith('/coach/'),
      'Family': pathname.startsWith('/parent/'),
    };
  });

  // Restore collapsed state from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('syba_sidebar_collapsed');
    if (saved === 'true') setCollapsed(true);
  }, []);

  // Sync collapsed class on <html> for CSS variable override
  useEffect(() => {
    if (collapsed) {
      document.documentElement.classList.add('sidebar-collapsed');
    } else {
      document.documentElement.classList.remove('sidebar-collapsed');
    }
  }, [collapsed]);

  const toggleCollapsed = () => {
    setCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('syba_sidebar_collapsed', String(next));
      return next;
    });
  };

  useEffect(() => {
    const adminSection = getAdminSectionForPath(pathname);
    if (adminSection) {
      // Accordion: close all, open only the matching section
      setOpenSections(prev => {
        const allClosed = Object.fromEntries(Object.keys(prev).map(k => [k, false]));
        return { ...allClosed, [adminSection]: true };
      });
    } else if (pathname.startsWith('/coach/')) {
      setOpenSections(prev => {
        const allClosed = Object.fromEntries(Object.keys(prev).map(k => [k, false]));
        return { ...allClosed, 'Coaching': true };
      });
    } else if (pathname.startsWith('/parent/')) {
      setOpenSections(prev => {
        const allClosed = Object.fromEntries(Object.keys(prev).map(k => [k, false]));
        return { ...allClosed, 'Family': true };
      });
    }
  }, [pathname]);

  // Initialize active role context from localStorage once roles are available
  useEffect(() => {
    if (roles.length === 0) return;
    const availableContexts = getRoleContexts(roles).map(c => c.context);
    const saved = localStorage.getItem('syba_active_role') as RoleContext | null;
    if (saved && availableContexts.includes(saved)) {
      setActiveContext(saved);
    } else {
      setActiveContext(getDefaultContext(roles));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roles.join(',')]);

  const handleContextSwitch = useCallback((context: RoleContext) => {
    setActiveContext(context);
    localStorage.setItem('syba_active_role', context);
    if (context === 'admin') {
      const activeAdminSection = getAdminSectionForPath(pathname) ?? 'Season Management';
      setOpenSections(prev => {
        const allClosed = Object.fromEntries(Object.keys(prev).map(k => [k, false]));
        return { ...allClosed, [activeAdminSection]: true };
      });
    } else {
      const sectionLabel = context === 'coach' ? 'Coaching' : 'Family';
      setOpenSections(prev => {
        const allClosed = Object.fromEntries(Object.keys(prev).map(k => [k, false]));
        return { ...allClosed, [sectionLabel]: true };
      });
    }
  }, [pathname]);

  // Unread in-app notifications badge (parents + coaches)
  // Fetches recent unread notifications, then filters client-side by activeSport or isGlobal.
  const unreadNotifsQuery = useMemoFirebase(() => {
    if (!db || !profile || (!isParent && !isCoach)) return null;
    return query(
      collection(db, 'notifications'),
      where('userId', '==', profile.id),
      where('read', '==', false),
      firestoreLimit(50)
    );
  }, [db, profile?.id, isParent, isCoach]);
  const { data: unreadNotifs } = useCollection<{ id: string; sport?: string; isGlobal?: boolean }>(unreadNotifsQuery);
  useEffect(() => {
    const sportFiltered = (unreadNotifs ?? []).filter(
      n => n.isGlobal || !n.sport || n.sport === activeSport
    );
    setHasUnreadNotifs(sportFiltered.length > 0);
  }, [unreadNotifs, activeSport]);

  // Unread announcements badge (shared query for both parent and coach)
  const latestAnnouncementQuery = useMemoFirebase(() => {
    if (!db || (!isParent && !isCoach)) return null;
    return query(collection(db, 'announcements'), orderBy('publishedAt', 'desc'), limit(1));
  }, [db, isParent, isCoach]);
  const { data: latestAnnouncements } = useCollection<{ id: string; publishedAt: string }>(latestAnnouncementQuery);

  useEffect(() => {
    if (!latestAnnouncements || latestAnnouncements.length === 0) return;
    const latest = latestAnnouncements[0];
    if (!latest.publishedAt) return;
    const latestTime = new Date(latest.publishedAt).getTime();

    if (isParent) {
      const lastRead = localStorage.getItem('syba_announcements_last_read');
      setHasUnread(!lastRead || latestTime > parseInt(lastRead, 10));
    }
    if (isCoach) {
      const lastRead = localStorage.getItem('syba_coach_announcements_last_read');
      setHasUnreadCoach(!lastRead || latestTime > parseInt(lastRead, 10));
    }
  }, [latestAnnouncements, isParent, isCoach]);

  const toggleSection = (label: string) => {
    setOpenSections(prev => {
      const isCurrentlyOpen = prev[label];
      const allClosed = Object.fromEntries(Object.keys(prev).map(k => [k, false]));
      return { ...allClosed, [label]: !isCurrentlyOpen };
    });
  };

  const handleSignOut = async () => {
    await signOut(auth);
    router.push('/');
  };

  const closeMenu = () => setMobileOpen(false);

  // Close mobile drawer on Escape key
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeMenu(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  const roleLabel = roles.join(' · ') || profile?.role || '';
  const roleContexts = getRoleContexts(roles);

  const isDashboardActive = pathname === '/admin/dashboard' || pathname.startsWith('/admin/dashboard/');

  const sidebarInner = (
    <aside className={cn(
      "border-r bg-white flex flex-col h-[100dvh] fixed left-0 top-0 z-40 transition-all duration-300",
      collapsed && !isMobile ? "w-16" : "w-64"
    )}>
      <div className={cn("p-4 flex items-center", collapsed && !isMobile ? "justify-center" : "justify-between px-6")}>
        <Link href="/" className="flex flex-col items-center gap-1" onClick={closeMenu}>
          <Image
            src={activeSport ? SPORT_CONFIG[activeSport].logoUrl : HUB_LOGO_URL}
            alt={activeSport ? SPORT_CONFIG[activeSport].acronym : 'Hub'}
            width={36}
            height={36}
            className="object-contain shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).src = HUB_LOGO_URL; }}
          />
          {(!collapsed || isMobile) && activeSport && (
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {SPORT_CONFIG[activeSport].acronym}
            </span>
          )}
        </Link>
        {isMobile && (
          <button
            onClick={closeMenu}
            className="p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-secondary text-muted-foreground"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <nav className={cn("flex-1 overflow-y-auto space-y-1", collapsed && !isMobile ? "px-1" : "px-4")}>
        {/* Role context switcher — dropdown in expanded mode, icon buttons in collapsed mode */}
        {roleContexts.length > 1 && activeContext && (
          collapsed && !isMobile ? (
            <div className="flex flex-col items-center gap-1 pt-2 pb-1">
              {roleContexts.map(c => (
                <button
                  key={c.context}
                  onClick={() => handleContextSwitch(c.context)}
                  title={`Switch to ${c.label}`}
                  className={cn(
                    "w-11 h-11 rounded-full text-xs font-bold transition-colors",
                    activeContext === c.context
                      ? "bg-primary text-white"
                      : "bg-secondary text-muted-foreground hover:text-primary"
                  )}
                >
                  {c.label[0]}
                </button>
              ))}
            </div>
          ) : (
            <div className="pt-3 pb-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest px-1 mb-1.5">Acting as</p>
              <Select value={activeContext} onValueChange={(v) => handleContextSwitch(v as RoleContext)}>
                <SelectTrigger className="w-full text-sm bg-secondary border-border/50 text-primary font-medium h-9 focus:ring-primary/30">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roleContexts.map(c => (
                    <SelectItem key={c.context} value={c.context}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )
        )}

        {activeContext === 'admin' && (isAdmin || isBoardMember || isSiteAdmin) && (
          <>
            {/* Standalone Dashboard link */}
            {collapsed && !isMobile ? (
              <div className="flex flex-col items-center gap-1 mt-2">
                <Link
                  href="/admin/dashboard"
                  onClick={closeMenu}
                  title="Dashboard"
                  className={cn(
                    "relative flex items-center justify-center w-11 h-11 rounded-lg transition-colors",
                    isDashboardActive
                      ? "bg-primary text-white shadow-md shadow-primary/20"
                      : "text-muted-foreground hover:bg-secondary hover:text-primary"
                  )}
                >
                  <LayoutDashboard className="h-4 w-4 shrink-0" />
                </Link>
              </div>
            ) : (
              <Link
                href="/admin/dashboard"
                onClick={closeMenu}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors mt-2",
                  isDashboardActive
                    ? "bg-primary text-white shadow-md shadow-primary/20"
                    : "text-muted-foreground hover:bg-secondary hover:text-primary"
                )}
              >
                <LayoutDashboard className="h-4 w-4 shrink-0" />
                Dashboard
              </Link>
            )}

            <NavSection
              label="Season Management"
              sectionIcon={CalendarDays}
              items={adminSeasonItems.map(item =>
                activeSport === 'football' && item.href === '/admin/practice-slots'
                  ? { ...item, comingSoon: true }
                  : item
              )}
              pathname={pathname}
              onNavigate={closeMenu}
              isOpen={openSections['Season Management']}
              onToggle={() => toggleSection('Season Management')}
              collapsed={collapsed && !isMobile}
            />
            <hr className="border-border/40 mx-2 my-1" />
            <NavSection
              label="People & Teams"
              sectionIcon={Users}
              items={adminPeopleItems.map(item =>
                activeSport === 'football' && item.href === '/admin/teams'
                  ? { ...item, comingSoon: true }
                  : item
              )}
              pathname={pathname}
              onNavigate={closeMenu}
              isOpen={openSections['People & Teams']}
              onToggle={() => toggleSection('People & Teams')}
              collapsed={collapsed && !isMobile}
            />
            <hr className="border-border/40 mx-2 my-1" />
            <NavSection
              label="Facilities & Finance"
              sectionIcon={Briefcase}
              items={adminFacilitiesItems}
              pathname={pathname}
              onNavigate={closeMenu}
              isOpen={openSections['Facilities & Finance']}
              onToggle={() => toggleSection('Facilities & Finance')}
              collapsed={collapsed && !isMobile}
            />
            <hr className="border-border/40 mx-2 my-1" />
            <NavSection
              label="Communications"
              sectionIcon={Megaphone}
              items={adminCommsItems}
              pathname={pathname}
              onNavigate={closeMenu}
              isOpen={openSections['Communications']}
              onToggle={() => toggleSection('Communications')}
              collapsed={collapsed && !isMobile}
            />
            <hr className="border-border/40 mx-2 my-1" />
            <NavSection
              label="System"
              sectionIcon={Settings}
              items={[...adminSystemBaseItems, ...(isSiteAdmin ? adminSystemAdminItems : [])]}
              pathname={pathname}
              onNavigate={closeMenu}
              isOpen={openSections['System']}
              onToggle={() => toggleSection('System')}
              collapsed={collapsed && !isMobile}
            />
          </>
        )}

        {activeContext === 'coach' && isCoach && (
          <NavSection
            label="Coaching"
            items={coachItems.map(item => {
              if (item.href === '/coach/notifications') return { ...item, badge: hasUnreadNotifs };
              if (item.href === '/coach/announcements') return { ...item, badge: hasUnreadCoach };
              return item;
            })}
            pathname={pathname}
            onNavigate={closeMenu}
            isOpen={openSections['Coaching']}
            onToggle={() => toggleSection('Coaching')}
            collapsed={collapsed && !isMobile}
          />
        )}

        {activeContext === 'parent' && isParent && (
          <NavSection
            label="Family"
            items={parentItems.map(item => {
              if (item.href === '/parent/announcements') return { ...item, badge: hasUnread };
              if (item.href === '/parent/notifications') return { ...item, badge: hasUnreadNotifs };
              return item;
            })}
            pathname={pathname}
            onNavigate={closeMenu}
            isOpen={openSections['Family']}
            onToggle={() => toggleSection('Family')}
            collapsed={collapsed && !isMobile}
          />
        )}

        {!isAdmin && !isSiteAdmin && !isBoardMember && !isCoach && !isParent && (
          <div className={cn("py-4 text-sm text-muted-foreground", collapsed && !isMobile ? "hidden" : "px-3")}>
            No navigation available. Contact your administrator.
          </div>
        )}
      </nav>

      <div className={cn("border-t space-y-2", collapsed && !isMobile ? "p-2" : "p-4")}>
        {/* User info */}
        {(!collapsed || isMobile) && (
          <div className="px-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-primary font-bold shrink-0">
              {profile?.displayName?.[0] || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{profile?.displayName}</p>
              <p className="text-xs text-muted-foreground truncate">{roleLabel}</p>
            </div>
          </div>
        )}
        {collapsed && !isMobile && (
          <div className="flex justify-center">
            <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-primary font-bold" title={profile?.displayName || 'User'}>
              {profile?.displayName?.[0] || 'U'}
            </div>
          </div>
        )}

        {/* Sign out */}
        {collapsed && !isMobile ? (
          <button
            onClick={handleSignOut}
            title="Sign Out"
            className="w-full flex items-center justify-center p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          >
            <LogOut className="h-4 w-4" />
          </button>
        ) : (
          <Button
            variant="ghost"
            className="w-full justify-start text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            onClick={handleSignOut}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out
          </Button>
        )}

        {/* Collapse toggle — desktop only */}
        {!isMobile && (
          <button
            onClick={toggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn(
              "w-full flex items-center p-2 rounded-lg text-muted-foreground hover:bg-secondary hover:text-primary transition-colors text-xs font-medium",
              collapsed ? "justify-center" : "justify-start gap-2 px-3"
            )}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <>
                <ChevronLeft className="h-4 w-4" />
                Collapse
              </>
            )}
          </button>
        )}
      </div>
    </aside>
  );

  if (isMobile) {
    return (
      <>
        {/* Fixed mobile top bar */}
        <div className="fixed top-0 left-0 right-0 h-14 bg-white border-b z-30 flex items-center px-4 gap-3">
          <button
            onClick={() => setMobileOpen(true)}
            className="relative p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-secondary text-muted-foreground"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
            {(hasUnread || hasUnreadNotifs) && (
              <span aria-hidden="true" className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />
            )}
          </button>
          <Link href="/" className="flex flex-col items-center gap-0.5">
            <Image
              src={activeSport ? SPORT_CONFIG[activeSport].logoUrl : HUB_LOGO_URL}
              alt={activeSport ? SPORT_CONFIG[activeSport].acronym : 'Hub'}
              width={30}
              height={30}
              className="object-contain"
              onError={(e) => { (e.target as HTMLImageElement).src = HUB_LOGO_URL; }}
            />
            {activeSport && (
              <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                {SPORT_CONFIG[activeSport].acronym}
              </span>
            )}
          </Link>
          {activeContext && roleContexts.length > 1 && (
            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium shrink-0">
              {roleContexts.find(c => c.context === activeContext)?.label}
            </span>
          )}
        </div>

        {/* Drawer overlay + sidebar */}
        {mobileOpen && (
          <>
            <div
              className="fixed inset-0 bg-black/40 z-[29]"
              onClick={closeMenu}
            />
            {sidebarInner}
          </>
        )}
      </>
    );
  }

  return sidebarInner;
}
