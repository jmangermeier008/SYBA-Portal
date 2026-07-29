/**
 * Unified Master Scheduling System — Centralized TypeScript Types
 *
 * All scheduling-related collections and their document shapes live here.
 * Import from this file rather than defining inline types in page components.
 */

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

/** All assignable user roles in the portal. Users can hold multiple roles simultaneously. */
export type UserRole =
  | 'Parent'
  | 'Coach'
  | 'Board Member'
  | 'Admin'
  | 'Site Admin';

/** Roles that can be assigned per-sport in sportRoles. Excludes 'Parent' (implicit) and 'Site Admin' (cross-sport). */
export type SportRole = 'Coach' | 'Board Member' | 'Admin';

// ---------------------------------------------------------------------------
// Sports
// ---------------------------------------------------------------------------

/** The sports supported by the portal. */
export type Sport = 'baseball' | 'football';

/** Whether a game is played at the home or away venue. */
export type LocationType = 'home' | 'away';

// ---------------------------------------------------------------------------
// Seasons
// ---------------------------------------------------------------------------

/** Active seasons accept registrations; archived seasons are historical. */
export type SeasonStatus = 'active' | 'archived';

/** A league season — the top-level container for all scheduling and enrollment activity. */
export interface Season {
  id: string;
  name: string;
  status: SeasonStatus;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  createdBy: string;
  createdAt: string;
  volunteerSlotsRequired?: number; // min concession slots required per enrolled player
  ageCutoffDate?: string; // YYYY-MM-DD — baseball age is calculated as of this date (e.g. "2026-04-30")
  siblingFee?: number; // Cents — flat fee for each child after the first paid/fee-waived enrollment this season; absent = 5000 ($50)
  sport: Sport;
  isTest?: boolean; // When true, this season is synthetic test data — excluded from live UI queries
  hasDivisions?: boolean; // True when at least one division subcollection doc exists; controls enrollment visibility
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

export type FieldType = 'game' | 'practice' | 'both';

export interface MaintenanceClosure {
  date: string;   // YYYY-MM-DD
  reason?: string;
}

/** A physical field or facility where games and practices are held. */
export interface Field {
  id: string;
  name: string;
  address?: string;
  type: FieldType;
  isActive: boolean;
  availabilityStart: string; // HH:MM
  availabilityEnd: string;   // HH:MM
  maintenanceClosures: MaintenanceClosure[];
  createdAt: string;
  sport: Sport;
}

/** A single date on which the entire sports complex is closed (weather, events, etc.). */
export interface ComplexClosure {
  date: string;    // YYYY-MM-DD
  reason?: string;
}

/** Shape of the `settings/complexClosures` singleton Firestore document. */
export interface ComplexClosuresDocument {
  closures: ComplexClosure[];
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

/** A team within a season. Supports multiple coaches via coachIds array. */
export interface Team {
  id: string;
  name: string;
  seasonId: string;
  divisionId: string;
  coachIds: string[];    // Supports multiple coaches per team
  player_ids?: string[]; // Legacy field — kept for backward compatibility
  createdAt: string;
  practiceOptOut?: boolean; // When true, excluded from fairness rotation count
  sport: Sport;
}

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------

export type GameStatus = 'scheduled' | 'cancelled' | 'completed' | 'postponed' | 'unscheduled';
export type GameType = 'game' | 'practice';

/**
 * A game or practice event in the top-level `games` collection (admin/league-wide).
 * NOTE: The team-specific `teams/{teamId}/games` subcollection uses a different shape
 * with a combined `dateTime: string` ISO field instead of separate `date` + `time`.
 */
export interface Game {
  id: string;
  seasonId: string;
  fieldId: string;
  fieldName: string;
  type: GameType;
  date: string;   // YYYY-MM-DD
  time: string;   // HH:MM
  endTime?: string; // HH:MM — optional, must be after `time`; same-day only
  status: GameStatus;
  // League games:
  homeTeamId?: string;
  homeTeamName?: string;
  awayTeamId?: string;
  awayTeamName?: string;
  division?: string;
  divisionId?: string;
  // Practices (team-specific) and football games (external opponent):
  teamId?: string;
  teamName?: string;
  opponentName?: string;   // Football: external school name (not an internal team)
  notes?: string;
  // Final scores (populated when status = 'completed'):
  homeScore?: number;
  awayScore?: number;
  // Umpire assignment + notification tracking:
  umpireName?: string;
  umpireNotified?: boolean;
  sport: Sport;
  locationType?: LocationType;
  scrimmageNote?: string; // Optional follow-on event note, e.g. "Wee Wee Scrimmage follows at 6:30 PM"
  isRecurring?: boolean;   // True when created as part of a recurring series
  recurrenceId?: string;   // Shared UUID across all games in the same recurring series
  createdBy?: string;
  createdAt: string;
  updatedAt?: string;
  // Rain-out displacement history — populated when status is set to 'unscheduled':
  originalDate?: string;       // YYYY-MM-DD
  originalTime?: string;       // HH:MM
  originalFieldId?: string;
  originalFieldName?: string;
}

/** Coach-recorded attendance status for one player at one event. */
export type AttendanceStatus = 'present' | 'late' | 'absent';

/**
 * The roll call stored on a team-mirror game doc.
 *
 * `recordedBy` / `recordedAt` live INSIDE this map rather than as sibling
 * top-level fields on purpose — firestore.rules only lets a coach update the
 * game doc when the changed top-level keys are whitelisted, and 'attendance'
 * is the only one available. Hoisting them out would break coach writes.
 * Behavior lives in src/lib/attendance.ts.
 */
export interface AttendanceRecord {
  /** playerId -> status. A missing key means "not marked". */
  marks?: Record<string, AttendanceStatus>;
  recordedBy?: string;           // uid of the last coach/admin to touch it
  recordedAt?: string;           // naive-local "YYYY-MM-DDTHH:MM:SS"
}

/**
 * A game or practice event in the `teams/{teamId}/games` subcollection (coach/parent-facing).
 * IMPORTANT: Different shape from the top-level `Game` type:
 *   - `dateTime` is a single ISO string ("YYYY-MM-DDTHH:MM:00") instead of separate `date` + `time`
 *   - `type` values are capitalized ('Game' | 'Practice') instead of lowercase
 *   - `cancelled: boolean` represents cancellation status instead of a `status` field
 */
export interface TeamGame {
  id: string;
  teamId: string;
  seasonId: string;
  type: 'Game' | 'Practice';    // Always capitalized — differs from top-level GameType
  dateTime: string;              // ISO combined: "YYYY-MM-DDTHH:MM:00"
  endTime?: string;              // HH:MM — optional; start stays inside dateTime
  location: string;              // fieldName
  fieldId: string;
  opponentName?: string;         // The OTHER team's name (only for 'Game' type)
  locationType?: 'home' | 'away'; // Football: whether game is at home or away
  cancelled: boolean;
  cancellationReason?: string;
  /**
   * Coach-recorded roll call — who actually showed up. NOT the same thing as
   * the `rsvps` subcollection, which is a parent stating intent beforehand.
   * Coach/admin visible only; never rendered to parents.
   * Owned by src/lib/attendance.ts — see the note there on why recordedBy /
   * recordedAt live inside this map instead of as sibling fields.
   */
  attendance?: AttendanceRecord;
  practiceSlotId?: string;       // Links to practiceSlots/{id} when applicable
  isRecurring?: boolean;         // True when created as part of a recurring series
  recurrenceId?: string;         // Shared UUID across all games in the same recurring series
  coachUserId?: string;
  umpireName?: string;
  createdAt?: string;
  updatedAt?: string;
}

// ---------------------------------------------------------------------------
// Concession Slots  (collection: concessionSlots)
// ---------------------------------------------------------------------------

export interface ConcessionSignup {
  signupId?: string; // unique per spot — lets one parent hold multiple spots in a slot
  parentUserId: string;
  displayName: string;
  signedUpAt: string;
  attendance?: 'pending' | 'worked' | 'no-show'; // admin-recorded after the shift
}

/**
 * Kind of volunteer shift. A shift with no `type` set predates this field and
 * is treated as 'concessions' for backward compatibility.
 */
export type VolunteerShiftType =
  | 'concessions'
  | 'tagging'
  | 'fundraiser'
  | 'chains'
  | 'maintenance';

/**
 * Shift types that count toward a family's required volunteer credit for the
 * season. Other types (fundraiser, chains, maintenance) are optional/extra.
 */
export const VOLUNTEER_TYPES_COUNTING_TOWARD_REQUIREMENT: VolunteerShiftType[] = [
  'concessions',
  'tagging',
];

/**
 * Football per-player, per-type worked-shift minimums. Football families must
 * complete BOTH a concession shift AND a tagging shift per enrolled player.
 * Baseball ignores this and uses the single pooled Season.volunteerSlotsRequired.
 */
export const FOOTBALL_PER_PLAYER_REQUIREMENTS: Partial<Record<VolunteerShiftType, number>> = {
  concessions: 1,
  tagging: 1,
};

/** A volunteer concession shift. claimedCount mirrors signups.length — keep in sync via transaction. */
export interface ConcessionSlot {
  id: string;
  // --- Identity ---
  // Optional human label for standalone shifts (e.g. "Tagging at D'Onofrios").
  title?: string;
  // Kind of shift. Absent = legacy concession shift (treated as 'concessions').
  type?: VolunteerShiftType;
  // Groups auto-generated tagging-event shifts under one event (shared title +
  // location). Absent on ordinary standalone and game-linked slots.
  eventId?: string;
  // --- Linking ---
  // gameId is the "silent link" to a Game document.
  // Null / absent = standalone shift (e.g. tournament day).
  gameId?: string;
  isStandalone: boolean;
  seasonId?: string;
  // --- Scheduling ---
  gameDate: string;   // YYYY-MM-DD  (kept for backward compatibility)
  startTime: string;  // HH:MM
  endTime: string;    // HH:MM
  // --- Capacity ---
  capacity: number;
  // claimedCount mirrors signups.length and is used for atomic capacity checks.
  // Always keep in sync with signups array via Firestore transaction.
  claimedCount: number;
  // --- Config ---
  cancelCutoffHours: number;
  description?: string;
  status: 'active' | 'cancelled';
  locationType?: LocationType;
  // --- Legacy signup array ---
  // Existing signup records live here. New signups continue to use this array
  // via transaction. A future migration may move these to a claims subcollection.
  signups: ConcessionSignup[];
  sport: Sport;
  createdAt: string;
  updatedAt?: string;
}

// concessionSlots/{slotId}/claims  — future private subcollection
// Kept separate from the signups array so Firestore Rules can restrict
// parents to reading only their own claim document.
export interface ConcessionClaim {
  id: string;
  parentId: string;
  claimedAt: string;
}

// ---------------------------------------------------------------------------
// Practice Slots  (collection: practiceSlots)
// ---------------------------------------------------------------------------

export type PracticeSlotStatus = 'available' | 'claimed' | 'pending' | 'cancelled';

/** A practice time window on a field, available for division-eligible teams to claim. */
export interface PracticeSlot {
  id: string;
  seasonId: string;
  fieldId: string;
  fieldName: string;
  divisionIds: string[]; // Eligible divisions (e.g. ['coach-pitch', 'kid-pitch']). Always at least 1.
  date: string;          // YYYY-MM-DD
  startTime: string;     // HH:MM
  endTime: string;       // HH:MM
  status: PracticeSlotStatus;
  // Populated ONLY when claimed:
  teamId?: string;
  teamName?: string;
  coachId?: string;
  coachName?: string;
  claimedAt?: string;
  teamGameId?: string;   // Doc ID written to teams/{teamId}/games/{teamGameId} — used for cleanup on cancel/unclaim
  notes?: string;
  // Populated ONLY when status === 'pending' (awaiting admin approval); cleared on approve/deny:
  pendingTeamId?: string;
  pendingTeamName?: string;
  pendingCoachId?: string;
  pendingCoachName?: string;
  pendingRequestedAt?: string;
  pendingReason?: string; // Human-readable reason why approval is needed
  sport: Sport;
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
}

// ---------------------------------------------------------------------------
// Notifications  (collection: notifications)
// ---------------------------------------------------------------------------

export type NotificationType =
  | 'shiftMoved'
  | 'shiftCancelled'
  | 'practiceSlotCancelled'
  | 'practiceSlotChanged'
  | 'practiceSlotClaimed'
  | 'practiceSlotRequestApproved'
  | 'practiceSlotRequestDenied'
  | 'concessionSignupConfirmed'
  | 'concessionSignupCancelled'
  | 'concessionShiftReminder'
  | 'gameReminder'
  | 'clearanceApproved'
  | 'clearanceRejected'
  | 'documentRejected'
  | 'announcement'
  | 'coachActivity'
  | 'gameCancelled'
  | 'gameRescheduled'
  | 'eventAdded'
  | 'rsvpNudge'
  | 'equipment'
  | 'paymentConfirmed';

export type NotificationRelatedDocType =
  | 'game'
  | 'customEvent'
  | 'concessionSlot'
  | 'practiceSlot'
  | 'clearance'
  | 'announcement'
  | 'enrollment'
  | 'player';

/** An in-app notification written to the notifications collection when league events occur. */
export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  relatedDocId?: string;
  relatedDocType?: NotificationRelatedDocType;
  read: boolean;
  createdAt: string;
  sport?: Sport;      // Set when the notification is sport-scoped
  isGlobal?: boolean; // When true, shown in all sport modes (association-wide alerts)
}

// ---------------------------------------------------------------------------
// User Profile  (collection: userProfiles)
// ---------------------------------------------------------------------------

export interface NotificationPrefs {
  email: boolean;
  inApp: boolean;
  // Web push. Undefined = never enabled (senders skip only `=== false`);
  // device tokens live at userProfiles/{uid}/pushTokens/{token}.
  push?: boolean;
}

/** Firestore user profile (collection: userProfiles). Extends the Firebase Auth user record. */
export interface UserProfile {
  id: string;
  email: string | null;
  displayName: string | null;
  isSiteAdmin?: boolean;   // Authoritative cross-sport superuser flag
  role?: UserRole;         // Legacy single-role field (backward compat, read-only)
  roles?: UserRole[];      // Legacy multi-role field (backward compat, read-only)
  // Sport-specific roles: e.g. { baseball: ['Board Member'], football: ['Coach'] }
  sportRoles?: Record<string, SportRole[]>;
  phoneNumber?: string | null;
  shareContactInfo?: boolean;
  // Parents — drives the combined family calendar query:
  enrolledPlayerIds?: string[];
  // Coaches — all teams they are assigned to:
  teamIds?: string[];
  // Football coaches — divisions they are assigned to (football has no teams):
  divisionIds?: string[];
  notificationPrefs?: NotificationPrefs;
  preferredSport?: Sport;
  complianceStatus?: 'pending' | 'approved' | 'action_required';
  manualComplianceOverride?: boolean; // Admin emergency bypass — skips clearance check
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Players  (subcollection: userProfiles/{userId}/players)
// ---------------------------------------------------------------------------

/** Emergency contact for a player — stored on the player document and copied into enrollments. */
export interface EmergencyContact {
  name: string;
  phone: string;
  relationship: string;
}

/** A player profile stored as a subcollection under the parent's userProfile document. */
export interface Player {
  id: string;
  firstName: string;
  lastName: string;
  teamId?: string;
  division?: string;
  seasonId?: string;
  parentIds?: string[]; // Supports two parents per child (legacy — use parentUids going forward)
  parentUids?: string[]; // All parent/guardian UIDs who have access to this player
  primaryParentId?: string;   // UID of the parent whose subcollection this player lives under
  secondaryParentId?: string; // UID of linked second parent
  dateOfBirth: string;
  // League-form fields — collected in the enrollment stepper for football only
  streetAddress?: string;
  city?: string;
  schoolEnrolled?: string;
  grade?: string; // string, not number — supports "K"
  waiverSignatureUrl?: string; // Digital signature image drawn during enrollment
  waiverSignedAt?: string;     // ISO timestamp of the digital signature
  waiverSignedRelationship?: string; // Signer's relationship to the player (e.g. "Mother")
  waiverSignedName?: string;   // Signer's printed name, captured at signing time
  clearanceUrl?: string;
  emergencyContacts?: EmergencyContact[];
  medicalNotes?: string;
  equipment?: {
    jerseySize?: 'YS' | 'YM' | 'YL' | 'AS' | 'AM' | 'AL' | 'AXL';
    status: 'none' | 'issued' | 'returned';
    helmetNumber?: string;
  };
  // Uploaded document URLs — long-lived signed URLs returned by /api/upload
  birthCertificateUrl?: string;
  physicalFormUrl?: string;
  ageVerified?: boolean;       // Mirrors compliance.birthCertificateVerified
  verifiedBy?: string;
  verifiedByName?: string;
  verifiedAt?: string;
  compliance?: {
    birthCertificateVerified: boolean;
    physicalVerified: boolean;
    verifiedBy?: string;         // UID of the admin who last verified
    verifiedAt?: string;         // ISO timestamp of last verification
    verificationStatus?: 'pending' | 'approved' | 'rejected';
    rejectionReason?: string;    // Combined human-readable reason — what the parent dashboard shows
    // Per-document rejection. There are two documents but only one
    // verificationStatus, so the parent can't tell which file to re-send
    // without these. Cleared for a document when that document is re-uploaded.
    birthCertificateRejected?: boolean;
    birthCertificateRejectionReason?: string;
    physicalRejected?: boolean;
    physicalRejectionReason?: string;
    rejectedBy?: string;         // UID of the admin who last rejected
    rejectedByName?: string;
    rejectedAt?: string;         // ISO timestamp of last rejection
    leagueFormSigned?: boolean;  // Football: signed Shenango Valley league agreement received
    parentalAgreementSigned?: boolean; // Football: signed SVMFL Child/Parent Contract + Adult Code of Ethics received
  };
}

/**
 * Rolls the two per-document verdicts up into the single status the parent
 * surfaces read. A rejection always wins — a family with one bad document has
 * work to do regardless of how the other one looks.
 */
export function rollupVerificationStatus(c: {
  birthCertificateVerified?: boolean;
  physicalVerified?: boolean;
  birthCertificateRejected?: boolean;
  physicalRejected?: boolean;
}): 'pending' | 'approved' | 'rejected' {
  if (c.birthCertificateRejected || c.physicalRejected) return 'rejected';
  return c.birthCertificateVerified && c.physicalVerified ? 'approved' : 'pending';
}

/**
 * Flattens the per-document reasons into the single string the parent
 * dashboard has always displayed. Empty string when nothing is rejected.
 */
export function combinedRejectionReason(c: {
  birthCertificateRejected?: boolean;
  birthCertificateRejectionReason?: string;
  physicalRejected?: boolean;
  physicalRejectionReason?: string;
}): string {
  const parts: string[] = [];
  if (c.birthCertificateRejected) {
    parts.push(`Birth certificate: ${c.birthCertificateRejectionReason?.trim() || 'needs to be re-submitted'}`);
  }
  if (c.physicalRejected) {
    parts.push(`Physical form: ${c.physicalRejectionReason?.trim() || 'needs to be re-submitted'}`);
  }
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Link Requests  (top-level collection: linkRequests/{id})
// ---------------------------------------------------------------------------

/** A co-parent link request. Parent B creates one; Parent A approves or denies. */
export interface LinkRequest {
  id: string;
  playerId: string;
  primaryParentUid: string; // UID of the parent whose subcollection stores the player
  requestingParentUid: string;
  targetParentUids: string[]; // Current parentUids on the player — used for Firestore rules
  status: 'pending' | 'approved' | 'denied';
  playerSnapshot: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
  };
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Divisions  (subcollection or standalone collection depending on sport config)
// ---------------------------------------------------------------------------

/** A competitive division within a season (e.g. T-Ball, Coach Pitch, Kid Pitch). */
export interface Division {
  id: string;
  name: string;
  fee: number;              // Registration fee in cents (e.g. 12500 = $125)
  capacity?: number;        // Max enrolled players; absent = unlimited
  waitlistEnabled?: boolean;
  registeredCount?: number; // Denormalized: +1 on payment/fee-waiver, -1 on refund/delete/reassignment; admin "Recalculate Counts" rebuilds from enrollments
  reservedCount?: number;   // In-flight checkouts that reserved a seat but haven't paid; +1 at Stripe checkout, -1 on payment (→registeredCount) or session expiry. Absent = 0.
  sport?: Sport;
  minAge?: number;          // Minimum league age (inclusive) for this division
  maxAge?: number;          // Maximum league age (inclusive) for this division
}

// ---------------------------------------------------------------------------
// Enrollments  (subcollection: userProfiles/{userId}/enrollments)
// ---------------------------------------------------------------------------

export type EnrollmentPaymentStatus =
  | 'pending_payment'  // Written before Stripe redirect; payment not yet confirmed
  | 'paid'             // Stripe webhook confirmed payment
  | 'waitlisted'       // Division at capacity; player is on the waitlist
  | 'fee_waived';      // Admin manually waived the registration fee

/**
 * An enrollment record written when a parent registers a player for a season.
 * Stored at: userProfiles/{parentUserId}/enrollments/{enrollmentId}
 *
 * Ghost-enrollment note: records with paymentStatus = 'pending_payment' and
 * an empty stripe_payment_id are orphans created when the parent abandoned
 * the Stripe checkout. Surface these in the enrollment page as "resume payment"
 * prompts rather than allowing a second enrollment to be created.
 */
export interface Enrollment {
  id: string;
  playerId: string;
  seasonId: string;
  divisionId: string;
  parentUserId: string;         // Registering (primary) parent — single-valued
  additionalParentUids?: string[]; // Linked co-parents — grants them read access + team resolution
  // Uniform / sizing
  shirtSize: string;
  jerseySize: string;          // Backward-compat alias for shirtSize — keep in sync
  uniformNumberPreference: string;
  // Assigned uniform number. Written by the admin roster CSV import and read by
  // the coach/parent team pages and roll calls. Distinct from
  // footballEquipment.jerseyNumber, which tracks the issued football jersey.
  jerseyNumber?: string;
  // Medical / safety
  emergencyContacts: EmergencyContact[];
  medicalNotes: string;
  // Payment
  paymentStatus: EnrollmentPaymentStatus;
  // Legacy alias present on enrollments created before 2026-06; no longer
  // written. Readers fall back to it: e.paymentStatus ?? e.payment_status
  payment_status?: EnrollmentPaymentStatus;
  stripe_payment_id: string;   // Empty string until Stripe webhook confirms payment
  stripeSessionId?: string;    // Stripe Checkout Session ID — used for orphan reconciliation
  capacityReserved?: boolean;  // True while this enrollment holds a division reservedCount seat (set at checkout, cleared on payment or session expiry)
  fee_waived: boolean;
  waiver_reason: string;
  registrationFeeAmount: number;
  // Volunteer deposit check — football. A family writes a check that the league
  // holds until their volunteer shifts are met, then returns it. Admin-ticked
  // on /admin/registration; absent status means no check has been received.
  volunteerDepositStatus?: 'held' | 'returned';
  volunteerDepositReceivedAt?: string;      // ISO datetime
  volunteerDepositReceivedBy?: string;      // Admin UID
  volunteerDepositReceivedByName?: string;
  volunteerDepositReturnedAt?: string;      // ISO datetime
  volunteerDepositReturnedBy?: string;      // Admin UID
  volunteerDepositReturnedByName?: string;
  // Timestamps
  registered_at: string;       // ISO datetime
  enrollmentDate: string;      // ISO datetime — backward-compat alias for registered_at
  waitlisted_at?: string;      // ISO datetime — set only when paymentStatus = 'waitlisted'
  // Sport scoping — required for collectionGroup queries
  sport?: Sport;
  // Football registration — parent-entered during registration
  parentWeightEstimate?: number; // Parent weight estimate in lbs; verified by admin at weigh-in
  // Football equipment — admin-managed after registration
  footballEquipment?: {
    verifiedWeight?: number;   // Official weigh-in result (lbs)
    // Tag numbers are denormalized from equipmentInventory at issue time so
    // parents (who cannot read equipmentInventory) can see what they hold.
    // Helmet
    helmetSize?: string;
    helmetStatus?: 'not_issued' | 'issued' | 'returned';
    helmetInventoryId?: string;          // equipmentInventory doc ID of assigned item
    helmetTagNumber?: string;
    // Shoulder pads
    shoulderPadSize?: string;
    padStatus?: 'not_issued' | 'issued' | 'returned';
    padInventoryId?: string;             // equipmentInventory doc ID of assigned item
    padTagNumber?: string;
    // Game jersey
    jerseySize?: string;
    jerseyNumber?: string;
    gameJerseyStatus?: 'not_issued' | 'issued' | 'returned';
    gameJerseyInventoryId?: string;      // equipmentInventory doc ID of assigned item
    gameJerseyTagNumber?: string;
    // Scrimmage jersey
    scrimmageJerseyStatus?: 'not_issued' | 'issued' | 'returned';
    scrimmageJerseyInventoryId?: string; // equipmentInventory doc ID of assigned item
    scrimmageJerseyTagNumber?: string;
    // Practice jersey
    practiceJerseyStatus?: 'not_issued' | 'issued' | 'returned';
    practiceJerseyInventoryId?: string;  // equipmentInventory doc ID of assigned item
    practiceJerseyTagNumber?: string;
    // Game pants
    gamePantsSize?: string;
    gamePantsStatus?: 'not_issued' | 'issued' | 'returned';
    gamePantsInventoryId?: string;       // equipmentInventory doc ID of assigned item
    gamePantsTagNumber?: string;
    // Practice pants
    practicePantsSize?: string;
    practicePantsStatus?: 'not_issued' | 'issued' | 'returned';
    practicePantsInventoryId?: string;   // equipmentInventory doc ID of assigned item
    practicePantsTagNumber?: string;
    issuedAt?: string;
  };
  // Admin-assigned jersey number (both sports) — distinct from parent-entered uniformNumberPreference
  assignedJerseyNumber?: string;
  isTest?: boolean; // Marks this enrollment as synthetic seed data; excluded from live roster/payment views
  weightHistory?: { weight: number; date: string; recordedBy: string }[]; // Coach-recorded weigh-ins
  // Guest / anonymous registration status — set to 'incomplete' for anonymous-auth enrollments
  // until the parent claims their account; flipped to 'complete' on account link
  profileStatus?: 'incomplete' | 'complete';
}

// ---------------------------------------------------------------------------
// Calendar Events  (normalized type for the unified calendar view)
// ---------------------------------------------------------------------------

export type CalendarEventType = 'game' | 'practice' | 'concession' | 'closure' | 'event';

/**
 * Generic admin/coach-created calendar event (meetings, picture day, fundraisers, etc.) —
 * anything that isn't a game, practice, or volunteer shift. Stored in the top-level
 * `customEvents` collection. Only `title` and `date` are required.
 */
export interface CustomEvent {
  id: string;
  title: string;
  date: string;          // YYYY-MM-DD
  startTime?: string;    // HH:MM — optional (all-day when omitted)
  endTime?: string;      // HH:MM
  location?: string;
  notes?: string;
  visibility: 'all' | 'team';
  teamId?: string;       // set when visibility === 'team'
  teamName?: string;
  sport: Sport;
  seasonId?: string;
  createdByUid: string;
  createdByName?: string;
  createdAt: string;     // ISO
  status: 'scheduled' | 'cancelled';
}

/**
 * Normalized unified event type consumed by LeagueCalendar.
 * Never stored in Firestore — computed client-side in useMemo from raw Firestore documents
 * using normalizeGame() (for top-level games) or normalizeTeamGame() (for team subcollection games).
 */
export interface CalendarEvent {
  id: string;
  eventType: CalendarEventType;
  date: string;         // YYYY-MM-DD — primary grid placement key
  startTime: string;    // HH:MM
  endTime?: string;     // HH:MM — optional
  title: string;        // pill label
  status: string;       // 'scheduled' | 'cancelled' | 'completed' | 'claimed' | 'active' etc.
  fieldName?: string;
  fieldId?: string;     // Firestore fields/{id} — used to cross-reference closures
  sourceType: 'global-game' | 'team-game' | 'practice-slot' | 'concession-slot' | 'field-closure' | 'complex-closure' | 'custom-event';
  sourceId: string;     // Firestore doc ID
  // Game-specific
  homeTeamName?: string;
  awayTeamName?: string;
  // Baseball games have no single teamId — both teams RSVP into the same game
  // id, so RSVP denominators sum both rosters. Football games/practices use teamId.
  homeTeamId?: string;
  awayTeamId?: string;
  teamId?: string;
  teamName?: string;
  division?: string;
  divisionId?: string;
  notes?: string;
  // Custom-event-specific — creator UID, used to gate the delete affordance
  createdByUid?: string;
  // Concession-specific
  capacity?: number;
  claimedCount?: number;
  isSigned?: boolean;   // Whether the current parent has signed up
  // Parent RSVP
  myRsvpStatus?: 'Attending' | 'Not Attending' | 'Maybe' | null;
  // Umpire (visible to Admin/Board/Coach only — never passed to parent-facing views)
  umpireName?: string;
  umpireNotified?: boolean;
  sport?: Sport;
}

export interface LeagueOfficer {
  id: string;
  title: string;
  name: string | null;
  email: string | null;
  contactHint: string;
  mappedTopic?: import('@/data/inquiry-topics').InquiryTopic;
  order: number;
  sport?: Sport;
  /** Show this role in the public homepage leadership grid (replaces the old hardcoded EXECUTIVE_TITLES check). */
  isExecutive?: boolean;
  /** Web-form inquiry topics that route to this role. The role's email receives those inquiries. */
  handlesTopics?: import('@/data/inquiry-topics').InquiryTopic[];
}

/**
 * Site-Admin-managed inquiry delivery config — singleton doc `systemConfig/inquiries`.
 * Read server-side by sendInquiryNotification (Admin SDK); written only via /api/admin/inquiry-config.
 */
export interface InquiryDeliveryConfig {
  /** CC'd on EVERY inquiry notification, regardless of routing. */
  alwaysCcEmails?: string[];
  /** Ad-hoc recipient emails per topic, per sport — added on top of role routing. */
  topicOverrides?: Partial<Record<Sport, Partial<Record<import('@/data/inquiry-topics').InquiryTopic, string[]>>>>;
  /** Used only when nothing else resolves. `all` applies to every sport. */
  fallbackEmails?: Partial<Record<Sport | 'all', string[]>>;
  updatedAt?: string;
  updatedByName?: string;
  updatedByUid?: string;
}

// ---------------------------------------------------------------------------
// Announcements  (collection: announcements)
// ---------------------------------------------------------------------------

/** A league-wide announcement published by an admin or board member. */
export interface Announcement {
  id: string;
  title: string;
  body: string;
  publishedAt: string; // ISO datetime string
  pinned?: boolean;
  /** When true, surfaces as a dismissible alert banner on parent dashboards. */
  isUrgent?: boolean;
  /** Association-wide (all sports) — when set, `sport` is omitted. */
  isGlobal?: boolean;
  publishedBy?: string;
  sport?: Sport;
  /** ISO datetime of the most recent edit — absent until first edited. */
  updatedAt?: string;
  /** Optional "show until" date (YYYY-MM-DD, inclusive). After this date the
   *  announcement stops displaying everywhere except the admin manage page. */
  expiresAt?: string;
  /** Team-scoped announcement posted by a coach — shown only to that team's
   *  families (league surfaces filter these out client-side). */
  teamId?: string;
  teamName?: string;
  /** UID of the coach who posted a team announcement (rules enforce ownership). */
  createdByUid?: string;
}

/** True when an announcement should still be displayed to non-admin audiences.
 *  `todayISO` is a local YYYY-MM-DD string — `expiresAt` is inclusive. */
export function isAnnouncementActive(a: { expiresAt?: string }, todayISO: string): boolean {
  return !a.expiresAt || a.expiresAt >= todayISO;
}

// ---------------------------------------------------------------------------
// Audit Log  (collection: auditLogs)
// ---------------------------------------------------------------------------

export type AuditAction =
  | 'game.created'
  | 'game.updated'
  | 'game.cancelled'
  | 'game.deleted'
  | 'game.score_recorded';

/** An immutable audit record written on every admin-initiated game mutation. */
export interface AuditLog {
  id: string;
  action: AuditAction;
  adminUid: string;
  targetCollection: string;
  targetDocId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  createdAt: string;
  sport?: Sport;
}
