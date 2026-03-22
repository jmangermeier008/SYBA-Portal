# SYBA Portal — Feature Reference Guide

This guide covers every feature organized by user role. For technical setup, see `README.md`. For developer architecture details, see `CLAUDE.md`.

---

## Admin & Board Member Features

Admins and Board Members share all league management pages. Navigate from the left sidebar.

### Dashboard (`/admin/dashboard`)

The league command center.

**Stats bar** — Four live counts: total enrolled players, upcoming games this week, open concession slots, active season name.

**Alert chips** — Action-required items surface as color-coded chips (pending clearance reviews, unread inquiries). Click a chip to navigate directly to that section.

**Tabs:**
- **Overview** — Registration breakdown, concession fill rate, recent announcements
- **This Week** — All games and practices in the current 7-day window. Click a game row for a detail popover; click "View full record" to open `/admin/games/[id]`
- **Concessions** — This week's slot fill status by date
- **Calendar** — Full league calendar (Month/Week view). Click any event for details and record navigation.

---

### Seasons (`/admin/seasons`)

Top-level container for all league activity.

**Create a season:**
1. Click "Add Season"
2. Enter name (e.g., "Spring 2026"), start date, end date
3. Set "Volunteer Slots Required" — minimum concession shifts per enrolled family
4. Save

**Set active season:** Toggle the status switch. Only one season can be active at a time. The active season appears in the registration banner on the public home page.

**Archive a season:** Toggle to archived. Historical data is preserved but the season won't appear in the enrollment flow.

---

### Teams (`/admin/teams`)

Teams belong to a season and division.

**Create a team:**
1. Click "Add Team"
2. Select season and division, enter team name
3. Assign coaches from the multi-select dropdown
4. Save

**Manage a team:** Click any team name to open the detail page (`/admin/teams/[teamId]`) with the full roster and game schedule.

---

### Game Schedule (`/admin/games`)

All league games and practices.

**Add a game or practice:**
1. Click "Add Game / Practice"
2. Select type, date, time, and field
3. For games: select home and away teams
4. For practices: select the team
5. Optionally add a concession shift inline (checkbox at the bottom)
6. Save

**Edit a game:** Click the pencil icon. If the date or time changes and linked concession shifts exist, a confirmation dialog shows how many shifts and signed-up volunteers will be affected before saving.

**Cancel a game:** Click the X icon. Linked shifts are cancelled and volunteers are notified.

**Delete a game:** Click the trash icon. Permanently removes the game and all linked concession shifts.

**Bulk CSV import:**
1. Click "Import Schedule" → download the template
2. Fill in: `Date` (YYYY-MM-DD), `Time` (HH:MM 24-hour), `Type` (Game or Practice), `Field` (must match an existing field name exactly)
3. For games: add `HomeTeam` and `AwayTeam`; for practices: add `TeamName`
4. Upload the CSV — validation errors are shown before anything saves
5. Confirm to import all valid rows

**List / Calendar toggle:** Switch between the list view and a full calendar. In calendar view, click an event for a detail popover with a "View full record" link to `/admin/games/[id]`.

**Game detail page (`/admin/games/[id]`):** Displays game type, status badge, date/time, field, division, notes, and linked concession slot fill rates.

---

### Practice Slots (`/admin/practice-slots`)

Time blocks pre-allocated to teams for coaches to claim.

**Allocate a slot:**
1. Click "Add Practice Slot"
2. Select season, team, field, date, start time, end time
3. Save — status is "Available"

**Lifecycle:** Available → Claimed (when a coach claims it) → Cancelled.

---

### Concessions (`/admin/concessions`)

Two tabs: Manage Slots and Family Compliance.

#### Manage Slots

**List view** — Card grid sorted by date. Each card shows: date, shift time, description, volunteer fill count, volunteer names, cancel cutoff.

**Calendar view:** Click "List | Calendar" toggle to switch.
- **Red** = game dates with no slots assigned
- **Yellow** = game dates with slots, not fully staffed
- **Green** = game dates fully covered

Click any game date (colored) to open the Add Slot dialog with that date pre-filled.

