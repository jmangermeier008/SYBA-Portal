import { NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebase-admin';
import { verifyBearerUid, getCallerProfile, hasAnyRole } from '@/lib/server-auth';

function sportPrefix(sport?: string): string {
  if (sport === 'baseball') return '[SYBA Baseball] ';
  if (sport === 'football') return '[SYFA Football] ';
  return '';
}

/** Max BCC recipients per Resend call (hard cap is 50 including `to`). */
const CHUNK_SIZE = 49;

/**
 * POST /api/email/announcement
 *
 * Emails an announcement to every family with email notifications enabled.
 * Sends in BCC chunks so parent addresses stay private and each chunk counts
 * as one Resend API call.
 *
 * Body: { title, body, sport?, isGlobal? }
 * Returns: { sent, audienceSize, failedChunks }
 */
export async function POST(req: Request) {
  try {
    const uid = await verifyBearerUid(req);
    if (!uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const caller = await getCallerProfile(uid);
    if (!hasAnyRole(caller, ['Admin', 'Board Member'])) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { title, body, sport, isGlobal } = await req.json();
    if (!title || !body) {
      return NextResponse.json({ error: 'Missing title or body' }, { status: 400 });
    }

    const db = getAdminFirestore();
    const usersSnap = await db.collection('userProfiles').get();
    const emails = new Set<string>();
    for (const doc of usersSnap.docs) {
      const u = doc.data();
      if (!u.email) continue;
      if (u.notificationPrefs?.email === false) continue;
      // Sport-scoped announcements only go to that sport's members. Profiles
      // predating the sportRoles migration have no map — include those.
      if (!isGlobal && sport) {
        const sportRoles = u.sportRoles as Record<string, string[]> | undefined;
        if (sportRoles && Object.keys(sportRoles).length > 0 && !(sportRoles[sport]?.length)) {
          continue;
        }
      }
      emails.add(u.email as string);
    }

    const audience = [...emails];
    const from = process.env.RESEND_FROM_EMAIL ?? 'SYBA Portal <onboarding@resend.dev>';
    const subject = `${sportPrefix(isGlobal ? undefined : sport)}${title}`;
    const text = `${body}\n\n—\nThis announcement was sent by your league through the SYBA Portal. Log in to see full details and manage your family's schedule.`;

    let sent = 0;
    let failedChunks = 0;
    for (let i = 0; i < audience.length; i += CHUNK_SIZE) {
      const chunk = audience.slice(i, i + CHUNK_SIZE);
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        },
        body: JSON.stringify({ from, to: [from], bcc: chunk, subject, text }),
      });
      if (res.ok) {
        sent += chunk.length;
      } else {
        failedChunks++;
        console.error('[announcement email] chunk failed:', await res.text());
      }
    }

    return NextResponse.json({ sent, audienceSize: audience.length, failedChunks });
  } catch (err: any) {
    console.error('announcement email error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
