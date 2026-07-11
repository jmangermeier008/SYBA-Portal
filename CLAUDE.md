# SYBA Portal — Developer Reference

## Project Overview

Full-stack youth baseball league management portal for Sharpsville Youth Baseball Association. Built on Next.js 15 App Router + Firebase + Stripe.

**Dev server:** `npm run dev` → http://localhost:9002

---

## Tech Stack

| | |
|---|---|
| Framework | Next.js 15.5 (App Router, React 19, TypeScript 5) |
| Database | Firebase Firestore (real-time, rules-enforced) |
| Auth | Firebase Authentication (email/password) |
| Storage | Firebase Storage (clearance document uploads) |
| Payments | Stripe Checkout (enrollment registration fees) |
| UI | shadcn/ui (Radix UI) + Tailwind CSS 3 |
| Calendar | Custom LeagueCalendar + react-day-picker 9 |
| Icons | lucide-react |

---

## Directory Structure

```
src/
├── app/
│   ├── (auth)/               Login/signup pages (route group — no sidebar)
│   ├── admin/                Board Member + Admin pages (20+ routes)
│   ├── coach/                Coach pages (9 routes)
│   ├── parent/               Parent pages (12 routes)
│   ├── api/                  API routes (Stripe webhook, email, inbound webhook)
│   ├── page.tsx              Public home page (login/signup + active season banner)
│   └── globals.css           Global styles + collapsible sidebar CSS variables
├── components/
│   ├── calendar/
│   │   └── LeagueCalendar.tsx  Unified calendar — games, practices, concessions
│   ├── navigation/
│   │   └── sidebar.tsx         Role-aware collapsible sidebar
│   ├── inquiries/              Inquiry form + detail dialog components
│   ├── notifications/          Notification inbox component
│   ├── ui/                     shadcn/ui Radix wrappers (35 files)
│   └── FirebaseErrorListener.tsx  Global Firestore permission error boundary
├── data/                     Static data (officers list, inquiry topic config)
├── firebase/
│   ├── auth/use-user.tsx     useUser() — auth state + profile + role booleans
│   ├── firestore/
│   │   ├── use-collection.tsx  useCollection<T>() real-time subscription hook
│   │   └── use-doc.tsx         useDoc<T>() real-time document hook
│   ├── provider.tsx          FirebaseProvider context + useMemoFirebase()
│   ├── config.ts             Firebase client config (reads NEXT_PUBLIC_ env vars)
│   └── index.ts              Re-exports all hooks + initializeFirebase()
├── hooks/
│   ├── use-mobile.tsx        Responsive breakpoint detection
│   └── use-toast.ts          Toast notification system
├── lib/
│   ├── csv-import.ts         CSV parse/validate utilities for games + roster bulk import
│   ├── ics.ts                ICS calendar file generator for event export
│   ├── utils.ts              cn() — Tailwind class merger (clsx + tailwind-merge)
│   └── firebase-admin.ts     Firebase Admin SDK for server-side API routes
└── types/
    └── scheduling.ts         Canonical TypeScript types for all Firestore collections
```

---

## Firestore Collections

### Top-Level Collections

**`userProfiles/{userId}`**
- `email`, `displayName`
- `roles: UserRole[]` — multi-role array (current field)
- `role: UserRole` — legacy single-role (backward compat, still read)
- `teamIds: string[]` — coach's assigned teams
- `enrolledPlayerIds: string[]` — parent's enrolled players
- `notificationPrefs: { email: boolean, inApp: boolean }`

**`userProfiles/{userId}/players/{playerId}`** (subcollection)
- `firstName`, `lastName`, `dateOfBirth`
- `teamId`, `division`, `seasonId`
- `parentIds: string[]` — supports two parents per child
- `clearanceUrl` — Firebase Storage path (deleted after admin verification)

**`userProfiles/{userId}/enrollments/{id}`** (subcollection — directly under the user, NOT under players)
- `playerId`, `seasonId`, `teamId`, `divisionId`, `parentUserId`
- `paymentStatus: 'pending_payment' | 'paid' | 'waitlisted' | 'fee_waived' | 'refunded'`
- `stripe_payment_id` — truthy once settled; `offline_<id>` for admin manual registrations, `no_charge_<id>` for $0 carts
- `registrationFeeAmount: number` (cents)
- `manualRegistration: true` + `registeredByAdminUid` — set by the admin Manually Register dialog

