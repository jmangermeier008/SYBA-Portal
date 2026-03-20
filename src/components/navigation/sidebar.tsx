"use client";

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUser, useAuth } from '@/firebase';
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
  UserCog,
  BarChart3,
  MapPin,
  ShoppingCart,
  Handshake,
  Bell,
  BookOpen,
  CalendarDays,
} from 'lucide-react';
import { signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

interface SidebarProps {
  role: 'parent' | 'coach' | 'admin';
}

export function Sidebar({ role }: SidebarProps) {
  const pathname = usePathname();
  const { profile, isCoach } = useUser();
  const auth = useAuth();
  const router = useRouter();
  const isMobile = useIsMobile();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut(auth);
    router.push('/');
  };

  const navItems = {
    parent: [
      { label: 'Dashboard', icon: LayoutDashboard, href: '/parent/dashboard' },
      { label: 'My Family', icon: UserIcon, href: '/parent/family' },
      { label: 'Season Enrollment', icon: ClipboardList, href: '/parent/enroll' },
      { label: 'My Teams', icon: Users, href: '/parent/teams' },
      { label: 'Schedules', icon: Calendar, href: '/parent/schedules' },
      { label: 'Announcements', icon: Bell, href: '/parent/announcements' },
      { label: 'Concessions', icon: ShoppingCart, href: '/parent/concessions' },
      { label: 'Settings', icon: Settings, href: '/parent/settings' },
    ],
    coach: [
      { label: 'Dashboard', icon: LayoutDashboard, href: '/coach/dashboard' },
      { label: 'My Teams', icon: Users, href: '/coach/teams' },
      { label: 'Clearances', icon: FileCheck, href: '/coach/compliance' },
      { label: 'Practice Drills', icon: Dumbbell, href: '/coach/drills' },
      { label: 'Schedules', icon: Calendar, href: '/coach/schedules' },
    ],
    admin: [
      { label: 'Dashboard', icon: LayoutDashboard, href: '/admin/dashboard' },
      { label: 'Game Schedule', icon: CalendarDays, href: '/admin/games' },
      { label: 'Registrations', icon: BarChart3, href: '/admin/registration' },
      { label: 'Master Roster', icon: ClipboardList, href: '/admin/roster' },
      { label: 'Compliance Report', icon: FileCheck, href: '/admin/compliance' },
      { label: 'Teams', icon: Users, href: '/admin/teams' },
      { label: 'Fields', icon: MapPin, href: '/admin/fields' },
      { label: 'Concessions', icon: ShoppingCart, href: '/admin/concessions' },
      { label: 'Sponsorships', icon: Handshake, href: '/admin/sponsorships' },
      { label: 'Announcements', icon: Bell, href: '/admin/announcements' },
      { label: 'Board Meetings', icon: BookOpen, href: '/admin/board-meetings' },
      { label: 'User Roles', icon: ShieldCheck, href: '/admin/roles' },
      { label: 'Seasons', icon: Trophy, href: '/admin/seasons' },
      { label: 'Seed Data', icon: Database, href: '/admin/seed' },
      { label: 'Settings', icon: Settings, href: '/admin/settings' },
    ],
  };

  const items = navItems[role];
  // Show coach switch link for admins who also have coach access
  const showCoachSwitch = role === 'admin' && isCoach;

  const sidebarInner = (
    <aside className="w-64 border-r bg-white flex flex-col h-screen fixed left-0 top-0 z-40">
      <div className="p-6 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2" onClick={() => setMobileOpen(false)}>
          <Trophy className="h-6 w-6 text-primary" />
          <span className="text-xl font-bold font-headline text-primary tracking-tight">SYBA Portal</span>
        </Link>
        {isMobile && (
          <button
            onClick={() => setMobileOpen(false)}
            className="p-1 rounded-lg hover:bg-secondary text-muted-foreground"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMobileOpen(false)}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
              pathname === item.href
                ? "bg-primary text-white shadow-md shadow-primary/20"
                : "text-muted-foreground hover:bg-secondary hover:text-primary"
            )}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        ))}

        {showCoachSwitch && (
          <>
            <div className="pt-3 pb-1 px-3">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Coach View</p>
            </div>
            <Link
              href="/coach/dashboard"
              onClick={() => setMobileOpen(false)}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                pathname.startsWith('/coach')
                  ? "bg-primary text-white shadow-md shadow-primary/20"
                  : "text-muted-foreground hover:bg-secondary hover:text-primary"
              )}
            >
              <UserCog className="h-4 w-4 shrink-0" />
              Switch to Coach View
            </Link>
          </>
        )}

        {role === 'coach' && profile?.role === 'Admin' && (
          <>
            <div className="pt-3 pb-1 px-3">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Admin View</p>
            </div>
            <Link
              href="/admin/dashboard"
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-primary transition-colors"
            >
              <ShieldCheck className="h-4 w-4 shrink-0" />
              Back to Admin
            </Link>
          </>
        )}
      </nav>

      <div className="p-4 border-t space-y-4">
        <div className="px-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-primary font-bold">
            {profile?.displayName?.[0] || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{profile?.displayName}</p>
            <p className="text-xs text-muted-foreground truncate">
              {profile?.role}{profile?.isAlsoCoach ? ' · Coach' : ''}
            </p>
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
            <Trophy className="h-5 w-5 text-primary" />
            <span className="text-lg font-bold font-headline text-primary tracking-tight">SYBA Portal</span>
          </Link>
        </div>

        {/* Drawer overlay + sidebar */}
        {mobileOpen && (
          <>
            <div
              className="fixed inset-0 bg-black/40 z-30"
              onClick={() => setMobileOpen(false)}
            />
            {sidebarInner}
          </>
        )}
      </>
    );
  }

  return sidebarInner;
}
