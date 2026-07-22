"use client";

import { useMemo } from 'react';
import { collection, query, where } from 'firebase/firestore';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BellRing, Check, Loader2, PackageOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { typeLabel, type ShedItem, type ShedItemType, type TypeLabelOverrides } from '@/lib/equipment';

export interface IssueTarget {
  equipType: ShedItemType;
  playerFirstName: string;
  /** The size the family declared at registration, when we have one. */
  registeredSize?: string;
}

const byTagNumber = (a: ShedItem, b: ShedItem) =>
  a.tagNumber.localeCompare(b.tagNumber, undefined, { numeric: true });

/** Shed-inventory picker for one equipment slot. Shows the player's registered
 *  size and lists matching-size items first so the right gear is one tap away. */
export function IssueItemDialog({
  target,
  onOpenChange,
  onSelect,
  onRequestRestock,
  restockRequested,
  labels,
}: {
  target: IssueTarget | null;
  onOpenChange: (open: boolean) => void;
  onSelect: (item: ShedItem) => void;
  onRequestRestock: () => void;
  restockRequested: boolean;
  labels?: TypeLabelOverrides;
}) {
  const db = useFirestore();

  const inventoryQuery = useMemoFirebase(() => {
    if (!db || !target) return null;
    return query(
      collection(db, 'equipmentInventory'),
      where('type', '==', target.equipType),
      where('status', '==', 'available')
    );
  }, [db, target?.equipType]);
  const { data: availableItems, isLoading } = useCollection<ShedItem>(inventoryQuery);

  const { matching, other } = useMemo(() => {
    const items = (availableItems ?? []).slice();
    const wanted = target?.registeredSize?.trim().toLowerCase();
    if (!wanted) return { matching: [] as ShedItem[], other: items.sort(byTagNumber) };
    return {
      matching: items.filter(i => i.size.trim().toLowerCase() === wanted).sort(byTagNumber),
      other: items.filter(i => i.size.trim().toLowerCase() !== wanted).sort(byTagNumber),
    };
  }, [availableItems, target?.registeredSize]);

  const typeName = target ? typeLabel(target.equipType, labels) : '';

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
      <DialogContent className="sm:max-w-sm">
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
        ) : (availableItems ?? []).length === 0 ? (
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
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
