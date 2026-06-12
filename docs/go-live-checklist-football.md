# Football Go-Live Checklist

> Written 2026-06-12 as part of the final pre-launch polish pass. Companion to
> the fixes on the `league-form` branch (game-mirror sync, email security,
> manual registration tool).

## 1. One-time setup (do these before launch — no terminal needed)

### 1a. Mailgun webhook signing key (REQUIRED — inbound email stops working without it)

The inbound-email webhook now rejects any request that isn't cryptographically
signed by Mailgun. The app needs the signing key as an environment variable.
**The app is hosted on Vercel** (not Firebase App Hosting), so the variable is
set in the Vercel dashboard.

**Do this BEFORE deploying the new code** — the variable is harmless to the old
code, and having it in place first means inbound email never has an outage.

**Get the key from Mailgun:**
1. Log in at https://app.mailgun.com
2. Click your profile icon (top right) → **API Security** (or **Settings → API Keys**).
3. Copy the **HTTP webhook signing key** — it's a separate entry from the
   Private API key. (Alternate location: **Sending → Webhooks** shows the same
   key at the top of the page.)

**Add it in Vercel:**
1. Log in at https://vercel.com → open the SYBA Portal project.
2. **Settings → Environment Variables → Add New**.
3. Key: `MAILGUN_WEBHOOK_SIGNING_KEY` · Value: paste the key · check **Production**.
4. Save. The next deployment picks it up automatically.

**Verify after the next deploy:** an unsigned POST to
`https://syba.blue/api/webhook/inbound-email` should return **401**. If it
returns **503 "Webhook not configured"**, the variable didn't reach the
deployment — re-check the Vercel setting and redeploy. Then send a real email
to an @syba.blue address and confirm it appears in Admin → Inquiries.

### 1b. Stripe checkout branding
Still assigned to you from the June 9 UX review: upload the league logo and
set the brand color in the Stripe dashboard → Settings → Branding.

## 2. Manual smoke test (~30 minutes)

Use three browser profiles (or one normal + one incognito + one different
browser): **Admin**, **Coach**, **Parent**. All on the football site.

### Scheduling (this exercises the bugs fixed in this pass)
1. **Admin:** create a **home game** with a concession shift attached. Confirm it shows on the admin calendar.
2. **Coach:** confirm the game appears on the coach schedule with the right date, time, and opponent.
3. **Parent:** confirm the game appears; RSVP "Attending"; confirm the dashboard shows it as the next game. If you can test on game day itself, verify the game is still visible in the afternoon (this was the timezone bug).
4. **Admin:** **edit** the game — change the time AND the opponent name. Coach and parent views must show the new values (this was the biggest bug: football edits never reached coach/parent schedules).
5. **Admin:** create an **away game** with a free-text venue ("Farrell Stadium"). Coach/parent must show that venue text.
6. **Admin:** **CSV-import** 2 games + 1 practice. All three must appear for coach and parent (previously imported games were invisible to them). If a team name in the CSV doesn't match exactly, you'll now get a warning telling you those rows won't show on schedules.
7. **Admin:** cancel one game → coach/parent see it crossed out; shift volunteers get a notification.
8. **Admin:** delete one game → it disappears everywhere.

### Concessions
9. **Parent:** sign up for the concession shift; check the counter increments. Cancel it. Then try cancelling a shift that starts within the cutoff window (default 24 h) **from the calendar popover** — it must now be blocked with a clear message.

### Manual registration (new tool)
10. **Admin:** Registrations page → **"Manually Register"** button (top right).
    - Look up a test family by email → register a **new player** → "Paid offline (cash/check)".
    - Repeat with "Fee waived" (+ reason).
    - Verify: both show in the registrations table with the right status, the division count went up by 2, the parent received a confirmation email, and the player appears on the parent's dashboard.
    - Note: the family must already have a portal account — the dialog tells you this if the email isn't found.
11. Clean up the test data with the existing Developer → cleanup tools.

### Payments & inquiries
12. **Parent:** full enrollment through the stepper with Stripe test card `4242 4242 4242 4242` → status flips to paid + confirmation email arrives.
13. Send a real email to one of your @syba.blue inbound addresses → it appears in Admin → Inquiries and the assigned board member gets exactly **one** notification email.
14. Submit the public contact form (logged out) → inquiry appears, one notification email.

## 3. Deferred to post-launch (known gaps, intentionally not built yet)

1. **Creating a brand-new family account from the manual-registration dialog** — for now the family creates a free account first.
2. **Season rollover tooling** (archive a season and copy divisions/teams forward).
3. **Password-reset flow check + Firebase email template branding** — do before baseball season.
4. **One-time cleanup of orphaned RSVPs** from games deleted before this fix (harmless leftovers; a Developer-page tool can purge them later).
5. **Financial ledger report** beyond the existing registrations CSV export (the `paymentEvents` collection already records every payment/refund for this).
6. **Rate limiting on the public contact form** (it's already capped at one email per inquiry).
7. ESLint isn't configured in the repo (`npm run lint` asks an interactive setup question) — harmless, but a developer should set it up sometime.
