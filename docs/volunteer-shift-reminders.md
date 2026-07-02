# Volunteer Shift Reminders — Setup & Operations

Parents who signed up for a concession or tagging shift automatically get a
reminder **the day before** their shift: an email plus an in-app notification.

This works in two parts:

1. **The portal has a reminder endpoint** (`POST /api/reminders`). Each time it
   is called, it finds every active shift happening *tomorrow* and sends the
   reminders. It is safe to call more than once per day — shifts that already
   got reminders are skipped.
2. **Google Cloud Scheduler calls that endpoint once a day** (recommended:
   5:00 PM Eastern). This is a one-time setup, described below.

---

## One-time setup

### Step 1 — Create the shared secret

The endpoint is protected by a password (a "secret") so only our scheduler can
trigger it. Generate one long random value, for example by running this in a
terminal:

```bash
openssl rand -hex 32
```

Copy the output — you'll paste it in the next two steps. Treat it like a
password.

### Step 2 — Add the secret to the live site

The production site needs to know the secret as the environment variable
`REMINDERS_SECRET` (same place the Stripe keys live):

```bash
firebase apphosting:secrets:set REMINDERS_SECRET
# paste the value when prompted
```

Then add this to `apphosting.yaml` and deploy:

```yaml
env:
  - variable: REMINDERS_SECRET
    secret: REMINDERS_SECRET
```

> ⚠️ Same gotcha as the Stripe webhook secret: if the variable isn't present in
> the **production** environment, the endpoint returns "Not configured" and no
> reminders go out. Also add `REMINDERS_SECRET` to your local `.env.local` if
> you want to test locally.

### Step 3 — Create the daily Cloud Scheduler job

Run this once (replace `YOUR_PROJECT_ID`, `YOUR_SITE_URL`, and
`PASTE_SECRET_HERE`):

```bash
gcloud scheduler jobs create http volunteer-shift-reminders \
  --project=YOUR_PROJECT_ID \
  --location=us-central1 \
  --schedule="0 17 * * *" \
  --time-zone="America/New_York" \
  --uri="https://YOUR_SITE_URL/api/reminders" \
  --http-method=POST \
  --headers="Authorization=Bearer PASTE_SECRET_HERE,Content-Type=application/json" \
  --message-body="{}"
```

`0 17 * * *` means "every day at 5:00 PM Eastern." Reminders describe shifts
happening the following day.

You can also create/edit the job in the web console: Google Cloud Console →
Cloud Scheduler → Create Job.

---

## Testing it

Send reminders for a specific date (instead of tomorrow) with:

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
| Response is `401 Unauthorized` | The secret in the scheduler job doesn't match `REMINDERS_SECRET` on the site |
| Response is `500 Not configured` | `REMINDERS_SECRET` isn't set in the production environment |
| `ok: true` but `emailsSent: 0` | No shifts tomorrow, reminders already sent today, or signed-up parents have email notifications turned off |
| Emails not arriving | Check `RESEND_API_KEY` / Resend dashboard for bounces |
