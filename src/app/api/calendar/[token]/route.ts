import { NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebase-admin';
import { buildCalendarFeed, type FeedEvent } from '@/lib/ics-feed';

/**
 * GET /api/calendar/{token}
 *
 * Live iCalendar feed for one family: every game and practice for every team
 * their players are enrolled on (plus teams they coach). Calendar apps poll
 * this URL directly, so the unguessable token is the only credential — a miss
 * returns a generic 404 with no user enumeration.
 *
 * The Cache-Control header is load-bearing: Vercel's CDN absorbs the frequent
 * polling that Apple/Google calendar agents do, keeping Firestore reads low.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    if (!token || !/^[a-f0-9]{64}$/.test(token)) {
      return new NextResponse('Not found', { status: 404 });
    }

    const db = getAdminFirestore();
    const tokenSnap = await db.collection('calendarTokens').doc(token).get();
    if (!tokenSnap.exists) {
      return new NextResponse('Not found', { status: 404 });
    }
    const userId = tokenSnap.data()!.userId as string;

    const [profileSnap, enrollmentsSnap] = await Promise.all([
      db.collection('userProfiles').doc(userId).get(),
      db.collectionGroup('enrollments').where('parentUserId', '==', userId).get(),
    ]);
    const profile = profileSnap.data() ?? {};

    // Family teams from enrollments, plus coached teams from the profile.
    const teamIds = new Set<string>();
    for (const doc of enrollmentsSnap.docs) {
      const teamId = doc.data().teamId;
      if (teamId) teamIds.add(teamId);
    }
    for (const teamId of (profile.teamIds ?? []) as string[]) {
      if (teamId) teamIds.add(teamId);
    }

    const events: FeedEvent[] = [];
    await Promise.all(
      [...teamIds].map(async teamId => {
        const [teamSnap, gamesSnap] = await Promise.all([
          db.collection('teams').doc(teamId).get(),
          db.collection('teams').doc(teamId).collection('games').get(),
        ]);
        if (!teamSnap.exists) return;
        const teamName = (teamSnap.data()!.name as string) ?? 'SYBA Team';
        for (const gameDoc of gamesSnap.docs) {
          const g = gameDoc.data();
          if (!g.dateTime) continue;
          events.push({
            teamId,
            gameId: gameDoc.id,
            teamName,
            type: g.type === 'Game' ? 'Game' : 'Practice',
            dateTime: g.dateTime,
            opponentName: g.opponentName,
            location: g.location,
            cancelled: g.cancelled === true,
            cancellationReason: g.cancellationReason,
          });
        }
      })
    );

    const calendarName = profile.displayName
      ? `SYBA — ${profile.displayName}'s Family`
      : 'SYBA Schedule';
    const ics = buildCalendarFeed(events, calendarName);

    return new NextResponse(ics, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    });
  } catch (err: any) {
    console.error('calendar feed error:', err);
    return new NextResponse('Internal error', { status: 500 });
  }
}
