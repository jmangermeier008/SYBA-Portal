"use client";

import { useMemo } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { useFirestore, useCollection, useMemoFirebase, useUser, useSport } from '@/firebase';
import { collection, collectionGroup, query, orderBy, limit } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Loader2,
  Lock,
  AlertTriangle,
  CheckCircle2,
  Clock,
  CreditCard,
  TrendingUp,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PaymentEventKind =
  | 'checkout.completed'
  | 'confirm.fallback'
  | 'refund.unmatched'
  | 'refund.partial'
  | 'refund.full';

type PaymentEventStatus = 'ok' | 'error' | 'needs-attention';

interface PaymentEvent {
  id: string;
  kind: PaymentEventKind | string;
  status: PaymentEventStatus | string;
  sessionId?: string;
  chargeId?: string;
  userId?: string;
  enrollmentIds?: string[];
  newlyPaidCount?: number;
  failedEnrollmentIds?: string[];
  amountTotal?: number;
  createdAt?: string;
}

interface PendingEnrollment {
  id: string;
  playerId?: string;
  parentUserId?: string;
  paymentStatus?: string;
  payment_status?: string;
  registrationFeeAmount?: number;
  enrollmentDate?: string;
  registered_at?: string;
  updatedAt?: string;
  sport?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCents(cents?: number) {
  if (typeof cents !== 'number') return '—';
  return `$${(cents / 100).toFixed(2)}`;
}

function relativeTime(iso?: string) {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function enrollmentTimestamp(e: PendingEnrollment) {
  return e.enrollmentDate ?? e.registered_at ?? e.updatedAt;
}

function ageInMs(iso?: string) {
  if (!iso) return 0;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Date.now() - then;
}

const STALE_PENDING_MS = 60 * 60 * 1000; // 1 hour

function statusClasses(status: string) {
  if (status === 'error') return 'border-red-200 bg-red-50 dark:bg-red-950/20';
  if (status === 'needs-attention') return 'border-amber-200 bg-amber-50 dark:bg-amber-950/20';
  return 'border-green-200 bg-green-50 dark:bg-green-950/20';
}

function statusDot(status: string) {
  if (status === 'error') return 'bg-red-500';
  if (status === 'needs-attention') return 'bg-amber-500';
  return 'bg-green-500';
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PaymentsHealthPage() {
  const db = useFirestore();
  const { isSiteAdmin, loading: loadingUser } = useUser();
  const { isAdmin } = useSport();

  const canView = isAdmin || isSiteAdmin;

  // ── Queries — ALL before any early returns ─────────────────────────────────

  const eventsQuery = useMemoFirebase(() => {
    if (!db || !canView) return null;
    return query(collection(db, 'paymentEvents'), orderBy('createdAt', 'desc'), limit(100));
  }, [db, canView]);

  const enrollmentsQuery = useMemoFirebase(() => {
    if (!db || !canView) return null;
    return collectionGroup(db, 'enrollments');
  }, [db, canView]);

  const { data: events, isLoading: loadingEvents } = useCollection<PaymentEvent>(eventsQuery);
  const { data: allEnrollments, isLoading: loadingEnrollments } = useCollection<PendingEnrollment>(enrollmentsQuery);

  // ── Derived data ───────────────────────────────────────────────────────────

  const needsAttention = useMemo(
    () => (events ?? []).filter(e => e.status === 'error' || e.status === 'needs-attention'),
    [events]
  );

  const pending = useMemo(
    () =>
      (allEnrollments ?? []).filter(e => {
        const status = e.payment_status ?? e.paymentStatus;
        return status === 'pending_payment';
      }),
    [allEnrollments]
  );

  const stuckPendingCount = useMemo(
    () => pending.filter(e => ageInMs(enrollmentTimestamp(e)) > STALE_PENDING_MS).length,
    [pending]
  );

  // ── Guards AFTER all hooks ───────────────────────────────────────────────────

  if (loadingUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 md:ml-64 p-3 pt-16 flex items-center justify-center">
          <Card className="max-w-md text-center border-none shadow-xl">
            <CardHeader>
              <Lock className="h-12 w-12 text-destructive mx-auto mb-4" />
              <CardTitle>Access Denied</CardTitle>
              <CardDescription>You do not have permission to view this page.</CardDescription>
            </CardHeader>
          </Card>
        </main>
      </div>
    );
  }

  const loading = loadingEvents || loadingEnrollments;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6 min-w-0 overflow-x-hidden">
        <header className="mb-4 md:mb-6">
          <h1 className="text-xl md:text-2xl font-bold font-headline flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-primary" />
            Payments Health
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Watch for payments that succeeded in Stripe but didn&apos;t finalize, and registrations
            still awaiting payment.
          </p>
        </header>

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4 mb-6">
          <Card className={needsAttention.length > 0 ? 'border-red-200' : ''}>
            <CardContent className="p-4 flex items-center gap-4">
              <div className={`rounded-full p-3 ${needsAttention.length > 0 ? 'bg-red-100 dark:bg-red-950/40' : 'bg-muted'}`}>
                <AlertTriangle className={`h-6 w-6 ${needsAttention.length > 0 ? 'text-red-500' : 'text-muted-foreground'}`} />
              </div>
              <div>
                <p className="text-2xl font-bold">{needsAttention.length}</p>
                <p className="text-sm text-muted-foreground">Needs attention</p>
              </div>
            </CardContent>
          </Card>
          <Card className={stuckPendingCount > 0 ? 'border-amber-200' : ''}>
            <CardContent className="p-4 flex items-center gap-4">
              <div className={`rounded-full p-3 ${stuckPendingCount > 0 ? 'bg-amber-100 dark:bg-amber-950/40' : 'bg-muted'}`}>
                <Clock className={`h-6 w-6 ${stuckPendingCount > 0 ? 'text-amber-500' : 'text-muted-foreground'}`} />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {pending.length}
                  {stuckPendingCount > 0 && (
                    <span className="text-sm font-medium text-amber-600 ml-2">{stuckPendingCount} stale</span>
                  )}
                </p>
                <p className="text-sm text-muted-foreground">Pending registrations</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {loading && (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}

        {!loading && (
          <div className="space-y-6">
            {/* Needs attention */}
            {needsAttention.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  Needs attention
                </h2>
                <div className="space-y-2">
                  {needsAttention.map(e => (
                    <Card key={e.id} className={`border ${statusClasses(e.status)}`}>
                      <CardContent className="p-4 space-y-1">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <span className="font-medium flex items-center gap-2">
                            <AlertTriangle className={`h-4 w-4 ${e.status === 'error' ? 'text-red-500' : 'text-amber-500'}`} />
                            {e.kind}
                          </span>
                          <span className="text-sm text-muted-foreground">{relativeTime(e.createdAt)}</span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {formatCents(e.amountTotal)} · status: {e.status}
                          {typeof e.newlyPaidCount === 'number' && ` · newly paid: ${e.newlyPaidCount}`}
                        </p>
                        {e.sessionId && (
                          <p className="text-xs font-mono text-muted-foreground break-all">session: {e.sessionId}</p>
                        )}
                        {e.chargeId && (
                          <p className="text-xs font-mono text-muted-foreground break-all">charge: {e.chargeId}</p>
                        )}
                        {e.failedEnrollmentIds && e.failedEnrollmentIds.length > 0 && (
                          <p className="text-xs font-mono text-red-600 break-all">
                            failed enrollments: {e.failedEnrollmentIds.join(', ')}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            )}

            {/* Pending registrations */}
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Pending registrations ({pending.length})
              </h2>
              {pending.length === 0 ? (
                <p className="text-sm text-muted-foreground">No registrations awaiting payment.</p>
              ) : (
                <div className="space-y-2">
                  {pending
                    .slice()
                    .sort((a, b) => ageInMs(enrollmentTimestamp(b)) - ageInMs(enrollmentTimestamp(a)))
                    .map(e => {
                      const stale = ageInMs(enrollmentTimestamp(e)) > STALE_PENDING_MS;
                      return (
                        <Card key={e.id} className={stale ? 'border-amber-200 bg-amber-50 dark:bg-amber-950/20' : ''}>
                          <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
                            <div className="space-y-0.5 min-w-0">
                              <p className="font-medium flex items-center gap-2">
                                <CreditCard className="h-4 w-4 text-muted-foreground" />
                                {formatCents(e.registrationFeeAmount)}
                                {stale && (
                                  <span className="text-xs font-medium text-amber-600">stale</span>
                                )}
                              </p>
                              <p className="text-xs font-mono text-muted-foreground break-all">player: {e.playerId ?? '—'}</p>
                              <p className="text-xs font-mono text-muted-foreground break-all">parent: {e.parentUserId ?? '—'}</p>
                            </div>
                            <span className="text-sm text-muted-foreground shrink-0">
                              {relativeTime(enrollmentTimestamp(e))}
                            </span>
                          </CardContent>
                        </Card>
                      );
                    })}
                </div>
              )}
            </section>

            {/* Recent activity */}
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Recent payment activity
              </h2>
              {(events ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No payment events recorded yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {(events ?? []).map(e => (
                    <div
                      key={e.id}
                      className={`flex items-center justify-between gap-3 flex-wrap rounded-lg border p-3 ${statusClasses(e.status)}`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${statusDot(e.status)}`} />
                        <div className="min-w-0">
                          <p className="font-medium text-sm flex items-center gap-2">
                            {e.status === 'ok' && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
                            {e.kind}
                          </p>
                          {e.sessionId && (
                            <p className="text-xs font-mono text-muted-foreground break-all">{e.sessionId}</p>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-medium">{formatCents(e.amountTotal)}</p>
                        <p className="text-xs text-muted-foreground">{relativeTime(e.createdAt)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
