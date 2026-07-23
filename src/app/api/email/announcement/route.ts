import { NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebase-admin';
import { verifyBearerUid, getCallerProfile, hasAnyRole } from '@/lib/server-auth';
import { SPORT_CONFIG } from '@/config/sports';
import type { Sport } from '@/types/scheduling';

function sportPrefix(sport?: string): string {
  if (sport === 'baseball') return '[SYBA Baseball] ';
  if (sport === 'football') return '[SYFA Football] ';
  return '';
}

/** Max BCC recipients per Resend call (hard cap is 50 including `to`). */
const CHUNK_SIZE = 49;

interface AudienceSpec {
  type: 'all' | 'team' | 'division';
  teamId?: string;
  divisionId?: string;
  seasonId?: string;
}

async function resolveAudienceEmails(
  db: FirebaseFirestore.Firestore,
  opts: { sport?: string; isGlobal?: boolean; audience: AudienceSpec }
): Promise<string[]> {
  const { sport, isGlobal, audience } = opts;
  const emails = new Set<string>();

  if (audience.type === 'all') {
    const usersSnap = await db.collection('userProfiles').get();
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
    return [...emails];
  }

  // Targeted audiences resolve through enrollments → unique parents → profiles
  let enrollSnap: FirebaseFirestore.QuerySnapshot;
  if (audience.type === 'team') {
    enrollSnap = await db.collectionGroup('enrollments').where('teamId', '==', audience.teamId).get();
  } else {
    // No collection-group index exists for divisionId — query the (indexed)
    // seasonId and filter divisionId in memory; season-scoped counts are small.
    enrollSnap = await db.collectionGroup('enrollments').where('seasonId', '==', audience.seasonId).get();
  }
  const parentUids = new Set<string>();
  for (const doc of enrollSnap.docs) {
    const e = doc.data();
    if (audience.type === 'division' && e.divisionId !== audience.divisionId) continue;
    if (e.parentUserId) parentUids.add(e.parentUserId as string);
    for (const uid of (e.additionalParentUids as string[] | undefined) ?? []) parentUids.add(uid);
  }
  if (parentUids.size === 0) return [];

  const profileSnaps = await db.getAll(
    ...[...parentUids].map(uid => db.collection('userProfiles').doc(uid))
  );
  for (const snap of profileSnaps) {
    if (!snap.exists) continue;
    const u = snap.data()!;
    if (!u.email) continue;
    if (u.notificationPrefs?.email === false) continue;
    emails.add(u.email as string);
  }
  return [...emails];
}

/**
 * POST /api/email/announcement
 *
 * Emails an announcement to families with email notifications enabled —
 * either league-wide or targeted to one team or division. Sends in BCC
 * chunks so parent addresses stay private and each chunk counts as one
 * Resend API call.
 *
 * Body: { title, body, sport?, isGlobal?, audience?, dryRun? }
 *   audience: { type: 'all' | 'team' | 'division', teamId?, divisionId?, seasonId? }
 *             (defaults to { type: 'all' }; division requires seasonId)
 *   dryRun:   true returns { audienceSize } without sending — powers the
 *             client's confirm-before-send preview
 * Returns: { sent, audienceSize, failedChunks } (or { audienceSize } for dryRun)
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

    const { title, body, sport, isGlobal, audience: rawAudience, dryRun } = await req.json();
    if (!title || !body) {
      return NextResponse.json({ error: 'Missing title or body' }, { status: 400 });
    }
    const audience: AudienceSpec = rawAudience?.type ? rawAudience : { type: 'all' };
    if (audience.type === 'team' && !audience.teamId) {
      return NextResponse.json({ error: 'Missing teamId for team audience' }, { status: 400 });
    }
    if (audience.type === 'division' && (!audience.divisionId || !audience.seasonId)) {
      return NextResponse.json({ error: 'Missing divisionId or seasonId for division audience' }, { status: 400 });
    }

    const db = getAdminFirestore();
    const recipients = await resolveAudienceEmails(db, { sport, isGlobal, audience });

    if (dryRun) {
      return NextResponse.json({ audienceSize: recipients.length });
    }

    const from = process.env.RESEND_FROM_EMAIL ?? 'SYBA Portal <onboarding@resend.dev>';
    // NEVER address this to our own domain — mail to a syba.blue address
    // re-enters through the Mailgun inbound webhook and becomes inquiries
    // (the 2026-07-09 loop incident). The sending admin gets one receipt
    // copy per chunk instead.
    const receiptTo = caller.email || process.env.INQUIRY_EMAIL_SITE_ADMIN || from;
    // Real parent replies should land at the sport's public contact address,
    // where they become properly routed inquiries (robot replies are filtered
    // by the inbound webhook).
    const replyTo =
      (!isGlobal && (sport === 'baseball' || sport === 'football')
        ? SPORT_CONFIG[sport as Sport]?.contactEmail
        : undefined) ?? 'info@syba.blue';
    const subject = `${sportPrefix(isGlobal ? undefined : sport)}${title}`;
    const text = `${body}\n\n—\nThis announcement was sent by your league through the SYBA Portal. Log in to see full details and manage your family's schedule.`;

    let sent = 0;
    let failedChunks = 0;
    for (let i = 0; i < recipients.length; i += CHUNK_SIZE) {
      const chunk = recipients.slice(i, i + CHUNK_SIZE);
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          // Loop marker — the inbound-email webhook drops portal-sent mail
          headers: { 'X-SYBA-Mailer': 'portal' },
          from,
          to: [receiptTo],
          reply_to: replyTo,
          bcc: chunk,
          subject,
          text,
        }),
      });
      if (res.ok) {
        sent += chunk.length;
      } else {
        failedChunks++;
        console.error('[announcement email] chunk failed:', await res.text());
      }
    }

    return NextResponse.json({ sent, audienceSize: recipients.length, failedChunks });
  } catch (err: any) {
    console.error('announcement email error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
