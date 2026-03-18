
"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUser, useAuth } from '@/firebase';
import { cn } from '@/lib/utils';
import {
  Trophy,
  LayoutDashboard,
  Users,
  Calendar,
  MessageSquare,
  Settings,
  ShieldCheck,
  Dumbbell,
  LogOut,
  User as UserIcon,
  ClipboardList,
  FolderLock
} from 'lucide-react';
import { signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

interface SidebarProps {
  role: 'parent' | 'coach' | 'admin';
}

export function Sidebar({ role }: SidebarProps) {
  const pathname = usePathname();
  const { profile } = useUser();
  const auth = useAuth();
  const router = useRouter();

  const handleSignOut = async () => {
    await signOut(auth);
    router.push('/');
  };

  const navItems = {
    parent: [
      { label: 'Dashboard', icon: LayoutDashboard, href: '/parent/dashboard' },
      { label: 'My Family', icon: UserIcon, href: '/parent/family' },
      { label: 'My Teams', icon: Users, href: '/parent/teams' },
      { label: 'Schedules', icon: Calendar, href: '/parent/schedules' },
      { label: 'Team Chat', icon: MessageSquare, href: '/parent/chat' },
      { label: 'Settings', icon: FolderLock, href: '/parent/settings' },
    ],
    coach: [
      { label: 'Dashboard', icon: LayoutDashboard, href: '/coach/dashboard' },
      { label: 'My Teams', icon: Users, href: '/coach/teams' },
      { label: 'Practice Drills', icon: Dumbbell, href: '/coach/drills' },
      { label: 'Schedules', icon: Calendar, href: '/coach/schedules' },
      { label: 'Team Chat', icon: MessageSquare, href: '/coach/chat' },
    ],
    admin: [
      { label: 'Dashboard', icon: LayoutDashboard, href: '/admin/dashboard' },
      { label: 'Master Roster', icon: ClipboardList, href: '/admin/roster' },
      { label: 'Teams', icon: Users, href: '/admin/teams' },
      { label: 'User Roles', icon: ShieldCheck, href: '/admin/roles' },
      { label: 'Seasons', icon: Trophy, href: '/admin/seasons' },
      { label: 'Settings', icon: Settings, href: '/admin/settings' },
    ],
  };

  const items = navItems[role];

  return (
    <aside className="w-64 border-r bg-white flex flex-col h-screen fixed left-0 top-0 z-40">
      <div className="p-6">
        <Link href="/" className="flex items-center gap-2">
          <Trophy className="h-6 w-6 text-primary" />
          <span className="text-xl font-bold font-headline text-primary tracking-tight">SYBA Portal</span>
        </Link>
      </div>

      <nav className="flex-1 px-4 space-y-1">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
              pathname === item.href
                ? "bg-primary text-white shadow-md shadow-primary/20"
                : "text-muted-foreground hover:bg-secondary hover:text-primary"
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="p-4 border-t space-y-4">
        <div className="px-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-primary font-bold">
            {profile?.displayName?.[0] || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{profile?.displayName}</p>
            <p className="text-xs text-muted-foreground truncate">{profile?.role}</p>
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
}
