import { NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebase-admin';

/**
 * GET/POST /api/reminders
 *
 * Daily reminder run, triggered by a Vercel cron job (vercel.json):
 *  1. Volunteer shift reminders (email + in-app) to every parent signed up
 *     for a concession/tagging shift happening tomorrow — see
 *     docs/volunteer-shift-reminders.md for the setup.
 *  2. Game-day reminders for team games happening tomorrow: in-app
 *     notification to every parent on the team, email only to parents who
 *     haven't RSVP'd (keeps email volume inside the Resend free tier).
 *
 * Auth: Authorization: Bearer <CRON_SECRET> — Vercel attaches this header to
 * cron invocations automatically when the CRON_SECRET env var is set.
 * (REMINDERS_SECRET is honored as a fallback name for manual/non-Vercel use.)
 * POST body (optional): { date?: 'YYYY-MM-DD' } — override the target date (testing)
 *
 * Idempotent: each slot is stamped with remindersSentAt after its reminders go
 * out, so re-running the same day is a no-op.
 */

function sportPrefix(sport?: string): string {
  if (sport === 'baseball') return '[SYBA Baseball] ';
  if (sport === 'football') return '[SYFA Football] ';
  return '';
}

/** Tomorrow's date in league-local time (US Eastern), as YYYY-MM-DD. */
function tomorrowEastern(): string {
  const now = new Date();
  const eastern = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  eastern.setDate(eastern.getDate() + 1);
  const y = eastern.getFullYear();
  const m = String(eastern.getMonth() + 1).padStart(2, '0');
  const d = String(eastern.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** "17:30" → "5:30 PM" */
function formatTime(hhmm?: string): string {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h)) return hhmm;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m ?? 0).padStart(2, '0')} ${suffix}`;
}

/** "2026-09-12" → "Saturday, September 12" */
function formatDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`);
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL ?? 'SYBA Portal <onboarding@resend.dev>',
      to: [to],
      subject,
      text,
    }),
  });
  if (!res.ok) {
    console.error('[reminders] Resend error:', await res.text());
  }
  return res.ok;
}

