"use client";

/**
 * Season attendance totals, sorted worst first.
 *
 * Alphabetical would be the obvious ordering and the wrong one — the whole
 * point of a season view is "who has been missing", and that name is exactly
 * the one that gets lost in the middle of a 15-row alphabetical list. Same
 * reasoning as the No-reply-first ordering in AttendanceRoster.
 */
import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRosterData, sortedPlayerRows, playerDisplayName } from '@/firebase';
import { useAttendanceTotals, formatAttendanceRatio, type PlayerAttendanceTotals } from '@/hooks/use-attendance-totals';

/** Under two-thirds attendance is the threshold worth a coach's attention. */
function isLow(t: PlayerAttendanceTotals): boolean {
  return t.eligible > 0 && t.attended * 3 < t.eligible * 2;
}

export function SeasonAttendanceCard({ teamId }: { teamId: string }) {
  const { totals, recordedEventCount, isLoading: loadingTotals } = useAttendanceTotals(teamId);
  const { rows: rawRows, isLoading: loadingRoster } = useRosterData({ teamIds: [teamId], includeParents: false });

  const rows = useMemo(() => {
    return sortedPlayerRows(rawRows)
      .map(r => ({ ...r, totals: totals.get(r.enrollment.playerId) }))
      // A player who has never been marked has no rate to report.
      .filter((r): r is typeof r & { totals: PlayerAttendanceTotals } => !!r.totals && r.totals.eligible > 0)
      .sort((a, b) => {
        // Lowest attendance rate first; ties broken by who missed more events.
        const rateA = a.totals.attended / a.totals.eligible;
        const rateB = b.totals.attended / b.totals.eligible;
        if (rateA !== rateB) return rateA - rateB;
        return b.totals.absent - a.totals.absent;
      });
  }, [rawRows, totals]);

  if (loadingTotals || loadingRoster) {
    return (
      <Card className="border-none shadow-md">
        <CardContent className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-none shadow-md">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg font-headline">Season totals</CardTitle>
        <CardDescription>
          {recordedEventCount === 0
            ? 'Totals appear here once you take attendance at an event.'
            : `Across ${recordedEventCount} event${recordedEventCount === 1 ? '' : 's'} where you took attendance. Lowest first.`}
        </CardDescription>
      </CardHeader>
      {rows.length > 0 && (
        <CardContent>
          <ul className="rounded-lg border divide-y">
            {rows.map(({ enrollment, player, totals: t }) => (
              <li key={enrollment.id} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm">
                  {playerDisplayName(player)}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {t.late > 0 && `${t.late} late · `}
                  {t.absent > 0 ? `${t.absent} missed` : 'perfect'}
                </span>
                <Badge
                  variant="outline"
                  className={cn(
                    'shrink-0 tabular-nums',
                    isLow(t) ? 'bg-red-50 text-red-700 border-red-200' : 'text-muted-foreground',
                  )}
                >
                  {isLow(t) && <TrendingDown className="mr-1 h-3 w-3" />}
                  {formatAttendanceRatio(t)}
                </Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}
