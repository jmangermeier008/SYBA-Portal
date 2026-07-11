# Sharpsville Youth Baseball Association — SYBA Portal

The SYBA Portal is the official management platform for the Sharpsville Youth Baseball Association. It handles the full lifecycle of a youth baseball season — player registration and payment, team scheduling, volunteer coordination, compliance tracking, and league communication — across three user-facing roles: parents, coaches, and board administrators.

---

## Quick Start (Testers)

1. Sign up and select the **Admin** role
2. Go to **Admin Dashboard** → click **"Seed POC Data"** — creates a sample Spring 2026 season with teams, coaches, and players
3. Use the role selector to explore each role's dashboard

---

## User Roles

| Role | Access |
|---|---|
| **Parent** | Family dashboard, player enrollment, schedules, RSVP, concession signup |
| **Coach** | Team roster, schedules, practice slots, practice drills, compliance |
| **Board Member** | All league management pages (read + write) |
| **Admin** | Everything Board Members can do, plus user role management |
| **Site Admin** | Full system access |

Users can hold multiple roles simultaneously.

---

## Features

### For Parents

- **Player Enrollment** — Multi-step registration flow: select player → choose division → jersey details → Stripe Checkout payment
- **Resume Payment** — If checkout was abandoned, resume from the dashboard without losing your place
- **RSVP** — Mark your player Attending / Maybe / Not Attending directly on the dashboard or from the Season Schedule calendar
- **Season Schedule Calendar** — Full team calendar with Month/Week view, visible from the parent dashboard
- **Concession Signup** — Browse available volunteer shifts, sign up, and cancel before the cutoff window
- **Family Management** — Add players, upload birth certificates for age verification
- **Announcements** — View pinned league announcements
- **Notifications** — In-app alerts for shift moves, cancellations, and confirmations

### For Coaches

- **Team Schedule** — List or Calendar view (Month/Week) directly from the dashboard; full calendar on the Schedules page
- **Weather/Field Cancellations** — Cancel a game with a reason directly from the calendar event popover
- **Practice Slots** — View pre-allocated time slots for your team; claim or release slots
- **Practice Drills** — Built-in library of practice drills by focus area
- **Team Roster** — Player names, jersey numbers, and parent contact info
- **Compliance** — Upload required state background check (PIAA clearance)
- **Notifications** — Alerts for schedule changes and slot availability

### For Board Members & Admins

- **Dashboard** — Live stats (enrolled players, concession fill rate, upcoming games, field status); tabs: Overview / This Week / Concessions / Calendar
- **Seasons** — Create and archive seasons; set volunteer slot requirements per enrolled family
- **Teams** — Create teams per season/division; assign multiple coaches; view rosters
- **Game Schedule** — Add games and practices; bulk CSV import; List/Calendar toggle; individual game detail records at `/admin/games/[id]`
- **Practice Slots** — Allocate slots to teams; track Available / Claimed / Cancelled status
- **Concessions** — Add volunteer shifts; coverage calendar (Red = no slots, Yellow = partial, Green = covered); click a game date to create a slot; Family Compliance report with CSV export
- **Player Roster** — Bulk CSV import; team assignment; payment tracking
- **Compliance** — Review birth certificate uploads; verify and auto-redact (file deleted after verification); coach PIAA clearance review
- **Roles** — Assign/update user roles; set officer titles (President, Treasurer, etc.)
- **Registration** — Enrollment analytics; fee waiver management; payment status per player
- **Announcements** — Create and pin league-wide announcements
- **Sponsorships** — Track sponsors by tier (Gold/Silver/Bronze/In-Kind); pledge vs. received amounts
- **Board Meetings** — Schedule meetings; RSVP tracking; meeting notes
- **Inquiries** — Manage contact form submissions; reply via email; track Open/In Progress/Resolved status
- **Fields** — Add/edit fields; set availability windows; log maintenance closures
- **Settings** — Officer contacts and email routing by topic

---

## Local Development

### Prerequisites

- Node.js 18+
- Firebase project with Firestore, Auth, and Storage enabled
- Stripe account (for enrollment payment testing)

### Environment Variables

Create `.env.local` in the project root:

```
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
STRIPE_SECRET_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
EMAIL_GENERAL=
EMAIL_REGISTRATION=
EMAIL_SAFETY=
EMAIL_FACILITIES=
EMAIL_UMPIRES=
EMAIL_SPONSORSHIPS=
```

### Commands

```bash
npm install
npm run dev          # Start dev server on http://localhost:9002 (Turbopack)
npm run build        # Production build
npm run typecheck    # TypeScript check (npx tsc --noEmit)
npm run lint         # ESLint
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router, React 19) |
| Database & Auth | Firebase 11 (Firestore, Auth, Storage) |
| Payments | Stripe |
| UI | shadcn/ui (Radix UI) + Tailwind CSS |
| Calendar | Custom LeagueCalendar + react-day-picker 9 |
| Language | TypeScript 5 |

---

## Privacy & Security

- Birth certificates are automatically deleted from Firebase Storage after admin verification
- Role-based access: each role sees only their relevant data
- Parent privacy toggle: choose whether to share contact info with other team families
- Firestore Security Rules enforce all data access patterns server-side

---

© Sharpsville Youth Baseball Association. Sharpsville, PA.