**`seasons/{seasonId}`**
- `name`, `status: 'active' | 'archived'`
- `startDate`, `endDate` (YYYY-MM-DD)
- `volunteerSlotsRequired` — minimum concession shifts per family this season

**`teams/{teamId}`**
- `name`, `seasonId`, `divisionId`
- `coachIds: string[]` — multi-coach support
- `coach_uid` — legacy single-coach field (backward compat)
- **Football:** teams are auto-created when a division is created (`src/app/admin/divisions/page.tsx` line ~102). One team per division, named identically to the division (e.g. division `Sharpsville Pee Wees` → team `Sharpsville Pee Wees`). Do not create football teams manually.

**`teams/{teamId}/games/{gameId}`** (subcollection — team-specific)
> **IMPORTANT:** Different shape from top-level `games` collection — see Two Game Data Models below.
- `dateTime: string` — combined **naive local** datetime, NO `Z` suffix (e.g. `"2026-05-01T18:00:00"`). Anything compared against it must also be naive local — never `new Date().toISOString()` (UTC), which is hours off.
- `type: 'Game' | 'Practice'` (capitalized, unlike top-level)
- `opponentName`, `location`, `fieldId`
- `locationType?: 'home' | 'away'` — football only
- `cancelled: boolean`, `cancellationReason: string`

**`teams/{teamId}/games/{gameId}/rsvps/{rsvpId}`** (subcollection)
- `rsvpId` format: `{playerId}_{gameId}`
- `status: 'Attending' | 'Not Attending' | 'Maybe'`
- `playerId`, `parentUserId`, `gameId`, `teamId`

**`games/{gameId}`** (top-level — admin/league-wide)
> **IMPORTANT:** Different shape from team subcollection — see Two Game Data Models below.
- `type: 'game' | 'practice'` (lowercase)
- `date: string` (YYYY-MM-DD) — separate from `time`
- `time: string` (HH:MM 24-hour) — separate from `date`
- `fieldId`, `fieldName`
- `status: 'scheduled' | 'cancelled' | 'completed' | 'postponed'`
- For baseball games: `homeTeamId`, `homeTeamName`, `awayTeamId`, `awayTeamName`, `division`
- For football games: `teamId`, `teamName` (SYBA team), `opponentName` (external school — free text), `locationType: 'home' | 'away'`; away games store venue in `fieldName`, `fieldId` is `''`
- For practices: `teamId`, `teamName`

**`fields/{fieldId}`**
- `name`, `address`, `type: 'game' | 'practice' | 'both'`
- `isActive: boolean`
- `availabilityStart`, `availabilityEnd` (HH:MM)
- `maintenanceClosures: Array<{ date: string, reason?: string }>`

**`concessionSlots/{slotId}`**
- `gameDate: string` (YYYY-MM-DD), `startTime`, `endTime` (HH:MM)
- `capacity: number`, `claimedCount: number` — always keep in sync via Firestore transaction
- `cancelCutoffHours: number`
- `signups: ConcessionSignup[]`
- `gameId` — optional link to a `games` document
- `status: 'active' | 'cancelled'`

**`practiceSlots/{slotId}`**
- `teamId`, `teamName` — pre-allotted by admin
- `coachId`, `coachName` — populated when a coach claims the slot
- `date`, `startTime`, `endTime`, `fieldId`, `fieldName`
- `status: 'available' | 'claimed' | 'cancelled'`

**`announcements/{id}`** — `title`, `body`, `publishedAt`, `pinned: boolean`

**`notifications/{id}`** — `userId`, `type: NotificationType`, `title`, `body`, `read: boolean`, `createdAt`, `relatedDocId`, `relatedDocType`

**`inquiries/{id}`** — `topic`, `name`, `email`, `message`, `status: 'open' | 'in_progress' | 'resolved'`

