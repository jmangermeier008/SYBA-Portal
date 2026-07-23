"use client";

import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BellRing, Check, Loader2, PackageOpen, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { sizesForType, typeLabel, type ShedItem, type ShedItemType, type TypeLabelOverrides } from '@/lib/equipment';

export interface IssueTarget {
  equipType: ShedItemType;
  playerFirstName: string;
  /** The size the family declared at registration, when we have one. */
  registeredSize?: string;
}

const byTagNumber = (a: ShedItem, b: ShedItem) =>
  a.tagNumber.localeCompare(b.tagNumber, undefined, { numeric: true });

/** Shed-inventory picker for one equipment slot. Shows the player's registered
 *  size, lists matching-size items first, and offers a tag/size search plus
 *  one-tap size chips so the right gear is quick to find in a big shed. */
export function IssueItemDialog({
  target,
  items,
  isLoading,
  onOpenChange,
  onSelect,
  onRequestRestock,
  restockRequested,
  labels,
}: {
  target: IssueTarget | null;
  /** Available items of target.equipType — provided by the page's inventory subscription. */
  items: ShedItem[] | null;
  isLoading: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (item: ShedItem) => void;
  onRequestRestock: () => void;
  restockRequested: boolean;
  labels?: TypeLabelOverrides;
}) {
  const [search, setSearch] = useState('');
  const [sizeFilter, setSizeFilter] = useState<string | null>(null);

  const equipType = target?.equipType;
  useEffect(() => {
    setSearch('');
    setSizeFilter(null);
  }, [equipType, target !== null]);

  const availableItems = items ?? [];

  // Size chips: the sizes actually in stock, in canonical order
  const sizeChips = useMemo(() => {
    if (!target) return [];
    const present = [...new Set(availableItems.map((i) => i.size))];
    const list = sizesForType(target.equipType);
    return present.sort((a, b) => {
      if (list) {
        const ia = list.indexOf(a);
        const ib = list.indexOf(b);
        if (ia !== -1 || ib !== -1) return (ia === -1 ? list.length : ia) - (ib === -1 ? list.length : ib);
      }
      return a.localeCompare(b, undefined, { numeric: true });
    });
  }, [availableItems, target]);

  const filterActive = search.trim() !== '' || sizeFilter !== null;

  const { matching, other, flat } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = availableItems.filter((i) => {
      if (sizeFilter && i.size !== sizeFilter) return false;
      if (!q) return true;
      return i.tagNumber.toLowerCase().includes(q) || i.size.toLowerCase().includes(q);
    });
    const wanted = target?.registeredSize?.trim().toLowerCase();
    if (filterActive || !wanted) {
      return { matching: [] as ShedItem[], other: [] as ShedItem[], flat: filtered.sort(byTagNumber) };
    }
    return {
      matching: filtered.filter(i => i.size.trim().toLowerCase() === wanted).sort(byTagNumber),
      other: filtered.filter(i => i.size.trim().toLowerCase() !== wanted).sort(byTagNumber),
      flat: [] as ShedItem[],
    };
  }, [availableItems, target?.registeredSize, search, sizeFilter, filterActive]);

  const typeName = target ? typeLabel(target.equipType, labels) : '';
  const visibleCount = filterActive || !target?.registeredSize ? flat.length : matching.length + other.length;

  const itemRow = (item: ShedItem, highlight: boolean) => (
    <button
      key={item.id}
      onClick={() => onSelect(item)}
      className={cn(
        'w-full flex items-center justify-between rounded-xl border px-4 min-h-[48px] text-sm transition-colors hover:bg-secondary/40',
        highlight && 'ring-1 ring-primary/40 bg-primary/5'
      )}
    >
      <span className="font-semibold">Tag #{item.tagNumber}</span>
      <Badge variant={highlight ? 'default' : 'secondary'} className="text-xs">
        {item.size || 'No size'}
      </Badge>
    </button>
  );

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Issue {typeName}{target?.playerFirstName ? ` to ${target.playerFirstName}` : ''}
          </DialogTitle>
          <DialogDescription>
            {target?.registeredSize
              ? <>Registered size: <span className="font-semibold text-foreground">{target.registeredSize}</span></>
              : 'Pick an available item from the shed.'}
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : availableItems.length === 0 ? (
          <div className="py-4 text-center space-y-3">
            <PackageOpen className="h-10 w-10 text-muted-foreground/40 mx-auto" />
            <p className="text-sm text-muted-foreground">
              No available {typeName.toLowerCase()} in the shed.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl"
              disabled={restockRequested}
              onClick={onRequestRestock}
            >
              {restockRequested ? (
                <><Check className="mr-1.5 h-4 w-4" /> Restock requested</>
              ) : (
                <><BellRing className="mr-1.5 h-4 w-4" /> Request restock</>
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search tag or size…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-11 rounded-xl"
              />
            </div>
            {sizeChips.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                {sizeChips.map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={sizeFilter === s ? 'default' : 'outline'}
                    className="rounded-full h-9 min-w-[44px] text-xs"
                    onClick={() => setSizeFilter((prev) => (prev === s ? null : s))}
                  >
                    {s}
                  </Button>
                ))}
              </div>
            )}
            {visibleCount === 0 ? (
              <div className="py-4 text-center space-y-2">
                <p className="text-sm text-muted-foreground">No items match your filters.</p>
                <Button variant="outline" size="sm" className="rounded-xl"
                  onClick={() => { setSearch(''); setSizeFilter(null); }}>
                  Clear filters
                </Button>
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto space-y-1.5">
                {matching.length > 0 && (
                  <>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground pt-1">Matching size</p>
                    {matching.map(item => itemRow(item, true))}
                  </>
                )}
                {other.length > 0 && (
                  <>
                    {matching.length > 0 && (
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground pt-2">Other sizes</p>
                    )}
                    {other.map(item => itemRow(item, false))}
                  </>
                )}
                {flat.map(item => itemRow(item, false))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