**Add a slot:**
1. Click "Add Slot" (or click a game date in calendar view)
2. Enter date, start/end time, capacity, cancel cutoff hours, optional description
3. Save

**Delete a slot:** Trash icon on any slot card.

#### Family Compliance

Shows which families have met their volunteer requirement.

1. Select a season
2. Report loads all enrolled families with their signup counts vs. required slots
3. Status colors: Met (green), Partial (yellow), Not Signed Up (red)
4. Search by name or email
5. Click "Export CSV" to download the full report

---

### Player Roster (`/admin/roster`)

**Bulk import:**
1. Click "Import Roster" → download the template
2. Fill in: `FirstName`, `LastName`, `TeamName` (must match exactly), optional `JerseySize`, `JerseyNumber`
3. Upload → review validation errors → confirm import

**Assign unassigned players:** Players without a team are flagged. Use the team dropdown on each row to assign.

---

### Compliance (`/admin/compliance`)

**Player compliance (birth certificates):**
- Parents upload documents during enrollment
- Click "Verify & Redact" on each upload — confirms age and permanently deletes the file from storage

**Coach compliance (PIAA clearances):**
- Coaches upload documents from their compliance page
- Admins review and mark coaches as "Cleared to Coach"

---

### Roles (`/admin/roles`)

**Assign a role:**
1. Search by email
2. Select roles (users can hold multiple roles simultaneously)
3. Optionally set an officer title (President, Vice President, Treasurer, Secretary, etc.)
4. Save

**Create an account:** Use "Create Account" to generate login credentials for a new coach or board member.

---

### Registration (`/admin/registration`)

Enrollment analytics:
- Totals: enrolled, paid, pending, fee waivers
- Filter by season
- Per-player payment status rows
- Mark fee waivers with a reason
- CSV export

---

### Announcements (`/admin/announcements`)

1. Click "New Announcement"
2. Enter title and body
3. Toggle "Pin" to feature it at the top of the parent feed
4. Save — visible to all users immediately

---

### Sponsorships (`/admin/sponsorships`)

**Add a sponsor:**
1. Click "Add Sponsor"
2. Enter name, tier (Gold/Silver/Bronze/In-Kind), pledge amount, received amount
3. Set status (Active/Pending/Lapsed)
4. Save

---

### Board Meetings (`/admin/board-meetings`)

**Schedule a meeting:**
1. Click "Schedule Meeting"
2. Enter title, date, location, optional agenda
3. Save

**Add minutes:** Open the record after the meeting and enter notes.

---

### Inquiries (`/admin/inquiries`)

All contact form submissions from the public site and user portals.

1. Click an inquiry to open the detail dialog
2. Review message and topic routing
3. Click "Reply" to send an email to the submitter
4. Update status: Open → In Progress → Resolved
5. Filter by status or topic

---

### Fields (`/admin/fields`)

**Add a field:**
1. Click "Add Field"
2. Enter name, optional address, type (Game/Practice/Both)
3. Set availability window (earliest and latest scheduling time)
4. Save

**Log maintenance closure:** Open a field record → "Add Closure" → enter date and reason.

---

### Settings (`/admin/settings`)

**Officer contacts:** Update name and email for each officer role. These populate the public contact directory.

**Email routing:** Set topic-specific email addresses for inquiry routing (General, Registration, Safety, Facilities, Umpires, Sponsorships).

---

## Coach Features

### Dashboard (`/coach/dashboard`)

Four stat cards: My Teams, Roster Size, Next Event, Attendance Rate.

**Team Schedule card:**
- **List view** — Next 5 upcoming games/practices
- **Calendar view** — Toggle to see the full season in Month/Week view; click any event for details

**Quick Actions:** Direct links to Drill Library and Roster Management.

---

### Team Schedules (`/coach/schedules`)

Full season calendar with Month/Week toggle. Toggle Games and Practices independently.

**Event popover:** Date, time, field, opponent (for games), weather cancel option.

**Weather/field cancellation:**
1. Click an event → click "Cancel — Weather/Field"
2. Enter reason → confirm
3. Game status updates and parent notifications are sent

---

### Practice Slots (`/coach/practice-slots`)

