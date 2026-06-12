import { NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebase-admin';
import { verifyBearerUid, getCallerProfile, hasAnyRole } from '@/lib/server-auth';

function sportPrefix(sport?: string): string {
  if (sport === 'baseball') return '[SYBA Baseball] ';
  if (sport === 'football') return '[SYFA Football] ';
  return '';
}

/**
 * POST /api/email/schedule-change
 *
 * Sends schedule-change notification emails to a list of users.
 * Uses Firebase Admin SDK to look up user emails, then sends via Resend.
 *
 * Body:
 *   type          – 'shiftMoved' | 'shiftCancelled' | 'practiceSlotCancelled'
 *   userIds       – Firebase Auth UIDs of affected users
 *   gameLabel     – Human-readable game name, e.g. "Hawks vs. Bears"
 *   oldDateLabel  – Original date string, e.g. "Apr 5"
 *   newDateLabel  – New date string (shiftMoved only), e.g. "Apr 12"
 */
export async function POST(req: Request) {
  try {
    // Schedule-change emails go to arbitrary user lists with caller-supplied
    // labels — board members and admins only.
    const uid = await verifyBearerUid(req);
    if (!uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const caller = await getCallerProfile(uid);
    if (!hasAnyRole(caller, ['Admin', 'Board Member'])) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { type, userIds, gameLabel, oldDateLabel, newDateLabel, sport } = await req.json();

    if (!type || !Array.isArray(userIds) || userIds.length === 0) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Build subject and body based on notification type
    const prefix = sportPrefix(sport);
    let subject = '';
    let body = '';

    if (type === 'shiftMoved') {
      subject = `${prefix}Your Concession Shift Has Been Rescheduled — ${gameLabel}`;
      body = `Hi,\n\nYour concession shift for ${gameLabel} has been moved from ${oldDateLabel} to ${newDateLabel}.\n\nPlease log in to the SYBA Portal to view the updated details.\n\nThank you for volunteering!`;
    } else if (type === 'shiftCancelled') {
      subject = `${prefix}Concession Shift Cancelled — ${gameLabel}`;
      body = `Hi,\n\nThe concession shift for ${gameLabel} on ${oldDateLabel} has been cancelled because the game was cancelled.\n\nYour volunteer slot has been released. Check the SYBA Portal for other available shifts.\n\nThank you for your willingness to help!`;
    } else if (type === 'practiceSlotCancelled') {
      subject = `${prefix}Practice Slot Cancelled — ${oldDateLabel}`;
      body = `Hi,\n\nYour practice slot at ${gameLabel} on ${oldDateLabel} has been cancelled by the board.\n\nPlease log in to the SYBA Portal to view other available slots.\n\nThank you.`;
    } else {
      return NextResponse.json({ error: 'Unknown notification type' }, { status: 400 });
    }

    // Fetch emails for all affected users via Firebase Admin
    const db = getAdminFirestore();
    const emailPromises = userIds.map(uid =>
      db.doc(`userProfiles/${uid}`).get().then(snap => snap.data()?.email as string | undefined)
    );
    const emails = (await Promise.all(emailPromises)).filter((e): e is string => !!e);

    if (emails.length === 0) {
      return NextResponse.json({ ok: true, sent: 0, note: 'No valid emails found' });
    }

    // Send via Resend
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL ?? 'SYBA Portal <onboarding@resend.dev>',
        to: emails,
        subject,
        text: body,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[schedule-change email] Resend error:', err);
      return NextResponse.json({ ok: false, error: err }, { status: 500 });
    }

    return NextResponse.json({ ok: true, sent: emails.length });
  } catch (error: any) {
    console.error('[schedule-change email] Error:', error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