**`sponsorships/{id}`** — `name`, `tier: 'Gold' | 'Silver' | 'Bronze' | 'In-Kind'`, `pledgeAmount`, `receivedAmount`, `status`

**`boardMeetings/{id}`** — `title`, `date`, `location`, `agenda`, `notes`, `rsvps[]`

---

## Two Game Data Models

This is the most critical architectural distinction in the codebase:

| | `games/{id}` (top-level) | `teams/{teamId}/games/{id}` (subcollection) |
|---|---|---|
| Used by | Admin pages, league-wide calendar | Coach pages, parent pages |
| Date | `date: "YYYY-MM-DD"` + `time: "HH:MM"` (separate fields) | `dateTime: "2026-05-01T18:00:00"` (single naive-local string, no Z) |
| Type values | `'game'` / `'practice'` (lowercase) | `'Game'` / `'Practice'` (capitalized) |
| Normalizer | `normalizeGame(g)` | `normalizeTeamGame(g, teamId)` |

Always use the right collection. Admin pages write and read `games/{id}`. Coach and parent pages query `teams/{teamId}/games`.

### Football vs Baseball game shape

Baseball games use `homeTeamId`/`awayTeamId` (both internal teams). Football games use a different shape because opponents are external schools never stored in the database:

| Field | Baseball game | Football game |
|---|---|---|
| Our team(s) | `homeTeamId` + `awayTeamId` | `teamId` (SYBA team only) |
| Opponent | `awayTeamName` (internal) | `opponentName` (free text, e.g. `"Farrell Steelers"`) |
| Location | `fieldId` + `fieldName` (always) | Home: `fieldId` + `fieldName`; Away: `fieldId: ''`, `fieldName` = venue text |
| `locationType` | not set | `'home'` or `'away'` |

Football games only mirror to **one** team subcollection (the SYBA team). Baseball games mirror to two (home + away).

---

## Role System

Roles are split across two hooks. `useUser()` (`src/firebase/auth/use-user.tsx`) owns
auth/profile state plus the cross-sport `isSiteAdmin` flag. The **per-sport** role booleans
(`isAdmin`, `isBoardMember`, `isCoach`, `isParent`) live in `useSport()`
(`src/firebase/sport-context.tsx`) because they depend on the active sport and honor the
sandbox-role override. Read the per-sport booleans from `useSport()`, not `useUser()`.

```ts
// Auth state + cross-sport superuser flag
const {
  user,        // FirebaseUser | null
  profile,     // UserProfile | null
  loading,     // boolean
  isSiteAdmin, // authoritative cross-sport superuser flag (with legacy fallback)
} = useUser();

// Per-sport role booleans (scoped to the active sport)
const {
  activeSport,
  isAdmin,       // 'Admin' for the active sport
  isSiteAdmin,   // also re-exposed here for convenience
  isBoardMember, // 'Board Member' (Admins included)
  isCoach,       // 'Coach'
  isParent,      // every authenticated user is a baseline parent
} = useSport();
```

Users can hold multiple roles simultaneously. Check the appropriate boolean before rendering role-specific content. All pages begin with `if (loadingUser) return <spinner>` followed by a role guard.

---

## Key Architectural Patterns

### 1. useMemoFirebase() — Required for all Firestore queries

`useCollection` and `useDoc` enforce that queries are memoized. Passing a new query object on every render causes an infinite subscription loop and a runtime error.

```ts
// CORRECT — useMemoFirebase wraps useMemo and stamps __memo: true
const q = useMemoFirebase(() => {
  if (!db || !userId) return null;
  return collection(db, 'userProfiles', userId, 'players');
}, [db, userId]);
const { data } = useCollection(q);

// WRONG — creates a new query object on every render
const q = db ? collection(db, 'userProfiles', userId, 'players') : null;
```

Return `null` when dependencies aren't ready — `useCollection` safely skips subscription on null.

### 2. useCollection<T> and useDoc<T>

```ts
const { data, isLoading } = useCollection<MyType>(memoizedQuery);
// data: MyType[] with .id auto-injected from Firestore document ID
// isLoading: true until first snapshot arrives

const { data } = useDoc<MyType>(memoizedDocRef);
// data: MyType | null
```

