# SYBA-Portal — Demo Smoke Test Checklist

## Login & Redirect
- [ ] Log in as a user with role **"Board Member"**. Confirm redirect goes to `/admin/dashboard` (not a 404).
- [ ] Log in as a user with role **"Site Admin"**. Confirm redirect goes to `/admin/dashboard`.
- [ ] Log in as a user with role **"Coach"**. Confirm redirect goes to `/coach/dashboard`.
- [ ] Log in as a user with role **"Parent"**. Confirm redirect goes to `/parent/dashboard`.

## Parent Dashboard
- [ ] Log in as a parent with a team/game assigned.
- [ ] Confirm the "Next Game" card loads with RSVP buttons.
- [ ] Open browser console — no errors.

## Admin Dashboard
- [ ] Navigate to `/admin/dashboard`. Confirm stats cards load.
- [ ] Open browser console — no errors, no rapid re-rendering.
- [ ] Navigate to admin games page. Same checks.

## Calendar
- [ ] Open any page using the Calendar component.
- [ ] Confirm left/right chevron arrows render and are clickable.

## Sidebar
- [ ] Confirm notification badge appears when unread notifications exist.
- [ ] Open browser console — no warnings about state updates during render.
