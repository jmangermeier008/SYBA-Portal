"use client";

import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Package, Search, PackagePlus, Undo2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  sizesForType,
  typeLabel,
  type ShedItem,
  type TypeLabelOverrides,
} from '@/lib/equipment';

function ShedStatusPill({ status }: { status: ShedItem['status'] }) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
      status === 'available' && 'bg-green-100 text-green-700',
      status === 'issued' && 'bg-blue-100 text-blue-700',
      status === 'retired' && 'bg-muted text-muted-foreground'
    )}>
      {status === 'available' ? 'Available' : status === 'issued' ? 'Issued' : 'Retired'}
    </span>
  );
}

/** Read-mostly shed browser for coaches: stock levels, tag/player search, and
 *  issue/return actions where the coach's permissions allow them. All data and
 *  commit handlers come from the page — this component is presentational. */
export function CoachShedTab({
  items,
  isLoading,
  labels,
  playerNameById,
  coachEnrollmentIds,
  onIssue,
  onReturn,
  saving,
}: {
  items: ShedItem[] | null;
  isLoading: boolean;
  labels?: TypeLabelOverrides;
  playerNameById: Map<string, string>;
  coachEnrollmentIds: Set<string>;
  onIssue: (item: ShedItem) => void;
  onReturn: (item: ShedItem) => void;
  saving: boolean;
}) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'available' | 'issued'>('all');

  // Retired items are excluded — coaches can't act on them and they add noise
  const activeItems = useMemo(
    () => (items ?? []).filter((i) => i.status !== 'retired'),
    [items]
  );

  const stockByType = useMemo(() => {
    const map = new Map<string, { available: number; bySize: Map<string, number> }>();
    activeItems.forEach((item) => {
      const entry = map.get(item.type) ?? { available: 0, bySize: new Map<string, number>() };
      if (item.status === 'available') {
        entry.available += 1;
        entry.bySize.set(item.size, (entry.bySize.get(item.size) ?? 0) + 1);
      } else if (!entry.bySize.has(item.size)) {
        entry.bySize.set(item.size, 0);
      }
      map.set(item.type, entry);
    });
    return [...map.entries()]
      .map(([slug, entry]) => {
        const list = sizesForType(slug);
        const sizes = [...entry.bySize.entries()].sort((a, b) => {
          if (list) {
            const ia = list.indexOf(a[0]);
            const ib = list.indexOf(b[0]);
            if (ia !== -1 || ib !== -1) return (ia === -1 ? list.length : ia) - (ib === -1 ? list.length : ib);
          }
          return a[0].localeCompare(b[0], undefined, { numeric: true });
        });
        return { slug, available: entry.available, sizes };
      })
      .sort((a, b) => typeLabel(a.slug, labels).localeCompare(typeLabel(b.slug, labels)));
  }, [activeItems, labels]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activeItems
      .filter((item) => {
        if (statusFilter !== 'all' && item.status !== statusFilter) return false;
        if (!q) return true;
        const playerName = item.issuedToPlayerId ? (playerNameById.get(item.issuedToPlayerId) ?? '') : '';
        return (
          item.tagNumber.toLowerCase().includes(q) ||
          typeLabel(item.type, labels).toLowerCase().includes(q) ||
          item.type.toLowerCase().includes(q) ||
          item.size.toLowerCase().includes(q) ||
          playerName.toLowerCase().includes(q)
        );
      })
      .sort((a, b) =>
        typeLabel(a.type, labels).localeCompare(typeLabel(b.type, labels)) ||
        a.tagNumber.localeCompare(b.tagNumber, undefined, { numeric: true })
      );
  }, [activeItems, search, statusFilter, playerNameById, labels]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (activeItems.length === 0) {
    return (
      <Card className="border-none shadow-md">
        <CardContent className="flex flex-col items-center justify-center py-10 text-center">
          <Package className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <p className="text-muted-foreground font-medium">No inventory yet</p>
          <p className="text-sm text-muted-foreground">Your equipment manager hasn&apos;t added shed items.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stock levels: available by type & size */}
      <Card className="border-none shadow-md">
        <CardContent className="p-3 md:p-4 flex flex-wrap gap-x-8 gap-y-3">
          {stockByType.map(({ slug, available, sizes }) => (
            <div key={slug} className="text-xs min-w-[10rem]">
              <p className="mb-1.5">
                <span className="font-semibold">{typeLabel(slug, labels)}</span>{' '}
                <span className={cn(available === 0 ? 'text-destructive font-medium' : 'text-muted-foreground')}>
                  · {available} available
                </span>
              </p>
              <div className="flex flex-wrap gap-1">
                {sizes.map(([size, count]) => (
                  <span
                    key={size}
                    className={cn(
                      'rounded-md px-1.5 py-0.5 whitespace-nowrap',
                      count === 0 ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {size} × {count}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Search + status filter */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tag, type, size, or player…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 rounded-xl"
          />
        </div>
        <div className="flex gap-1.5">
          {(['all', 'available', 'issued'] as const).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={statusFilter === s ? 'default' : 'outline'}
              className="rounded-full h-9"
              onClick={() => setStatusFilter(s)}
            >
              {s === 'all' ? 'All' : s === 'available' ? 'Available' : 'Issued'}
            </Button>
          ))}
        </div>
      </div>

      {/* Item list — single responsive layout for mobile and desktop */}
      {filteredItems.length === 0 ? (
        <Card className="border-none shadow-md">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No items match your search.
          </CardContent>
        </Card>
      ) : (
        <div className="divide-y rounded-xl border bg-card max-w-2xl">
          {filteredItems.map((item) => {
            const issuedToName = item.issuedToPlayerId
              ? (playerNameById.get(item.issuedToPlayerId) ?? 'another player')
              : '';
            const canReturn = item.status === 'issued' &&
              !!item.issuedToEnrollmentId && coachEnrollmentIds.has(item.issuedToEnrollmentId);
            return (
              <div key={item.id} className="flex items-center gap-3 p-3 min-h-[64px]">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">Tag #{item.tagNumber}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {typeLabel(item.type, labels)} · {item.size}
                  </p>
                  {item.status === 'issued' && (
                    <p className="text-xs text-muted-foreground truncate">Issued to {issuedToName}</p>
                  )}
                </div>
                <ShedStatusPill status={item.status} />
                {item.status === 'available' && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={saving}
                    onClick={() => onIssue(item)}
                    className="min-h-[44px] rounded-xl shrink-0"
                  >
                    <PackagePlus className="h-4 w-4 mr-1.5" /> Issue
                  </Button>
                )}
                {canReturn && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={saving}
                    onClick={() => onReturn(item)}
                    className="min-h-[44px] rounded-xl text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive shrink-0"
                  >
                    <Undo2 className="h-4 w-4 mr-1.5" /> Return
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''} shown · Issue and Return here update the player&apos;s record automatically.
      </p>
    </div>
  );
}
