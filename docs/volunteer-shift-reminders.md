# Volunteer Shift Reminders — Setup & Operations

Parents who signed up for a concession or tagging shift automatically get a
reminder **the day before** their shift: an email plus an in-app notification.

How it works:

1. **The portal has a reminder endpoint** (`/api/reminders`). Each time it is
   called, it finds every active shift happening *tomorrow* and sends the
   reminders. It's safe to call more than once per day — shifts that already
   got reminders are skipped.
2. **Vercel calls that endpoint once a day automatically** via the cron job
   defined in `vercel.json` (daily at 21:00 UTC — 5:00 PM Eastern during
   daylight saving, 4:00 PM in winter).

## One-time setup

### Step 1 — Create the secret

Vercel authenticates its scheduled calls with an environment variable that
**must be named `CRON_SECRET`**. Generate a long random value:

```bash
openssl rand -hex 32
```

### Step 2 — Add it to Vercel

Vercel Dashboard → your project → **Settings → Environment Variables** →
Add: name `CRON_SECRET`, paste the value, environment **Production** → Save.

> ⚠️ Same class of gotcha as the Stripe webhook secret: if `CRON_SECRET` is
> missing in Production, the endpoint answers "Not configured" and no
> reminders go out. A redeploy is needed after adding it.

### Step 3 — Deploy

Commit and push. Vercel picks up `vercel.json`, registers the cron job, and
starts calling the endpoint daily. You can see runs (and trigger a manual one)
under the project's **Settings → Cron Jobs** in the Vercel dashboard.

## Testing it

Send reminders for a specific date (instead of tomorrow):

```bash
curl -X POST https://YOUR_SITE_URL/api/reminders \
  -H "Authorization: Bearer PASTE_SECRET_HERE" \
  -H "Content-Type: application/json" \
  -d '{"date": "2026-09-12"}'
```

The response reports what happened, e.g.
`{"ok":true,"date":"2026-09-12","slotsProcessed":2,"emailsSent":5,"notificationsWritten":5}`.

Running it twice returns `slotsProcessed: 0` the second time — that's the
duplicate protection working, not a failure. To force a re-send for a shift,
delete the `remindersSentAt` field from that shift's document in Firestore.

## What parents receive

- **Email** (via Resend, from `RESEND_FROM_EMAIL`): shift type, date, start and
  end time, and a note to cancel in the portal or contact the board if they
  can't make it. Parents who turned off email notifications in Settings are
  skipped.
- **In-app notification**: same message in their portal inbox; tapping it opens
  the Volunteers page.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Response is `401 Unauthorized` | The secret in the request doesn't match `CRON_SECRET` |
| Response is `500 Not configured` | `CRON_SECRET` isn't set in Production (or wasn't redeployed after adding) |
| `ok: true` but `emailsSent: 0` | No shifts tomorrow, reminders already sent today, or signed-up parents have email notifications turned off |
| Emails not arriving | Check `RESEND_API_KEY` / Resend dashboard for bounces |
| No cron runs listed in Vercel | `vercel.json` not deployed yet, or the plan's cron limit was hit |
