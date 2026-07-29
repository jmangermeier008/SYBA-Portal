"use client";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, PackagePlus, Undo2 } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import {
  EQUIP_FIELD_MAP,
  JERSEY_SLOTS,
  slotFieldsForType,
  typeLabel,
  type FootballEquipment,
  type ShedItemType,
  type TypeLabelOverrides,
} from '@/lib/equipment';

const EQUIP_TYPES = Object.keys(EQUIP_FIELD_MAP) as ShedItemType[];

/** Full-height detail view for one player: a row per equipment slot with big
 *  Issue/Return actions, so a coach can outfit a player in one pass. Return is
 *  confirm-gated — gear goes back to shed inventory on a mis-tap otherwise. */
export function PlayerEquipmentSheet({
  open,
  onOpenChange,
  playerName,
  teamName,
  footballEquipment,
  saving,
  onIssue,
  onReturn,
  labels,
  availableByType,
  registeredJerseySize,
  slots,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playerName: string;
  teamName?: string;
  footballEquipment: FootballEquipment | undefined;
  saving: boolean;
  onIssue: (equipType: string) => void;
  onReturn: (equipType: string) => void;
  labels?: TypeLabelOverrides;
  /** Live available count per type slug from the page's inventory subscription. */
  availableByType?: Record<string, number>;
  /** The enrollment's top-level jerseySize/shirtSize — the only size captured at registration. */
  registeredJerseySize?: string;
  /** Slot slugs to render — the 7 standard plus any admin-created custom types. */
  slots?: string[];
}) {
  const isMobile = useIsMobile();
  const fe = (footballEquipment ?? {}) as Record<string, unknown>;
  const slotList = slots ?? EQUIP_TYPES;
  const issuedCount = Object.entries(fe).filter(([k, v]) => k.endsWith('Status') && v === 'issued').length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className={isMobile ? 'h-[90dvh] rounded-t-2xl overflow-y-auto' : 'sm:max-w-md overflow-y-auto'}
      >
        <SheetHeader className="text-left">
          <SheetTitle className="flex items-center justify-between gap-2">
            <span>{playerName}</span>
            {saving && <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />}
          </SheetTitle>
          <SheetDescription>
            {teamName ? `${teamName} · ` : ''}{issuedCount} of {slotList.length} issued
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 divide-y rounded-xl border">
          {slotList.map(equipType => {
            const { statusField, sizeField, tagField } = slotFieldsForType(equipType);
            const status = fe[statusField] as string | undefined;
            const tag = fe[tagField] as string | undefined;
            const feSize = sizeField ? (fe[sizeField] as string | undefined) : undefined;
            const size = feSize || (JERSEY_SLOTS.has(equipType as ShedItemType) ? registeredJerseySize : undefined);
            const issued = status === 'issued';
            const returned = status === 'returned';
            const availCount = availableByType?.[equipType];

            return (
              <div key={equipType} className="flex items-center gap-3 p-3 min-h-[64px]">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{typeLabel(equipType, labels)}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {issued
                      ? `Tag #${tag ?? '—'}${feSize ? ` · Size ${feSize}` : ''}`
                      : returned
                        ? 'Returned'
                        : size
                          ? `Registered size: ${size}`
                          : 'Not issued'}
                  </p>
                  {!issued && availCount !== undefined && (
                    <p className={cn('text-xs', availCount === 0 ? 'text-destructive/80' : 'text-muted-foreground')}>
                      {availCount === 0 ? 'None available' : `${availCount} available`}
                    </p>
                  )}
                </div>
                <Badge
                  variant="outline"
                  className={issued
                    ? 'bg-blue-50 text-blue-700 border-blue-200 shrink-0'
                    : 'text-muted-foreground shrink-0'}
                >
                  {issued ? 'Issued' : returned ? 'Returned' : 'Not issued'}
                </Badge>
                {issued ? (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={saving}
                        className="min-h-[44px] rounded-xl text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive shrink-0"
                      >
                        <Undo2 className="h-4 w-4 mr-1.5" /> Return
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Return {typeLabel(equipType, labels)}{tag ? ` #${tag}` : ''}?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          It goes back to shed inventory and {playerName} no longer has it checked out.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep Issued</AlertDialogCancel>
                        <AlertDialogAction onClick={() => onReturn(equipType)}>
                          Return Item
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={saving}
                    onClick={() => onIssue(equipType)}
                    className="min-h-[44px] rounded-xl shrink-0"
                  >
                    <PackagePlus className="h-4 w-4 mr-1.5" /> Issue
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
