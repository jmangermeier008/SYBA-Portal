"use client";

import { useMemo } from 'react';
import Link from 'next/link';
import { collection, collectionGroup, query, where } from 'firebase/firestore';
import { Lock, HeartHandshake, ChevronRight, CheckCircle2 } from 'lucide-react';
import { useUser, useFirestore, useMemoFirebase, useCollection, useSport } from '@/firebase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { computeFamilyFootballCompliance } from '@/lib/volunteer-compliance';
import type { Season, ConcessionSlot } from '@/types/scheduling';

/** A single labeled progress bar — mirrors the CommitmentBar on the volunteers page. */
function ComplianceBar({ label, worked, pending, required }: { label: string; worked: number; pending: number; required: number }) {
  const pct = required > 0 ? Math.min((worked / required) * 100, 100) : 0;
  const color = worked >= required ? 'bg-green-500' : worked > 0 ? 'bg-amber-500' : 'bg-destructive';
  return (
    <div>
      <div className="flex items-center justify-between text-xs gap-2">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold">
          {worked} / {required}
          {pending > 0 && <span className="text-amber-600 font-normal"> (+{pending} pending)</span>}
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-secondary overflow-hidden mt-1">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * Family Compliance & Volunteer Tracker — a compact, at-a-glance summary of the
 * family's football volunteer obligation, shown at the top of the parent
 * dashboard. Football only for now; renders nothing for other sports or when the
 * family has no enrollments this season.
 *
 * Reuses the same compliance math as /parent/volunteers via
 * computeFamilyFootballCompliance so the two views never disagree.
 */
export function FamilyComplianceTracker() {
  const { profile } = useUser();
  const { activeSport } = useSport();
  const db = useFirestore();

  const isFootball = activeSport === 'football';

  const activeSeasonQuery = useMemoFirebase(() => {
    if (!db || !isFootball) return null;
    return query(collection(db, 'seasons'), where('status', '==', 'active'), where('sport', '==', activeSport));
  }, [db, isFootball, activeSport]);
  const { data: activeSeasons } = useCollection<Season>(activeSeasonQuery);
  const activeSeason = useMemo(() => activeSeasons?.[0] ?? null, [activeSeasons]);

  // Sport-scoped slots (equality-only to avoid a composite index — same as the
  // volunteers page). We only need existence + this parent's signups.
  const slotsQuery = useMemoFirebase(() => {
    if (!db || !isFootball) return null;
    return query(collection(db, 'concessionSlots'), where('sport', '==', activeSport));
  }, [db, isFootball, activeSport]);
  const { data: slots, isLoading: loadingSlots } = useCollection<ConcessionSlot>(slotsQuery);

  const enrollmentsQuery = useMemoFirebase(() => {
    if (!db || !profile || !activeSeason) return null;
    return query(
      collectionGroup(db, 'enrollments'),
      where('parentUserId', '==', profile.id),
      where('seasonId', '==', activeSeason.id),
    );
  }, [db, profile?.id, activeSeason?.id]);
  const { data: enrollments, isLoading: loadingEnrollments } = useCollection<{ seasonId: string; parentUserId: string }>(enrollmentsQuery);

  const enrolledCount = enrollments?.length ?? 0;
  const compliance = useMemo(
    () => computeFamilyFootballCompliance(slots, enrolledCount, profile?.id),
    [slots, enrolledCount, profile?.id],
  );

  // Football only.
  if (!isFootball) return null;

  const loading = loadingSlots || loadingEnrollments || !activeSeason;
  if (loading) {
    return (
      <Card className="border shadow-sm mb-4">
        <CardHeader className="pb-3"><Skeleton className="h-5 w-64" /></CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </CardContent>
      </Card>
    );
  }

  // No enrollments this season → nothing to track.
  if (enrolledCount === 0) return null;

  const concessionTarget = compliance.concessions.required;
  const taggingTarget = compliance.tagging.required;

  // ── Locked state — no shifts published yet ──────────────────────────────────
  if (compliance.locked) {
    return (
      <Card className="border shadow-sm mb-4 border-l-4 border-l-primary/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-headline flex items-center gap-2">
            <Lock className="h-4 w-4 text-primary" /> Family Compliance &amp; Volunteer Tracker
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm font-semibold">🔒 Volunteer Shifts Opening Soon</p>
          <p className="text-sm text-muted-foreground mt-1">
            Your family will need to claim{' '}
            <span className="font-semibold text-foreground">{concessionTarget} Concession {concessionTarget === 1 ? 'Shift' : 'Shifts'}</span>{' '}
            and{' '}
            <span className="font-semibold text-foreground">{taggingTarget} Volunteer (Tagging) {taggingTarget === 1 ? 'Shift' : 'Shifts'}</span>{' '}
            once the league schedule goes live.
          </p>
        </CardContent>
      </Card>
    );
  }

  // ── Live state — gamified progress ──────────────────────────────────────────
  return (
    <Card className={`border shadow-sm mb-4 border-l-4 ${compliance.isComplete ? 'border-l-green-500' : 'border-l-primary'}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-headline flex items-center gap-2">
          <HeartHandshake className="h-4 w-4 text-primary" /> Family Compliance &amp; Volunteer Tracker
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {compliance.isComplete ? (
          <p className="text-sm font-semibold text-green-600 flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4" /> All volunteer requirements met — thank you!
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Shifts claimed: <span className="font-semibold text-foreground">{compliance.claimedTotal} / {compliance.targetTotal}</span> across concessions and tagging.
          </p>
        )}

        <div className="space-y-2.5">
          <ComplianceBar label="Concessions" worked={compliance.concessions.worked} pending={compliance.concessions.pending} required={concessionTarget} />
          <ComplianceBar label="Tagging" worked={compliance.tagging.worked} pending={compliance.tagging.pending} required={taggingTarget} />
        </div>

        {!compliance.isComplete && (
          <Button asChild size="sm" className="rounded-full mt-1">
            <Link href="/parent/volunteers">
              Claim a shift <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
