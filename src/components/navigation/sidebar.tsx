"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useUser, useAuth, useFirestore, useMemoFirebase, useCollection } from '@/firebase';
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
  MessageSquare,
  Inbox,
} from 'lucide-react';
import { where, limit as firestoreLimit } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

const leagueAdminItems = [
  { label: 'Dashboard', icon: LayoutDashboard, href: '/admin/dashboard' },
  { label: 'Game Schedule', icon: CalendarDays, href: '/admin/games' },
  { label: 'Practice Slots', icon: Dumbbell, href: '/admin/practice-slots' },
  { label: 'Registrations', icon: BarChart3, href: '/admin/registration' },
  { label: 'Master Roster', icon: ClipboardList, href: '/admin/roster' },
  { label: 'Compliance Report', icon: FileCheck, href: '/admin/compliance' },
  { label: 'Teams', icon: Users, href: '/admin/teams' },
  { label: 'Fields', icon: MapPin, href: '/admin/fields' },
  { label: 'Concessions', icon: ShoppingCart, href: '/admin/concessions' },
  { label: 'Sponsorships', icon: Handshake, href: '/admin/sponsorships' },
  { label: 'Announcements', icon: Bell, href: '/admin/announcements' },
  { label: 'Board Meetings', icon: BookOpen, href: '/admin/board-meetings' },
  { label: 'Inquiries', icon: Inbox, href: '/admin/inquiries' },
  { label: 'Seasons', icon: Trophy, href: '/admin/seasons' },
];

const adminOnlyItems = [
  { label: 'User Roles', icon: ShieldCheck, href: '/admin/roles' },
  { label: 'Seed Data', icon: Database, href: '/admin/seed' },
  { label: 'Settings', icon: Settings, href: '/admin/settings' },
];

