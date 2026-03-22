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
  volunteerSlotsRequired?: number; // min concession slots required per family
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
}

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------

export type GameStatus = 'scheduled' | 'cancelled' | 'completed' | 'postponed';
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
  status: GameStatus;
  // League games:
  homeTeamId?: string;
  homeTeamName?: string;
  awayTeamId?: string;
  awayTeamName?: string;
  division?: string;
  // Practices (team-specific):
  teamId?: string;
  teamName?: string;
  notes?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt?: string;
}

// ---------------------------------------------------------------------------
// Concession Slots  (collection: concessionSlots)
// ---------------------------------------------------------------------------

export interface ConcessionSignup {
  parentUserId: string;
  displayName: string;
  signedUpAt: string;
}

/** A volunteer concession shift. claimedCount mirrors signups.length — keep in sync via transaction. */
export interface ConcessionSlot {
  id: string;
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
  // --- Legacy signup array ---
  // Existing signup records live here. New signups continue to use this array
  // via transaction. A future migration may move these to a claims subcollection.
  signups: ConcessionSignup[];
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

export type PracticeSlotStatus = 'available' | 'claimed' | 'cancelled';

/** A practice time slot pre-allotted to a team by an admin. Coaches claim available slots. */
export interface PracticeSlot {
  id: string;
  seasonId: string;
  fieldId: string;
  fieldName: string;
  teamId: string;   // Pre-allotted by a Board Member to a specific team
  teamName: string;
  // Null until a coach claims the slot:
  coachId?: string;
  coachName?: string;
  date: string;      // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string;   // HH:MM
  status: PracticeSlotStatus;
  notes?: string;
  createdBy: string;
  createdAt: string;
  claimedAt?: string;
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
  | 'concessionSignupConfirmed'
  | 'concessionSignupCancelled';

export type NotificationRelatedDocType =
  | 'game'
  | 'concessionSlot'
  | 'practiceSlot';

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
}

// ---------------------------------------------------------------------------
// User Profile  (collection: userProfiles)
// ---------------------------------------------------------------------------

export interface NotificationPrefs {
  email: boolean;
  inApp: boolean;
}

/** Firestore user profile (collection: userProfiles). Extends the Firebase Auth user record. */
export interface UserProfile {
  id: string;
  email: string | null;
  displayName: string | null;
  role?: UserRole;    // Legacy single-role field (backward compat)
  roles?: UserRole[]; // Current multi-role field
  // Parents — drives the combined family calendar query:
  enrolledPlayerIds?: string[];
  // Coaches — all teams they are assigned to:
  teamIds?: string[];
  notificationPrefs?: NotificationPrefs;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Players  (subcollection: userProfiles/{userId}/players)
// ---------------------------------------------------------------------------

/** A player profile stored as a subcollection under the parent's userProfile document. */
export interface Player {
  id: string;
  firstName: string;
  lastName: string;
  teamId?: string;
  division?: string;
  seasonId?: string;
  parentIds?: string[]; // Supports two parents per child
  dateOfBirth: string;
  clearanceUrl?: string;
}

// ---------------------------------------------------------------------------
// Calendar Events  (normalized type for the unified calendar view)
// ---------------------------------------------------------------------------

export type CalendarEventType = 'game' | 'practice' | 'concession';

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
  sourceType: 'global-game' | 'team-game' | 'practice-slot' | 'concession-slot';
  sourceId: string;     // Firestore doc ID
  // Game-specific
  homeTeamName?: string;
  awayTeamName?: string;
  teamId?: string;
  teamName?: string;
  division?: string;
  notes?: string;
  // Concession-specific
  capacity?: number;
  claimedCount?: number;
  isSigned?: boolean;   // Whether the current parent has signed up
  // Parent RSVP
  myRsvpStatus?: 'Attending' | 'Not Attending' | 'Maybe' | null;
}