Permission-denied errors surface via `errorEmitter` and are displayed by `FirebaseErrorListener`.

### 3. Hook placement — Rules of Hooks

**All hooks must be called before any early return.** This is React's Rules of Hooks. The component structure must be:

```tsx
export default function MyPage() {
  // 1. ALL hooks here (useState, useMemo, useMemoFirebase, useCollection, useRouter, etc.)
  const [state, setState] = useState(...);
  const query = useMemoFirebase(...);
  const { data } = useCollection(query);
  const derived = useMemo(...);  // ← must be here, NOT after guards

  // 2. Guards AFTER all hooks
  if (loadingUser) return <Spinner />;
  if (!isAdmin) return <AccessDenied />;

  // 3. JSX render
  return ( ... );
}
```

### 4. CalendarEvent — Unified Type

All calendar views consume `CalendarEvent[]` (defined in `src/types/scheduling.ts`). Normalize raw Firestore data before passing to `LeagueCalendar`:

```ts
// Admin games (top-level collection — separate date + time)
function normalizeGame(g: Game): CalendarEvent {
  return {
    id: g.id,
    eventType: g.type === 'game' ? 'game' : 'practice',
    date: g.date,
    startTime: g.time,
    title: g.homeTeamName ? `${g.homeTeamName} vs. ${g.awayTeamName}` : `${g.teamName} Practice`,
    status: g.status ?? 'scheduled',
    fieldName: g.fieldName,
    sourceType: 'global-game',
    sourceId: g.id,
  };
}

// Team games (subcollection — combined dateTime ISO string)
function normalizeTeamGame(g: GameEvent, teamId: string): CalendarEvent {
  const dateTime = g.dateTime ?? '';
  return {
    id: g.id,
    eventType: g.type === 'Game' ? 'game' : 'practice',
    date: dateTime.slice(0, 10),
    startTime: dateTime.slice(11, 16),
    title: g.type === 'Game' ? `vs ${g.opponentName || 'TBD'}` : 'Team Practice',
    status: g.cancelled ? 'cancelled' : 'scheduled',
    fieldName: g.location,
    sourceType: 'team-game',
    sourceId: g.id,
    teamId,
  };
}
```

### 5. LeagueCalendar Props (src/components/calendar/LeagueCalendar.tsx)

Key props by role:
- `onViewRecord` — Admin/Board: navigates to game detail record from popover
- `onRsvp` — Parent: RSVP buttons in game event popovers
- `onWeatherCancel` — Coach: cancel game with reason from popover
- `visibleFilters` — limit which filter checkboxes appear (e.g. `['games', 'practices']`)

---

## Environment Variables

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` + 5 more | Firebase client SDK |
| `NEXT_PUBLIC_FIREBASE_VAPID_KEY` | Web Push certificate public key (Firebase Console → Cloud Messaging) — without it the push Enable button reports "not configured" |
| `NEXT_PUBLIC_BASE_URL` | Canonical site origin — Stripe redirects, inquiry-reply links, push click-through links (falls back to `https://sharpsvilleyouthsports.com`) |
| `FIREBASE_ADMIN_*` | Firebase Admin SDK (server API routes) |
| `STRIPE_SECRET_KEY` | Stripe server-side |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe client-side |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature verification |
| `RESEND_API_KEY` | Resend — all outbound email (confirmations, inquiry notifications, schedule changes) |
| `RESEND_FROM_EMAIL` | Outbound From address (falls back to `onboarding@resend.dev`) |
| `INQUIRY_NOTIFICATION_EMAIL` | Fallback recipient when no officer matches an inquiry's assigned role |
| `INQUIRY_EMAIL_SITE_ADMIN` | Always-CC address for inquiry notifications |
| `MAILGUN_WEBHOOK_SIGNING_KEY` | Verifies inbound-email webhook signatures — required or all inbound mail is rejected |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | Firebase Admin SDK credentials (server API routes) |

---

## Development Commands

```bash
npm run dev              # Dev server at http://localhost:9002 (Turbopack)
npm run build            # Production build
npm run typecheck        # npx tsc --noEmit --skipLibCheck
npm run lint             # Next.js ESLint
```