const coachItems = [
  { label: 'Dashboard', icon: LayoutDashboard, href: '/coach/dashboard' },
  { label: 'My Teams', icon: Users, href: '/coach/teams' },
  { label: 'Clearances', icon: FileCheck, href: '/coach/compliance' },
  { label: 'Schedules', icon: Calendar, href: '/coach/schedules' },
  { label: 'Practice Slots', icon: Dumbbell, href: '/coach/practice-slots' },
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
}: {
  label: string;
  items: { label: string; icon: React.ElementType; href: string; badge?: boolean }[];
  pathname: string;
  onNavigate: () => void;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <button
        onClick={onToggle}
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
        {items.map((item) => (
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
              <span className="ml-auto w-2 h-2 bg-red-500 rounded-full shrink-0" />
            )}
          </Link>
        ))}
      </div>
    </>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { profile, roles, isAdmin, isBoardMember, isCoach, isParent } = useUser();
  const auth = useAuth();
  const db = useFirestore();
  const router = useRouter();
  const isMobile = useIsMobile();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const [hasUnreadNotifs, setHasUnreadNotifs] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => ({
    'League Admin': pathname.startsWith('/admin/'),
    'Coaching': pathname.startsWith('/coach/'),
    'Family': pathname.startsWith('/parent/'),
  }));

  useEffect(() => {
    setOpenSections({
      'League Admin': pathname.startsWith('/admin/'),
      'Coaching': pathname.startsWith('/coach/'),
      'Family': pathname.startsWith('/parent/'),
    });
  }, [pathname]);

  // Unread in-app notifications badge (parents + coaches)
  const unreadNotifsQuery = useMemoFirebase(() => {
    if (!db || !profile || (!isParent && !isCoach)) return null;
    return query(
      collection(db, 'notifications'),
      where('userId', '==', profile.id),
      where('read', '==', false),
      firestoreLimit(1)
    );
  }, [db, profile?.id, isParent, isCoach]);
  const { data: unreadNotifs } = useCollection<{ id: string }>(unreadNotifsQuery);
  // Sync hasUnreadNotifs whenever the query result changes
  if ((unreadNotifs?.length ?? 0) > 0 !== hasUnreadNotifs) {
    setHasUnreadNotifs((unreadNotifs?.length ?? 0) > 0);
  }

  // Unread announcements badge
  const latestAnnouncementQuery = useMemoFirebase(() => {
    if (!db || !isParent) return null;
    return query(collection(db, 'announcements'), orderBy('publishedAt', 'desc'), limit(1));
  }, [db, isParent]);
  const { data: latestAnnouncements } = useCollection<{ id: string; publishedAt: string }>(latestAnnouncementQuery);

  useEffect(() => {
    if (!latestAnnouncements || latestAnnouncements.length === 0) return;
    const latest = latestAnnouncements[0];
    if (!latest.publishedAt) return;
    const lastRead = localStorage.getItem('syba_announcements_last_read');
    if (!lastRead) {
      setHasUnread(true);
      return;
    }
    setHasUnread(new Date(latest.publishedAt).getTime() > parseInt(lastRead, 10));
  }, [latestAnnouncements]);

  const toggleSection = (label: string) => {
    setOpenSections(prev => ({ ...prev, [label]: !prev[label] }));
  };

  const handleSignOut = async () => {
    await signOut(auth);
    router.push('/');
  };

  const closeMenu = () => setMobileOpen(false);

  const roleLabel = roles.join(' · ') || profile?.role || '';

  const sidebarInner = (
    <aside className="w-64 border-r bg-white flex flex-col h-[100dvh] fixed left-0 top-0 z-40">
      <div className="p-6 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2" onClick={closeMenu}>
          <Image src="/contentrotator637479479383661633.png" alt="SYBA" width={36} height={36} className="object-contain" />
          <span className="text-xl font-bold font-headline text-primary tracking-tight">SYBA Portal</span>
        </Link>
        {isMobile && (
          <button
            onClick={closeMenu}
            className="p-1 rounded-lg hover:bg-secondary text-muted-foreground"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <nav className="flex-1 px-4 overflow-y-auto space-y-1">
        {isBoardMember && (
          <NavSection
            label="League Admin"
            items={[
              ...leagueAdminItems,
              ...(isAdmin ? adminOnlyItems : []),
            ]}
            pathname={pathname}
            onNavigate={closeMenu}
            isOpen={openSections['League Admin']}
            onToggle={() => toggleSection('League Admin')}
          />
        )}

        {isCoach && (
          <NavSection
            label="Coaching"
            items={coachItems.map(item =>
              item.href === '/coach/notifications' ? { ...item, badge: hasUnreadNotifs } : item
            )}
            pathname={pathname}
            onNavigate={closeMenu}
            isOpen={openSections['Coaching']}
            onToggle={() => toggleSection('Coaching')}
          />
        )}

        {isParent && (
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
          />
        )}

        {/* Fallback for users with no recognized role */}
        {!isBoardMember && !isCoach && !isParent && (
          <div className="px-3 py-4 text-sm text-muted-foreground">
            No navigation available. Contact your administrator.
          </div>
        )}
      </nav>

      <div className="p-4 border-t space-y-4">
        <div className="px-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-primary font-bold">
            {profile?.displayName?.[0] || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{profile?.displayName}</p>
            <p className="text-xs text-muted-foreground truncate">{roleLabel}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          className="w-full justify-start text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          onClick={handleSignOut}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign Out
        </Button>
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
            className="p-2 rounded-lg hover:bg-secondary text-muted-foreground"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <Link href="/" className="flex items-center gap-2">
            <Image src="/contentrotator637479479383661633.png" alt="SYBA" width={30} height={30} className="object-contain" />
            <span className="text-lg font-bold font-headline text-primary tracking-tight">SYBA Portal</span>
          </Link>
        </div>

        {/* Drawer overlay + sidebar */}
        {mobileOpen && (
          <>
            <div
              className="fixed inset-0 bg-black/40 z-30"
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