Shows slots pre-allocated to your team.

**Claim a slot:** Click "Claim" — your name is attached and status becomes Claimed.

**Release a slot:** Click "Release" to make it available again.

---

### AI Drill Generator (`/coach/drills`)

1. Select age group and skill level
2. Select practice focus (fielding, hitting, baserunning, etc.)
3. Click "Generate Drills"
4. Review the generated plan (drill name, objective, instructions, duration)
5. Print or copy for practice use

---

### Compliance (`/coach/compliance`)

1. Click "Upload Clearance"
2. Select your PIAA background check document (PDF)
3. Submit — status becomes "Pending Review"
4. An admin marks you as "Cleared to Coach"

---

## Parent Features

### Dashboard (`/parent/dashboard`)

**Next Game card:** Upcoming game with countdown, date/time, opponent, RSVP count. Tap Yes / Maybe / No to RSVP.

**Season Schedule:** Full team calendar below the stats section. Month/Week view. Click any game to RSVP from the event popover.

**League Announcements:** Latest pinned announcements. "View all" links to the full announcements page.

**Season Enrollment card:** Shows status — Enrolled (green), Payment Required (amber + Resume Payment button), or Not Enrolled (Enroll Now link).

---

### Enrollment (`/parent/enroll`)

Multi-step flow:
1. **Select player** — choose from your registered players
2. **Select division** — age-based (T-Ball, Coach Pitch, Minors, etc.)
3. **Jersey details** — size and number
4. **Payment** — redirects to Stripe Checkout
5. **Confirmation** — enrollment confirmed at `/parent/enroll/success`

**Resume payment:** If checkout was abandoned, the dashboard shows "Resume Payment" to re-initiate Stripe Checkout for the pending enrollment.

---

### Team Schedules (`/parent/schedules`)

Full family calendar for all enrolled players. Month/Week toggle.

**Export to calendar:** Click the download icon on any event to get an ICS file — imports into Apple Calendar, Google Calendar, or Outlook.

**RSVP from schedule:** Click any game for details and RSVP buttons.

---

### Concessions (`/parent/concessions`)

Browse and manage your volunteer shift signups.

**Sign up:** Click "Sign Up" on any available shift — your name is added and the spot count decreases.

**Cancel a signup:** Cancel before the shift's cutoff window. After the cutoff, contact the league directly.

**Compliance tracking:** Shows slots completed vs. the season requirement.

---

### Family Management (`/parent/family`)

**Add a player:**
1. Click "Add Player"
2. Enter first name, last name, date of birth
3. Save

**Upload birth certificate:**
1. Click a player → upload the document
2. An admin reviews and verifies age, then the file is permanently deleted

---

### Notifications (`/parent/notifications`)

In-app inbox. Alerts for:
- Concession shift moved to a new date/time
- Concession shift cancelled
- Practice slot cancellation

Click any notification to mark it read and navigate to the related record.

---

## Cross-Role Features

### The Calendar

Shared across admin, coach, and parent pages:

- **Month / Week toggle** — top-right toolbar
- **Filter toggles** — show/hide Games, Practices, Concessions independently
- **Event pills** — click to open a detail popover with time, field, teams, and role-specific actions
- **Navigation** — left/right arrows to change month/week; Today button returns to current period

### Notifications

Generated automatically when:
- A concession shift is moved to a new date
- A concession shift is cancelled
- A practice slot is cancelled

Unread count appears as a badge on the bell icon in the sidebar.

---

## CSV Import Formats

### Game Schedule

Required: `Date` (YYYY-MM-DD), `Time` (HH:MM 24-hour), `Type` (Game or Practice), `Field`

For games: `HomeTeam`, `AwayTeam` (must match existing team names exactly)

For practices: `TeamName` (must match an existing team name exactly)

Optional: `Notes`

Download the template from the Import dialog at `/admin/games`.

### Roster

Required: `FirstName`, `LastName`, `TeamName` (must match exactly)

Optional: `JerseySize`, `JerseyNumber`

Download the template from the Import dialog at `/admin/roster`.

---

*Last updated: 2026-03-22*
