import { NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebase-admin';

/**
 * POST /api/reminders
 *
 * Sends volunteer shift reminders (email + in-app notification) to every
 * parent signed up for a concession/tagging shift happening tomorrow.
 * Designed to be hit once a day by Google Cloud Scheduler — see
 * docs/volunteer-shift-reminders.md for the setup.
 *
 * Auth: Authorization: Bearer <REMINDERS_SECRET>
 * Body (optional): { date?: 'YYYY-MM-DD' }  — override the target date (testing)
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

export async function POST(req: Request) {
  try {
    const secret = process.env.REMINDERS_SECRET;
    if (!secret) {
      console.error('[reminders] REMINDERS_SECRET is not configured');
      return NextResponse.json({ error: 'Not configured' }, { status: 500 });
    }
    const auth = req.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let targetDate = tomorrowEastern();
    try {
      const body = await req.json();
      if (typeof body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
        targetDate = body.date;
      }
    } catch {
      // empty body is fine — use tomorrow
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

    console.log(`[reminders] date=${targetDate} slots=${slotsProcessed} emails=${emailsSent} notifications=${notificationsWritten}`);
    return NextResponse.json({ ok: true, date: targetDate, slotsProcessed, emailsSent, notificationsWritten });
  } catch (error: any) {
    console.error('[reminders] Error:', error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
