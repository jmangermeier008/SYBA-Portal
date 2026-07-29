"use client";

import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Sidebar } from '@/components/navigation/sidebar';
import { useFirestore, useCollection, useMemoFirebase, useUser, useSport } from '@/firebase';
import { collectionGroup, collection, query, where, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, deleteField, writeBatch, increment, Timestamp } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DollarSign,
  BadgeCheck,
  Clock,
  ListOrdered,
  Users,
  Download,
  Loader2,
  Lock,
  TrendingUp,
  UserCheck,
  UserPlus,
  ShieldCheck,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { MetricsCards } from '@/components/admin/registration/metrics-cards';
import { PlayerTable, type PlayerWithDocs, type AuditFormData, type EnrollmentRecord, type DepositStatus } from '@/components/admin/registration/player-table';
import { CoachComplianceTable } from '@/components/admin/registration/coach-compliance-table';
import { ManualRegistrationDialog } from '@/components/admin/registration/manual-registration-dialog';
import { combinedRejectionReason, rollupVerificationStatus, type Division } from '@/types/scheduling';
import { countIssuedEquipment } from '@/lib/equipment';
import { pushToUsersBestEffort } from '@/lib/coach-notifications';

interface Enrollment {
  id: string;
  playerId: string;
  seasonId: string;
  divisionId: string;
  parentUserId: string;
  paymentStatus?: string;
  payment_status?: string;
  fee_waived?: boolean;
  registrationFeeAmount?: number;
  shirtSize?: string;
  jerseySize?: string;
  uniformNumberPreference?: string;
  registered_at?: string;
  enrollmentDate?: string;
  sport?: string;
  parentWeightEstimate?: number;
  emergencyContacts?: { name: string; phone: string; relationship: string }[];
  volunteerDepositStatus?: 'held' | 'returned';
  volunteerDepositReceivedAt?: string;
  volunteerDepositReceivedByName?: string;
  volunteerDepositReturnedAt?: string;
  volunteerDepositReturnedByName?: string;
}

interface CoachProfile {
  id: string;
  displayName: string;
  email: string;
}

// The two PA Act 153 clearance docs every coach/volunteer must hold — only
// these gate coach portal access via complianceStatus. Labels mirror
// src/app/coach/compliance/page.tsx so notifications read the same.
const REQUIRED_CLEARANCE_DOCS = [
  { id: 'ChildAbuse', label: 'PA Child Abuse History Clearance' },
  { id: 'CriminalRecord', label: 'PA State Police Criminal Record Check' },
];

// All reviewable compliance docs, including tracking-only ones that never
// block portal access.
const ALL_CLEARANCE_DOCS = [
  ...REQUIRED_CLEARANCE_DOCS,
  { id: 'USAFootball', label: 'USA Football Coach Certification' },
];

function getEnrollmentStatus(e: Enrollment) {
  if (e.fee_waived) return 'fee_waived';
  return e.payment_status ?? e.paymentStatus ?? 'pending';
}

function formatCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function RegistrationDashboardPage() {
  const db = useFirestore();
  const { user, profile, isSiteAdmin, loading: loadingUser } = useUser();
  const { activeSport, isAdmin, isBoardMember } = useSport();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const auditPlayerId = searchParams.get('auditPlayer');

  const [selectedSeason, setSelectedSeason] = useState<string>('');
  const [globalProcessing, setGlobalProcessing] = useState(false);
  const [manualRegOpen, setManualRegOpen] = useState(false);

  // Fee waiver dialog state — opened from the PlayerTable waive action
  const [feeWaiverDialog, setFeeWaiverDialog] = useState<{
    open: boolean;
    player: PlayerWithDocs | null;
    enrollment: EnrollmentRecord | null;
    reason: string;
    loading: boolean;
  }>({ open: false, player: null, enrollment: null, reason: '', loading: false });

  // Waitlist promotion dialog — opened from the PlayerTable promote action
  const [promoteDialog, setPromoteDialog] = useState<{
    open: boolean;
    player: PlayerWithDocs | null;
    enrollment: EnrollmentRecord | null;
    loading: boolean;
  }>({ open: false, player: null, enrollment: null, loading: false });

  // ── Queries — ALL before any early returns ─────────────────────────────────

  const seasonsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember) || !activeSport) return null;
    return query(collection(db, 'seasons'), where('sport', '==', activeSport));
  }, [db, isAdmin, isBoardMember, activeSport]);

  // Load seasons + derive this sport's season IDs up front so the enrollments
  // query can filter server-side instead of downloading every enrollment.
  const { data: seasons } = useCollection<any>(seasonsQuery);
  const sportSeasonIds = useMemo(
    () => new Set((seasons ?? []).map((s: any) => s.id as string)),
    [seasons]
  );

  const enrollmentsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember) || sportSeasonIds.size === 0) return null;
    const ids = [...sportSeasonIds];
    // Firestore 'in' supports at most 30 values; fall back to the unfiltered
    // collection-group query in the (unlikely) case there are more seasons.
    if (ids.length > 30) return collectionGroup(db, 'enrollments');
    return query(collectionGroup(db, 'enrollments'), where('seasonId', 'in', ids));
  }, [db, isAdmin, isBoardMember, sportSeasonIds]);

  const playersQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return collectionGroup(db, 'players');
  }, [db, isAdmin, isBoardMember]);

  // Coaches are surfaced from userProfiles. Roles now live in the per-sport
  // `sportRoles` map (legacy `roles`/`role` fields are no longer written), so we
  // fetch all profiles and filter for coach-ness in memory below — Firestore
  // can't OR across the new sportRoles map and the legacy fields in one query.
  const coachQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return collection(db, 'userProfiles');
  }, [db, isAdmin, isBoardMember]);

  const clearancesQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return collectionGroup(db, 'clearances');
  }, [db, isAdmin, isBoardMember]);

  const divisionsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return collectionGroup(db, 'divisions');
  }, [db, isAdmin, isBoardMember]);

  const { data: allEnrollments, isLoading: loadingEnrollments } = useCollection<Enrollment>(enrollmentsQuery);
  const { data: allPlayers, isLoading: loadingPlayers } = useCollection<PlayerWithDocs>(playersQuery);
  const { data: allProfiles, isLoading: loadingCoaches } = useCollection<CoachProfile>(coachQuery);

  // Keep only profiles that hold a staff role (Coach / Board Member / Admin) for
  // the active sport, plus Site Admins and any legacy-role holders not yet migrated.
  const coaches = useMemo(() => {
    if (!allProfiles) return [] as CoachProfile[];
    const STAFF_ROLES = ['Coach', 'Board Member', 'Admin'];
    return allProfiles.filter(p => {
      const prof = p as any;
      if (prof.isSiteAdmin === true) return true;
      const sportRoles: string[] = (activeSport && prof.sportRoles?.[activeSport]) || [];
      if (sportRoles.some((r: string) => STAFF_ROLES.includes(r))) return true;
      // Legacy fallback for profiles that predate the sportRoles migration.
      const legacyRoles: string[] = prof.roles ?? (prof.role ? [prof.role] : []);
      return legacyRoles.some((r: string) => STAFF_ROLES.includes(r));
    });
  }, [allProfiles, activeSport]);
  const { data: allClearances } = useCollection<any>(clearancesQuery);
  const { data: allDivisions } = useCollection<Division>(divisionsQuery);

  // ── Derived data ───────────────────────────────────────────────────────────

  // teamsQuery depends on sportSeasonIds so it must come after that memo
  const teamsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember) || sportSeasonIds.size === 0) return null;
    return query(collection(db, 'teams'), where('seasonId', 'in', [...sportSeasonIds]));
  }, [db, isAdmin, isBoardMember, sportSeasonIds]);

  const { data: sportTeams } = useCollection<any>(teamsQuery);

  const enrollments = useMemo(() => {
    if (!allEnrollments) return [];
    const sportFiltered = allEnrollments.filter(e => sportSeasonIds.has(e.seasonId));
    if (!selectedSeason || selectedSeason === 'all-seasons') return sportFiltered;
    return sportFiltered.filter(e => e.seasonId === selectedSeason);
  }, [allEnrollments, selectedSeason, sportSeasonIds]);

  const stats = useMemo(() => {
    const paid = enrollments.filter(e => getEnrollmentStatus(e) === 'paid');
    const waived = enrollments.filter(e => getEnrollmentStatus(e) === 'fee_waived');
    const pending = enrollments.filter(e => getEnrollmentStatus(e) === 'pending_payment');
    const waitlisted = enrollments.filter(e => getEnrollmentStatus(e) === 'waitlisted');
    const totalRevenue = paid.reduce((sum, e) => sum + (e.registrationFeeAmount ?? 0), 0);
    const waivedValue = waived.reduce((sum, e) => sum + (e.registrationFeeAmount ?? 0), 0);
    return { paid, waived, pending, waitlisted, totalRevenue, waivedValue, total: enrollments.length };
  }, [enrollments]);

  const divisionStats = useMemo(() => {
    const map = new Map<string, { divisionId: string; registered: number; revenue: number; pending: number }>();
    enrollments.forEach(e => {
      const existing = map.get(e.divisionId) ?? { divisionId: e.divisionId, registered: 0, revenue: 0, pending: 0 };
      const status = getEnrollmentStatus(e);
      existing.registered += 1;
      if (status === 'paid') existing.revenue += e.registrationFeeAmount ?? 0;
      if (status === 'pending_payment') existing.pending += 1;
      map.set(e.divisionId, existing);
    });
    return Array.from(map.values()).sort((a, b) => b.registered - a.registered);
  }, [enrollments]);

  const playerSportMap = useMemo(() => {
    const map = new Map<string, string>();
    allEnrollments?.forEach(e => { if (e.playerId && e.sport) map.set(e.playerId, e.sport); });
    return map;
  }, [allEnrollments]);

  // Filter divisions to only those belonging to the current sport's seasons.
  // Divisions are stored as seasons/{seasonId}/divisions/{id}, so we extract
  // the seasonId from _refPath and check it against sportSeasonIds.
  const sportFilteredDivisions = useMemo(() => {
    if (!allDivisions) return [];
    return allDivisions.filter(d => {
      const refPath = (d as any)._refPath as string | undefined;
      if (!refPath) return false;
      const seasonId = refPath.split('/')[1];
      return sportSeasonIds.has(seasonId);
    });
  }, [allDivisions, sportSeasonIds]);

  const sportTeamIds = useMemo(() =>
    new Set((sportTeams ?? []).map((t: any) => t.id as string)),
    [sportTeams]
  );

  const sportDivisionIds = useMemo(() =>
    new Set(sportFilteredDivisions.map(d => d.id)),
    [sportFilteredDivisions]
  );

  // Auto-select the active season when seasons load (falls back to the first
  // season). Seasons aren't ordered, so picking seasons[0] outright could land
  // on an archived season and show $0 revenue for the current one.
  useEffect(() => {
    if (seasons && seasons.length > 0 && !selectedSeason) {
      const active = seasons.find((s: any) => s.status === 'active');
      setSelectedSeason(active?.id ?? seasons[0].id);
    }
  }, [seasons, selectedSeason]);

  const sportEnrolledPlayerIds = useMemo(() => {
    const ids = new Set<string>();
    (allEnrollments ?? []).forEach(e => {
      if (sportSeasonIds.has(e.seasonId) && e.playerId) ids.add(e.playerId);
    });
    return ids;
  }, [allEnrollments, sportSeasonIds]);

  const sportFilteredPlayers = useMemo(() =>
    (allPlayers ?? []).filter(p => sportEnrolledPlayerIds.has(p.id)),
    [allPlayers, sportEnrolledPlayerIds]
  );

  const sportFilteredCoaches = useMemo(() => {
    if (!coaches) return [];
    return coaches.filter(c => {
      const profile = c as any;
      const coachTeamIds: string[] = profile.teamIds ?? [];
      const coachDivIds: string[] = profile.divisionIds ?? [];
      if (coachTeamIds.length === 0 && coachDivIds.length === 0) return true;
      return coachTeamIds.some((id: string) => sportTeamIds.has(id)) ||
             coachDivIds.some((id: string) => sportDivisionIds.has(id));
    });
  }, [coaches, sportTeamIds, sportDivisionIds]);

  // Count from sportFilteredPlayers — the same population the table renders.
  // Counting allPlayers made the badge include players with no enrollment in
  // this sport's seasons (e.g. abandoned registrations), which the admin can
  // see in the count but never find in the list.
  const pendingVerifications = useMemo(() => {
    return sportFilteredPlayers.filter(p =>
      (p.birthCertificateUrl && !p.ageVerified) ||
      (p.physicalFormUrl && !p.compliance?.physicalVerified)
    ).length;
  }, [sportFilteredPlayers]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  // A rejected document is only useful if the family hears about it. Mirrors
  // notifyClearanceDecision below — in-app notification plus a best-effort push
  // to any opted-in device. Co-parents get it too; either can fix the upload.
  const notifyDocumentRejection = async (
    player: PlayerWithDocs,
    compliance: Parameters<typeof combinedRejectionReason>[0]
  ) => {
    if (!db) return;
    const primaryUid = player.parentUserId ?? (player as any)._refPath?.split('/')[1];
    const recipients = [primaryUid, player.secondaryParentId].filter(
      (uid): uid is string => !!uid
    );
    if (recipients.length === 0) return;

    const title = 'Document Needs Attention';
    const body =
      `${player.firstName}'s registration needs a corrected document. ` +
      `${combinedRejectionReason(compliance)}. Re-upload it from your dashboard.`;

    await Promise.all(recipients.map(userId =>
      setDoc(doc(db, 'notifications', crypto.randomUUID()), {
        userId,
        type: 'documentRejected',
        title,
        body: body.slice(0, 120),
        relatedDocId: player.id,
        relatedDocType: 'player',
        read: false,
        createdAt: Timestamp.now(),
        sport: activeSport,
      })
    ));
    pushToUsersBestEffort(recipients, { title, body, url: '/parent/dashboard' });
  };

  const handleAuditSubmit = async (player: PlayerWithDocs, formData: AuditFormData): Promise<boolean> => {
    if (!db || !user) return false;
    const refPath = (player as any)._refPath ?? `userProfiles/${player.parentUserId}/players/${player.id}`;
    const playerRef = doc(db, refPath);
    const now = new Date().toISOString();
    const updateData: Record<string, unknown> = {
      'compliance.verifiedBy': user.uid,
      'compliance.verifiedAt': now,
      updatedAt: now,
    };
    if (formData.auditDob && formData.auditDob !== player.dateOfBirth) updateData.dateOfBirth = formData.auditDob;
    if (formData.auditDivisionId) updateData.divisionId = formData.auditDivisionId;
    if (formData.approveAge) {
      updateData.ageVerified = true;
      updateData['compliance.birthCertificateVerified'] = true;
      updateData.verifiedBy = user.uid;
      updateData.verifiedByName = profile?.displayName || 'Admin';
      updateData.verifiedAt = now;
    }
    if (formData.approvePhysical) {
      updateData['compliance.physicalVerified'] = true;
    }

    // ── Rejections ──────────────────────────────────────────────────────────
    // Rejecting also clears the approval, so a document is never simultaneously
    // "verified" and "rejected". Unchecking a standing rejection clears it.
    const wasBirthCertRejected = player.compliance?.birthCertificateRejected === true;
    const wasPhysicalRejected = player.compliance?.physicalRejected === true;

    updateData['compliance.birthCertificateRejected'] = formData.rejectBirthCert;
    updateData['compliance.birthCertificateRejectionReason'] = formData.rejectBirthCert ? formData.rejectBirthCertReason : '';
    if (formData.rejectBirthCert) {
      updateData.ageVerified = false;
      updateData['compliance.birthCertificateVerified'] = false;
    }

    updateData['compliance.physicalRejected'] = formData.rejectPhysical;
    updateData['compliance.physicalRejectionReason'] = formData.rejectPhysical ? formData.rejectPhysicalReason : '';
    if (formData.rejectPhysical) {
      updateData['compliance.physicalVerified'] = false;
    }

    if (formData.rejectBirthCert || formData.rejectPhysical) {
      updateData['compliance.rejectedBy'] = user.uid;
      updateData['compliance.rejectedByName'] = profile?.displayName || 'Admin';
      updateData['compliance.rejectedAt'] = now;
    }
    // League waiver is a standalone paper-tracking flag — it never feeds into
    // verificationStatus, which only reflects document verification.
    if (typeof formData.leagueFormSigned === 'boolean') {
      updateData['compliance.leagueFormSigned'] = formData.leagueFormSigned;
    }
    if (typeof formData.parentalAgreementSigned === 'boolean') {
      updateData['compliance.parentalAgreementSigned'] = formData.parentalAgreementSigned;
    }
    const nextCompliance = {
      birthCertificateVerified: !formData.rejectBirthCert && (formData.approveAge || player.ageVerified === true),
      physicalVerified: !formData.rejectPhysical && (formData.approvePhysical || player.compliance?.physicalVerified === true),
      birthCertificateRejected: formData.rejectBirthCert,
      birthCertificateRejectionReason: formData.rejectBirthCertReason,
      physicalRejected: formData.rejectPhysical,
      physicalRejectionReason: formData.rejectPhysicalReason,
    };
    updateData['compliance.verificationStatus'] = rollupVerificationStatus(nextCompliance);
    updateData['compliance.rejectionReason'] = combinedRejectionReason(nextCompliance);

    try {
      await updateDoc(playerRef, updateData as any);
      toast({ title: 'Audit Saved', description: 'Player compliance record updated.' });
      // A newly rejected document is the parent's cue to act — tell them.
      // The audit itself is already saved, so a notification failure must not
      // read as a failed save.
      const newlyRejected =
        (formData.rejectBirthCert && !wasBirthCertRejected) ||
        (formData.rejectPhysical && !wasPhysicalRejected);
      if (newlyRejected) {
        try {
          await notifyDocumentRejection(player, nextCompliance);
        } catch {
          toast({
            variant: 'destructive',
            title: 'Saved, but the parent was not notified',
            description: 'Let them know directly that a document needs to be re-uploaded.',
          });
        }
      }
      return true;
    } catch (error: any) {
      if (error?.code === 'permission-denied') {
        errorEmitter.emit('permission-error', new FirestorePermissionError({ path: playerRef.path, operation: 'update', requestResourceData: updateData }));
      } else {
        toast({ variant: 'destructive', title: 'Save Failed', description: error.message });
      }
      return false;
    }
  };

  // Bulk variant of the audit path — writes the exact same field set per player
  // (rules only allow this key set for Board Members), skipping players without
  // the relevant uploaded document or already verified.
  const handleBulkVerify = async (
    targets: PlayerWithDocs[],
    opts: { approveAge?: boolean; approvePhysical?: boolean }
  ): Promise<{ updated: number; skipped: number }> => {
    if (!db || !user) return { updated: 0, skipped: targets.length };
    const now = new Date().toISOString();

    const updates: { path: string; data: Record<string, unknown> }[] = [];
    let skipped = 0;
    for (const player of targets) {
      // Rejected documents are deliberately skipped — clearing a rejection is a
      // per-player decision that belongs in the audit dialog with its reason.
      const canVerifyAge = !!opts.approveAge && !!player.birthCertificateUrl &&
        player.ageVerified !== true && player.compliance?.birthCertificateRejected !== true;
      const canVerifyPhysical = !!opts.approvePhysical && !!player.physicalFormUrl &&
        player.compliance?.physicalVerified !== true && player.compliance?.physicalRejected !== true;
      if (!canVerifyAge && !canVerifyPhysical) {
        skipped++;
        continue;
      }
      const data: Record<string, unknown> = {
        'compliance.verifiedBy': user.uid,
        'compliance.verifiedAt': now,
        updatedAt: now,
      };
      if (canVerifyAge) {
        data.ageVerified = true;
        data['compliance.birthCertificateVerified'] = true;
        data.verifiedBy = user.uid;
        data.verifiedByName = profile?.displayName || 'Admin';
        data.verifiedAt = now;
      }
      if (canVerifyPhysical) {
        data['compliance.physicalVerified'] = true;
      }
      // Bulk approve never touches rejections — it must not silently clear a
      // standing rejection on the document it isn't verifying.
      data['compliance.verificationStatus'] = rollupVerificationStatus({
        birthCertificateVerified: canVerifyAge || player.ageVerified === true,
        physicalVerified: canVerifyPhysical || player.compliance?.physicalVerified === true,
        birthCertificateRejected: player.compliance?.birthCertificateRejected,
        physicalRejected: player.compliance?.physicalRejected,
      });
      updates.push({
        path: (player as any)._refPath ?? `userProfiles/${player.parentUserId}/players/${player.id}`,
        data,
      });
    }

    if (updates.length === 0) {
      toast({ title: 'Nothing to Verify', description: 'The selected players are already verified or have no uploaded document.' });
      return { updated: 0, skipped };
    }

    setGlobalProcessing(true);
    try {
      // Firestore batches cap at 500 ops — chunk and commit sequentially
      for (let i = 0; i < updates.length; i += 400) {
        const batch = writeBatch(db);
        updates.slice(i, i + 400).forEach(u => batch.update(doc(db, u.path), u.data as any));
        await batch.commit();
      }
      toast({
        title: 'Bulk Verification Saved',
        description: `Verified ${updates.length} player(s)${skipped > 0 ? `, skipped ${skipped} already verified or missing documents` : ''}.`,
      });
      return { updated: updates.length, skipped };
    } catch (error: any) {
      if (error?.code === 'permission-denied') {
        errorEmitter.emit('permission-error', new FirestorePermissionError({ path: updates[0].path, operation: 'update', requestResourceData: updates[0].data }));
      } else {
        toast({ variant: 'destructive', title: 'Bulk Verification Failed', description: error.message });
      }
      return { updated: 0, skipped };
    } finally {
      setGlobalProcessing(false);
    }
  };

  const handleDeletePlayer = async (player: PlayerWithDocs): Promise<boolean> => {
    if (!db) return false;
    const refPath = (player as any)._refPath ?? `userProfiles/${player.parentUserId}/players/${player.id}`;
    const playerRef = doc(db, refPath);
    // The player's enrollments live in the same parent's subcollection —
    // delete them too (no orphans) and release any division spots they held.
    const parentUid = refPath.split('/')[1];
    try {
      const enrollSnap = await getDocs(
        query(collection(db, 'userProfiles', parentUid, 'enrollments'), where('playerId', '==', player.id))
      );

      // Physical gear is still in the family's hands — make the admin resolve
      // it in Equipment (return or retire) before the record disappears
      const issuedCount = enrollSnap.docs.reduce(
        (n, d) => n + countIssuedEquipment((d.data() as any).footballEquipment), 0);
      if (issuedCount > 0) {
        toast({
          variant: 'destructive',
          title: 'Cannot Delete Player',
          description: `${issuedCount} equipment item(s) still checked out — return them in Equipment first.`,
        });
        return false;
      }

      const batch = writeBatch(db);
      batch.delete(playerRef);
      for (const enrollDoc of enrollSnap.docs) {
        const e = enrollDoc.data() as any;
        batch.delete(enrollDoc.ref);
        const status = e.paymentStatus ?? e.payment_status;
        if ((status === 'paid' || status === 'fee_waived') && e.seasonId && e.divisionId) {
          batch.set(
            doc(db, 'seasons', e.seasonId, 'divisions', e.divisionId),
            { registeredCount: increment(-1) },
            { merge: true },
          );
        }
      }
      await batch.commit();
      toast({ title: 'Player Deleted', description: `${player.firstName} ${player.lastName} and their registrations have been removed.` });
      return true;
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Delete Failed', description: error.message });
      return false;
    }
  };

  const handleDeleteCoach = async (coach: CoachProfile): Promise<boolean> => {
    if (!db) return false;
    const coachRef = doc(db, 'userProfiles', coach.id);
    try {
      await deleteDoc(coachRef);
      toast({ title: 'Coach Removed', description: `${coach.displayName} has been deleted.` });
      return true;
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Delete Failed', description: error.message });
      return false;
    }
  };

  // Coach portal access is gated on userProfiles.complianceStatus (see
  // hasCoachAccess in sport-context). Re-derive it from the pair of clearance
  // docs after every review so approvals actually unlock the coach pages.
  const syncCoachComplianceStatus = async (
    userId: string
  ): Promise<'approved' | 'pending' | 'action_required'> => {
    if (!db) return 'pending';
    const snaps = await Promise.all(
      REQUIRED_CLEARANCE_DOCS.map(c => getDoc(doc(db, 'userProfiles', userId, 'clearances', c.id)))
    );
    const statuses = snaps.map(s => (s.exists() ? (s.data() as any).status : undefined));
    const overall = statuses.every(s => s === 'Approved')
      ? 'approved'
      : statuses.some(s => s === 'Rejected')
        ? 'action_required'
        : 'pending';
    await updateDoc(doc(db, 'userProfiles', userId), {
      complianceStatus: overall,
      updatedAt: new Date().toISOString(),
    });
    return overall;
  };

  const notifyClearanceDecision = async (
    userId: string,
    clearanceId: string,
    status: 'Approved' | 'Rejected',
    overall: 'approved' | 'pending' | 'action_required',
    reason?: string
  ) => {
    if (!db) return;
    const label = ALL_CLEARANCE_DOCS.find(c => c.id === clearanceId)?.label ?? clearanceId;
    const title = status === 'Approved' ? 'Clearance Approved' : 'Clearance Needs Attention';
    const body = status === 'Approved'
      ? overall === 'approved'
        ? `Your ${label} was approved. All clearances are complete — your coach tools are now unlocked.`
        : `Your ${label} was approved. Coach tools unlock once your remaining clearance is approved.`
      : `Your ${label} was not approved: ${reason?.trim() || 'see the Compliance page for details'}. Please upload a corrected document from the Compliance page.`;
    await setDoc(doc(db, 'notifications', crypto.randomUUID()), {
      userId,
      type: status === 'Approved' ? 'clearanceApproved' : 'clearanceRejected',
      title,
      body,
      relatedDocId: clearanceId,
      relatedDocType: 'clearance',
      read: false,
      createdAt: Timestamp.now(),
    });
    // Clearance decisions gate the coach portal — buzz opted-in devices too
    pushToUsersBestEffort([userId], { title, body, url: '/coach/compliance' });
  };

  const handleUpdateClearanceStatus = async (
    userId: string,
    clearanceId: string,
    status: 'Approved' | 'Rejected',
    reason?: string
  ): Promise<boolean> => {
    if (!db || !user) return false;
    if (status === 'Rejected' && !reason?.trim()) {
      toast({ variant: 'destructive', title: 'Reason Required', description: 'Please provide a reason for rejection.' });
      return false;
    }
    const clearanceRef = doc(db, 'userProfiles', userId, 'clearances', clearanceId);
    const updateData = {
      status,
      rejectionReason: status === 'Rejected' ? reason : null,
      verifiedBy: user.uid,
      verifiedByName: profile?.displayName || 'Admin',
      verifiedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    try {
      await updateDoc(clearanceRef, updateData);
    } catch (error: any) {
      if (error?.code === 'permission-denied') {
        errorEmitter.emit('permission-error', new FirestorePermissionError({ path: clearanceRef.path, operation: 'update', requestResourceData: updateData }));
      } else {
        toast({ variant: 'destructive', title: 'Update Failed', description: error.message });
      }
      return false;
    }
    // The clearance itself is saved — gate sync / notification failures must not
    // read as a failed review, so they get their own error surface.
    try {
      const overall = await syncCoachComplianceStatus(userId);
      await notifyClearanceDecision(userId, clearanceId, status, overall, reason);
      toast({ title: `Clearance ${status}`, description: 'The volunteer has been notified.' });
    } catch (error: any) {
      if (error?.code === 'permission-denied') {
        errorEmitter.emit('permission-error', new FirestorePermissionError({ path: `userProfiles/${userId}`, operation: 'update', requestResourceData: { complianceStatus: '(derived)' } }));
      } else {
        toast({ variant: 'destructive', title: `Clearance ${status}, but access sync failed`, description: error.message });
      }
    }
    return true;
  };

  // Admin uploads a clearance document on behalf of a coach who hasn't submitted
  // one. The doc is auto-approved (the admin is the verifier). Uploads route
  // through /api/upload with the admin's ID token — the route allows staff to
  // write to another user's compliance path.
  const handleUploadClearance = async (
    coachUserId: string,
    type: string,
    expirationDate: string,
    file: File
  ): Promise<boolean> => {
    if (!db || !user || !expirationDate) return false;
    try {
      const idToken = await user.getIdToken();
      const formData = new FormData();
      formData.append('file', file);
      formData.append('path', `compliance/${coachUserId}/${type}_${Date.now()}`);
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      const now = new Date().toISOString();
      const clearanceRef = doc(db, 'userProfiles', coachUserId, 'clearances', type);
      await setDoc(clearanceRef, {
        id: type,
        userId: coachUserId,
        type,
        status: 'Approved',
        fileUrl: data.url as string,
        expirationDate,
        verifiedBy: user.uid,
        verifiedByName: profile?.displayName || 'Admin',
        verifiedAt: now,
        updatedAt: now,
      });
      const overall = await syncCoachComplianceStatus(coachUserId);
      await notifyClearanceDecision(coachUserId, type, 'Approved', overall);
      toast({ title: 'Clearance Uploaded', description: 'Document saved and approved for this volunteer.' });
      return true;
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Upload Failed', description: error.message });
      return false;
    }
  };

  const handleConfirmFeeWaiver = async () => {
    const { enrollment, player } = feeWaiverDialog;
    if (!enrollment?.parentUserId || !db) return;
    setFeeWaiverDialog(prev => ({ ...prev, loading: true }));

    try {
      const enrollmentRef = doc(db, 'userProfiles', enrollment.parentUserId, 'enrollments', enrollment.id);
      await updateDoc(enrollmentRef, {
        paymentStatus: 'fee_waived',
        fee_waived: true,
        waiver_reason: feeWaiverDialog.reason.trim(),
        updatedAt: new Date().toISOString(),
      });

      // A waived registration occupies a roster spot just like a paid one —
      // count it toward division capacity (waiving is only offered on unpaid
      // rows, so this can't double-count).
      if (enrollment.seasonId && enrollment.divisionId) {
        try {
          await updateDoc(
            doc(db, 'seasons', enrollment.seasonId, 'divisions', enrollment.divisionId),
            { registeredCount: increment(1) },
          );
        } catch (err) {
          // Division may have been deleted — the recount tool reconciles any drift
          console.warn('[registration] capacity increment skipped:', err);
        }
      }

      // Look up parent email from userProfiles
      let parentEmail = '';
      try {
        const profileSnap = await getDoc(doc(db, 'userProfiles', enrollment.parentUserId));
        parentEmail = profileSnap.data()?.email || '';
      } catch (err) {
        console.warn('[registration] parent email lookup failed:', err);
      }

      // Send confirmation email — with human-readable season/division names,
      // not the raw Firestore IDs.
      try {
        const idToken = await user?.getIdToken();
        const emailRes = await fetch('/api/email/confirmation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({
            toEmail: parentEmail,
            playerName: player ? `${player.firstName} ${player.lastName}` : '',
            seasonName: (seasons ?? []).find((s: any) => s.id === enrollment.seasonId)?.name ?? enrollment.seasonId,
            divisionName: sportFilteredDivisions.find(d => d.id === enrollment.divisionId)?.name ?? enrollment.divisionId,
            isWaitlisted: false,
            feeWaived: true,
          }),
        });
        if (!emailRes.ok) {
          toast({ title: "Fee Waiver Applied", description: "Marked as fee waived, but confirmation email failed to send.", variant: "destructive" });
        } else {
          toast({ title: "Fee Waiver Applied", description: `Registration marked as fee waived.` });
        }
      } catch {
        toast({ title: "Fee Waiver Applied", description: "Marked as fee waived, but confirmation email failed to send.", variant: "destructive" });
      }
      setFeeWaiverDialog({ open: false, player: null, enrollment: null, reason: '', loading: false });
    } catch (error: any) {
      console.error('[registration] Fee waiver error:', error);
      toast({ title: "Error", description: error.message, variant: 'destructive' });
      setFeeWaiverDialog(prev => ({ ...prev, loading: false }));
    }
  };

  // Move a waitlisted enrollment to pending_payment and tell the parent a spot
  // opened. The parent then pays through the normal resume-payment flow on
  // their dashboard, which is what finalizes the roster spot.
  const handleConfirmPromote = async () => {
    const { enrollment, player } = promoteDialog;
    if (!enrollment?.parentUserId || !db) return;
    setPromoteDialog(prev => ({ ...prev, loading: true }));

    try {
      const enrollmentRef = doc(db, 'userProfiles', enrollment.parentUserId, 'enrollments', enrollment.id);
      // Both status fields exist on enrollments (legacy + current) — set both
      // so every reader agrees the player is off the waitlist.
      await updateDoc(enrollmentRef, {
        paymentStatus: 'pending_payment',
        payment_status: 'pending_payment',
        promotedFromWaitlistAt: new Date().toISOString(),
        promotedByAdminUid: user?.uid ?? '',
        updatedAt: new Date().toISOString(),
      });

      const playerName = player ? `${player.firstName} ${player.lastName}` : 'your player';
      const seasonName = (seasons ?? []).find((s: any) => s.id === enrollment.seasonId)?.name ?? enrollment.seasonId;
      const divisionName = sportFilteredDivisions.find(d => d.id === enrollment.divisionId)?.name ?? enrollment.divisionId;

      await setDoc(doc(db, 'notifications', crypto.randomUUID()), {
        userId: enrollment.parentUserId,
        type: 'announcement',
        title: 'A Spot Opened Up!',
        body: `${playerName} has been moved off the waitlist for ${divisionName} (${seasonName}). Complete the registration payment from your dashboard to lock in the spot.`,
        read: false,
        createdAt: Timestamp.now(),
      });

      let emailOk = false;
      try {
        const profileSnap = await getDoc(doc(db, 'userProfiles', enrollment.parentUserId));
        const parentEmail = profileSnap.data()?.email || '';
        if (parentEmail) {
          const idToken = await user?.getIdToken();
          const emailRes = await fetch('/api/email/confirmation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
            body: JSON.stringify({
              toEmail: parentEmail,
              playerName,
              seasonName,
              divisionName,
              waitlistPromoted: true,
              sport: activeSport,
            }),
          });
          emailOk = emailRes.ok;
        }
      } catch (err) {
        console.warn('[registration] promote email failed:', err);
      }

      toast({
        title: 'Promoted from Waitlist',
        description: emailOk
          ? 'The family has been emailed to complete payment.'
          : 'Promoted, but the email could not be sent — please contact the family directly.',
        ...(emailOk ? {} : { variant: 'destructive' as const }),
      });
      setPromoteDialog({ open: false, player: null, enrollment: null, loading: false });
    } catch (error: any) {
      if (error?.code === 'permission-denied') {
        errorEmitter.emit('permission-error', new FirestorePermissionError({ path: `userProfiles/${enrollment.parentUserId}/enrollments/${enrollment.id}`, operation: 'update', requestResourceData: { paymentStatus: 'pending_payment' } }));
      } else {
        toast({ title: 'Promotion Failed', description: error.message, variant: 'destructive' });
      }
      setPromoteDialog(prev => ({ ...prev, loading: false }));
    }
  };

  /**
   * Tick the volunteer deposit check on an enrollment. Football families write
   * a check the league holds until their shifts are met; this is the manual
   * record of it changing hands. Admin-only — firestore.rules blocks Board
   * Members from writing non-equipment enrollment fields.
   */
  const handleSetDepositStatus = async (enrollment: EnrollmentRecord, next: DepositStatus | null) => {
    if (!db || !user || !enrollment.parentUserId) return;
    const enrollmentRef = doc(db, 'userProfiles', enrollment.parentUserId, 'enrollments', enrollment.id);
    const now = new Date().toISOString();
    const adminName = profile?.displayName || 'Admin';

    const updateData: Record<string, unknown> = { updatedAt: now };
    if (next === 'held') {
      updateData.volunteerDepositStatus = 'held';
      updateData.volunteerDepositReceivedAt = now;
      updateData.volunteerDepositReceivedBy = user.uid;
      updateData.volunteerDepositReceivedByName = adminName;
      // Re-receiving after a return starts a fresh cycle
      updateData.volunteerDepositReturnedAt = deleteField();
      updateData.volunteerDepositReturnedBy = deleteField();
      updateData.volunteerDepositReturnedByName = deleteField();
    } else if (next === 'returned') {
      updateData.volunteerDepositStatus = 'returned';
      updateData.volunteerDepositReturnedAt = now;
      updateData.volunteerDepositReturnedBy = user.uid;
      updateData.volunteerDepositReturnedByName = adminName;
    } else {
      // Ticked by mistake — remove the fields entirely so the enrollment looks
      // exactly like one that never had a deposit, per the type's "absent = not
      // received" contract.
      for (const field of [
        'volunteerDepositStatus',
        'volunteerDepositReceivedAt', 'volunteerDepositReceivedBy', 'volunteerDepositReceivedByName',
        'volunteerDepositReturnedAt', 'volunteerDepositReturnedBy', 'volunteerDepositReturnedByName',
      ]) {
        updateData[field] = deleteField();
      }
    }

    try {
      await updateDoc(enrollmentRef, updateData as any);
      toast({
        title: next === 'held' ? 'Deposit Recorded'
          : next === 'returned' ? 'Deposit Returned'
          : 'Deposit Cleared',
        description: next === 'held' ? 'The check is marked as held by the league.'
          : next === 'returned' ? 'The check is marked as returned to the family.'
          : 'No deposit is on file for this registration.',
      });
    } catch (error: any) {
      if (error?.code === 'permission-denied') {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
          path: enrollmentRef.path,
          operation: 'update',
          requestResourceData: updateData,
        }));
      } else {
        toast({ variant: 'destructive', title: 'Deposit Update Failed', description: error.message });
      }
    }
  };

  const exportRegistrationsCSV = () => {
    if (!enrollments.length) return;
    const divisionNameMap = new Map(
      (sportFilteredDivisions ?? []).map(d => [d.id, d.name])
    );
    const headers = ['First Name', 'Last Name', 'Division', 'Season', 'Payment Status', 'Volunteer Deposit', 'Fee Amount', 'Shirt Size', 'Uniform # Preference', 'Registered Date'];
    const rows = enrollments.map(e => {
      const p = allPlayers?.find(p => p.id === e.playerId);
      return [
        p?.firstName ?? 'N/A',
        p?.lastName ?? 'N/A',
        divisionNameMap.get(e.divisionId) ?? e.divisionId,
        e.seasonId,
        getEnrollmentStatus(e),
        e.volunteerDepositStatus === 'held' ? 'Held'
          : e.volunteerDepositStatus === 'returned' ? 'Returned'
          : 'Not Received',
        e.registrationFeeAmount != null ? formatCents(e.registrationFeeAmount) : '',
        e.shirtSize ?? e.jerseySize ?? '',
        e.uniformNumberPreference ?? '',
        e.registered_at ?? e.enrollmentDate ?? '',
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `registrations_${selectedSeason || 'all'}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ── Guards ─────────────────────────────────────────────────────────────────

  if (loadingUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAdmin && !isBoardMember) {
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

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6 min-w-0 overflow-x-hidden">
        <header className="mb-4 md:mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl md:text-2xl font-bold font-headline">Registrations &amp; Compliance</h1>
            <p className="text-sm text-muted-foreground">Player registrations, document verification, and volunteer clearances.</p>
          </div>
          <Button onClick={() => setManualRegOpen(true)} className="rounded-full">
            <UserPlus className="mr-2 h-4 w-4" /> Manually Register
          </Button>
        </header>

        <ManualRegistrationDialog
          open={manualRegOpen}
          onOpenChange={setManualRegOpen}
          seasons={(seasons ?? []) as { id: string; name: string; status?: string }[]}
        />

        {/* Metrics */}
        <MetricsCards
          totalRevenue={stats.totalRevenue}
          totalPlayers={stats.total}
          pendingVerifications={pendingVerifications}
        />

        <Tabs defaultValue="players" className="space-y-6">
          <TabsList className="bg-white p-1 rounded-xl shadow-sm border h-12">
            <TabsTrigger value="players" className="rounded-lg px-6 h-10 data-[state=active]:bg-primary data-[state=active]:text-white">
              <UserCheck className="h-4 w-4 mr-2" />
              Players
              {pendingVerifications > 0 && (
                <span className="ml-2 bg-yellow-100 text-yellow-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  {pendingVerifications}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="revenue" className="rounded-lg px-6 h-10 data-[state=active]:bg-primary data-[state=active]:text-white">
              <TrendingUp className="h-4 w-4 mr-2" />
              Revenue
            </TabsTrigger>
            <TabsTrigger value="coaches" className="rounded-lg px-6 h-10 data-[state=active]:bg-primary data-[state=active]:text-white">
              <ShieldCheck className="h-4 w-4 mr-2" />
              Coaches
            </TabsTrigger>
          </TabsList>

          {/* ── Players Tab ── */}
          <TabsContent value="players">
            {loadingPlayers ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
              </div>
            ) : (
              <PlayerTable
                players={sportFilteredPlayers}
                enrollments={enrollments}
                divisions={sportFilteredDivisions}
                playerSportMap={playerSportMap}
                isSiteAdmin={isSiteAdmin}
                canAudit={isBoardMember}
                isProcessing={globalProcessing}
                showLeagueForm={activeSport === 'football'}
                initialAuditPlayerId={auditPlayerId ?? undefined}
                onAuditSubmit={handleAuditSubmit}
                onDeletePlayer={handleDeletePlayer}
                onBulkVerify={handleBulkVerify}
                onWaiveFee={(player, enrollment) => setFeeWaiverDialog({ open: true, player, enrollment, reason: '', loading: false })}
                onPromoteWaitlist={(player, enrollment) => setPromoteDialog({ open: true, player, enrollment, loading: false })}
                showDeposit={activeSport === 'football'}
                canEditPayment={isAdmin}
                onSetDepositStatus={handleSetDepositStatus}
              />
            )}
          </TabsContent>

          {/* ── Revenue Tab ── */}
          <TabsContent value="revenue">
            <div className="space-y-4">
              {/* Season selector + export */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <h2 className="text-base font-semibold">Revenue by Season</h2>
                <div className="flex items-center gap-3">
                  <Select value={selectedSeason} onValueChange={setSelectedSeason}>
                    <SelectTrigger className="w-48 rounded-xl">
                      <SelectValue placeholder="All Seasons" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all-seasons">All Seasons</SelectItem>
                      {seasons?.map((s: any) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button onClick={exportRegistrationsCSV} className="rounded-full" disabled={!enrollments.length}>
                    <Download className="mr-2 h-4 w-4" /> Export CSV
                  </Button>
                </div>
              </div>

              {loadingEnrollments ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-10 w-10 animate-spin text-primary" />
                </div>
              ) : (
                <>
                  {/* Stat Cards */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <Card className="border-none shadow-md col-span-2 lg:col-span-1">
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-bold uppercase text-muted-foreground">Revenue Collected</p>
                          <DollarSign className="h-4 w-4 text-green-500" />
                        </div>
                        <p className="text-2xl font-bold text-green-600">{formatCents(stats.totalRevenue)}</p>
                        <p className="text-xs text-muted-foreground">{stats.paid.length} paid</p>
                      </CardContent>
                    </Card>
                    <Card className="border-none shadow-md">
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-bold uppercase text-muted-foreground">Fee Waivers</p>
                          <BadgeCheck className="h-4 w-4 text-emerald-500" />
                        </div>
                        <p className="text-2xl font-bold">{stats.waived.length}</p>
                        <p className="text-xs text-muted-foreground">{formatCents(stats.waivedValue)} waived</p>
                      </CardContent>
                    </Card>
                    <Card className="border-none shadow-md">
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-bold uppercase text-muted-foreground">Pending Payment</p>
                          <Clock className="h-4 w-4 text-yellow-500" />
                        </div>
                        <p className="text-2xl font-bold text-yellow-600">{stats.pending.length}</p>
                        <p className="text-xs text-muted-foreground">awaiting checkout</p>
                      </CardContent>
                    </Card>
                    <Card className="border-none shadow-md">
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-bold uppercase text-muted-foreground">Waitlisted</p>
                          <ListOrdered className="h-4 w-4 text-amber-500" />
                        </div>
                        <p className="text-2xl font-bold text-amber-600">{stats.waitlisted.length}</p>
                        <p className="text-xs text-muted-foreground">no charge yet</p>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Division Breakdown */}
                  <Card className="border-none shadow-xl overflow-hidden">
                    <CardHeader className="bg-primary text-primary-foreground">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="h-5 w-5" />
                        <CardTitle className="text-xl font-headline">Division Breakdown</CardTitle>
                      </div>
                      <CardDescription className="text-primary-foreground/80">
                        Registration counts, capacity utilization, and revenue by division.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                      {divisionStats.length === 0 ? (
                        <div className="text-center py-16 text-muted-foreground">No registrations found for this filter.</div>
                      ) : (
                        <div className="divide-y">
                          {divisionStats.map(div => {
                            const divLabel = div.divisionId.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                            return (
                              <div key={div.divisionId} className="p-3 md:p-4 hover:bg-secondary/10 transition-colors">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                  <div className="flex-1">
                                    <p className="font-semibold">{divLabel}</p>
                                    <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
                                      <span>{div.registered} registered</span>
                                      <span>{div.pending} pending</span>
                                      <span className="text-green-600 font-medium">{formatCents(div.revenue)} collected</span>
                                    </div>
                                  </div>
                                  <div className="sm:w-48">
                                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                                      <span>Utilization</span>
                                      <span>{div.registered} players</span>
                                    </div>
                                    <div className="w-full bg-secondary rounded-full h-2 overflow-hidden">
                                      <div
                                        className="h-2 rounded-full bg-primary transition-all"
                                        style={{ width: `${Math.min(100, div.registered * 5)}%` }}
                                      />
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </>
              )}
            </div>
          </TabsContent>

          {/* ── Coaches Tab ── */}
          <TabsContent value="coaches">
            <CoachComplianceTable
              coaches={sportFilteredCoaches}
              clearances={allClearances ?? []}
              isLoading={loadingCoaches}
              isSiteAdmin={isSiteAdmin}
              onUpdateStatus={handleUpdateClearanceStatus}
              onUploadClearance={handleUploadClearance}
              onDeleteCoach={handleDeleteCoach}
            />
          </TabsContent>
        </Tabs>
      </main>

      {/* Fee Waiver Dialog */}
      <Dialog open={feeWaiverDialog.open} onOpenChange={(open) => { if (!open && !feeWaiverDialog.loading) setFeeWaiverDialog({ open: false, player: null, enrollment: null, reason: '', loading: false }); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Apply Fee Waiver</DialogTitle>
            <DialogDescription>
              {feeWaiverDialog.player
                ? `Mark ${feeWaiverDialog.player.firstName} ${feeWaiverDialog.player.lastName}'s registration as fee waived. A confirmation email will be sent to the parent.`
                : 'Mark this registration as fee waived.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label htmlFor="waiver-reason">Reason (optional)</Label>
              <Input
                id="waiver-reason"
                placeholder="e.g. Financial hardship, scholarship, board vote"
                value={feeWaiverDialog.reason}
                onChange={e => setFeeWaiverDialog(prev => ({ ...prev, reason: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setFeeWaiverDialog({ open: false, player: null, enrollment: null, reason: '', loading: false })}
              disabled={feeWaiverDialog.loading}
            >
              Cancel
            </Button>
            <Button onClick={handleConfirmFeeWaiver} disabled={feeWaiverDialog.loading} className="bg-emerald-600 hover:bg-emerald-700">
              {feeWaiverDialog.loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <BadgeCheck className="h-4 w-4 mr-2" />}
              Confirm Waiver
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={promoteDialog.open} onOpenChange={(open) => { if (!open && !promoteDialog.loading) setPromoteDialog({ open: false, player: null, enrollment: null, loading: false }); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Promote from Waitlist</DialogTitle>
            <DialogDescription>
              {promoteDialog.player
                ? `Move ${promoteDialog.player.firstName} ${promoteDialog.player.lastName} off the waitlist. The family will be emailed to complete the registration payment — the spot is theirs once they pay.`
                : 'Move this registration off the waitlist.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPromoteDialog({ open: false, player: null, enrollment: null, loading: false })}
              disabled={promoteDialog.loading}
            >
              Cancel
            </Button>
            <Button onClick={handleConfirmPromote} disabled={promoteDialog.loading}>
              {promoteDialog.loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <UserCheck className="h-4 w-4 mr-2" />}
              Promote & Notify
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