async function runReminders(req: Request) {
  try {
    const secret = process.env.CRON_SECRET ?? process.env.REMINDERS_SECRET;
    if (!secret) {
      console.error('[reminders] CRON_SECRET is not configured');
      return NextResponse.json({ error: 'Not configured' }, { status: 500 });
    }
    const auth = req.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let targetDate = tomorrowEastern();
    if (req.method === 'POST') {
      try {
        const body = await req.json();
        if (typeof body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
          targetDate = body.date;
        }
      } catch {
        // empty body is fine — use tomorrow
      }
    }

    const db = getAdminFirestore();
    // Filter status in code rather than the query so legacy slots without a
    // status field still get reminders.
    const snap = await db.collection('concessionSlots').where('gameDate', '==', targetDate).get();

    let slotsProcessed = 0;
    let emailsSent = 0;
    let notificationsWritten = 0;

    for (const slotDoc of snap.docs) {
      const slot = slotDoc.data();
      if (slot.status === 'cancelled') continue;
      if (slot.remindersSentAt) continue; // already reminded — idempotent re-run
      const signups: Array<{ parentUserId: string }> = slot.signups ?? [];
      if (signups.length === 0) continue;

      const prefix = sportPrefix(slot.sport);
      // Absent type = legacy concession shift (matches VolunteerShiftType docs)
      const SHIFT_LABELS: Record<string, string> = {
        concessions: 'concession', tagging: 'tagging', fundraiser: 'fundraiser',
        chains: 'chain crew', maintenance: 'field maintenance',
      };
      const shiftType = SHIFT_LABELS[slot.type as string] ?? 'concession';
      const when = `${formatDate(targetDate)} from ${formatTime(slot.startTime)} to ${formatTime(slot.endTime)}`;
      const where = slot.title || '';

      // One reminder per family even if they hold multiple spots in the slot
      const parentIds = [...new Set(signups.map(s => s.parentUserId).filter(Boolean))];

      for (const parentId of parentIds) {
        const profileSnap = await db.doc(`userProfiles/${parentId}`).get();
        const profile = profileSnap.data();
        if (!profile) continue;
        const prefs = profile.notificationPrefs ?? {};
        const spots = signups.filter(s => s.parentUserId === parentId).length;
        const spotsNote = spots > 1 ? ` (${spots} spots)` : '';

        if (prefs.inApp !== false) {
          await db.collection('notifications').doc().set({
            userId: parentId,
            type: 'concessionShiftReminder',
            title: 'Volunteer Shift Tomorrow',
            body: `Reminder: you're signed up for a ${shiftType} shift${spotsNote} ${when}${where ? ` (${where})` : ''}. Thank you for volunteering!`,
            relatedDocId: slotDoc.id,
            relatedDocType: 'concessionSlot',
            read: false,
            createdAt: Timestamp.now(),
            ...(slot.sport ? { sport: slot.sport } : {}),
          });
          notificationsWritten++;
        }

        if (prefs.email !== false && profile.email) {
          const ok = await sendEmail(
            profile.email,
            `${prefix}Reminder: Your Volunteer Shift Tomorrow`,
            `Hi ${profile.displayName ?? ''},\n\nThis is a reminder that you're signed up for a ${shiftType} shift${spotsNote} ${when}${where ? ` (${where})` : ''}.\n\nIf you can no longer make it, please cancel your spot in the portal or contact the board as soon as possible so the shift can be covered.\n\nThank you for volunteering!`
          );
          if (ok) emailsSent++;
        }
      }

      await slotDoc.ref.update({ remindersSentAt: new Date().toISOString() });
      slotsProcessed++;
    }

    // ── Game-day reminders ──────────────────────────────────────────────────
    // In-app to every parent on the team; email only to parents whose player
    // hasn't RSVP'd yet. Emails across the whole run are budgeted so a busy
    // Saturday can't blow through the Resend free-tier daily cap.
    const EMAIL_BUDGET = 90;
    let gamesProcessed = 0;
    let gameEmailsSent = 0;
    let gameEmailsSkipped = 0;

    const seasonsSnap = await db.collection('seasons').get();
    const activeSeasons = new Map<string, any>();
    for (const s of seasonsSnap.docs) {
      const data = s.data();
      if (data.isActive === true || data.status === 'active') activeSeasons.set(s.id, data);
    }

    const teamsSnap = await db.collection('teams').get();
    const activeTeams = teamsSnap.docs.filter(t => activeSeasons.has(t.data().seasonId));

    // Parent profiles repeat across games/teams — cache reads.
    const profileCache = new Map<string, any>();
    const getProfile = async (userId: string) => {
      if (!profileCache.has(userId)) {
        const snap = await db.doc(`userProfiles/${userId}`).get();
        profileCache.set(userId, snap.data() ?? null);
      }
      return profileCache.get(userId);
    };

    for (const teamDoc of activeTeams) {
      const team = teamDoc.data();
      // Naive-local dateTime strings sort lexicographically, so a string range
      // selects tomorrow's games without any timezone conversion.
      const gamesSnap = await db
        .collection('teams').doc(teamDoc.id).collection('games')
        .where('dateTime', '>=', `${targetDate}T00:00:00`)
        .where('dateTime', '<=', `${targetDate}T23:59:59`)
        .get();

      for (const gameDoc of gamesSnap.docs) {
        const game = gameDoc.data();
        if (game.type !== 'Game' || game.cancelled === true) continue;
        if (game.gameReminderSentAt) continue; // idempotent re-run

        const [enrollSnap, rsvpSnap] = await Promise.all([
          db.collectionGroup('enrollments').where('teamId', '==', teamDoc.id).get(),
          gameDoc.ref.collection('rsvps').get(),
        ]);
        const respondedPlayerIds = new Set(rsvpSnap.docs.map(r => r.data().playerId));

        // parent → do any of their players on this team still need to RSVP?
        const parentNeedsRsvp = new Map<string, boolean>();
        for (const e of enrollSnap.docs) {
          const { parentUserId, playerId } = e.data();
          if (!parentUserId) continue;
          const needs = !respondedPlayerIds.has(playerId);
          parentNeedsRsvp.set(parentUserId, (parentNeedsRsvp.get(parentUserId) ?? false) || needs);
        }
        if (parentNeedsRsvp.size === 0) continue;

        const sport = team.sport ?? activeSeasons.get(team.seasonId)?.sport;
        const prefix = sportPrefix(sport);
        const gameLabel = game.opponentName ? `vs ${game.opponentName}` : 'game';
        const time = formatTime((game.dateTime as string).slice(11, 16));
        const when = `tomorrow, ${formatDate(targetDate)}, at ${time}`;
        const whereNote = game.location ? ` at ${game.location}` : '';

        for (const [parentId, needsRsvp] of parentNeedsRsvp) {
          const profile = await getProfile(parentId);
          if (!profile) continue;
          const prefs = profile.notificationPrefs ?? {};

          if (prefs.inApp !== false) {
            await db.collection('notifications').doc().set({
              userId: parentId,
              type: 'gameReminder',
              title: 'Game Tomorrow',
              body: `${team.name ?? 'Your team'} plays ${gameLabel} ${when}${whereNote}.${needsRsvp ? ' Please RSVP so your coach can plan.' : ''}`,
              relatedDocId: gameDoc.id,
              relatedDocType: 'game',
              read: false,
              createdAt: Timestamp.now(),
              ...(sport ? { sport } : {}),
            });
            notificationsWritten++;
          }

          if (needsRsvp && prefs.email !== false && profile.email) {
            if (emailsSent + gameEmailsSent >= EMAIL_BUDGET) {
              gameEmailsSkipped++;
              continue;
            }
            const ok = await sendEmail(
              profile.email,
              `${prefix}Game Tomorrow — Please RSVP`,
              `Hi ${profile.displayName ?? ''},\n\n${team.name ?? 'Your team'} plays ${gameLabel} ${when}${whereNote}.\n\nYou haven't RSVP'd yet — please log in to the portal and let your coach know if your player will be there.\n\nSee you at the field!`
            );
            if (ok) gameEmailsSent++;
          }
        }

        await gameDoc.ref.update({ gameReminderSentAt: new Date().toISOString() });
        gamesProcessed++;
      }
    }

    if (gameEmailsSkipped > 0) {
      console.warn(`[reminders] email budget reached — skipped ${gameEmailsSkipped} game-reminder emails (in-app still sent)`);
    }
    console.log(`[reminders] date=${targetDate} slots=${slotsProcessed} games=${gamesProcessed} emails=${emailsSent + gameEmailsSent} notifications=${notificationsWritten}`);
    return NextResponse.json({
      ok: true,
      date: targetDate,
      slotsProcessed,
      gamesProcessed,
      emailsSent,
      gameEmailsSent,
      gameEmailsSkipped,
      notificationsWritten,
    });
  } catch (error: any) {
    console.error('[reminders] Error:', error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

// Vercel cron invokes with GET; POST is kept for manual runs and testing.
export async function GET(req: Request) {
  return runReminders(req);
}

export async function POST(req: Request) {
  return runReminders(req);
}
