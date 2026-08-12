import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminFirestore, getAdminStorage } from '@/lib/firebase-admin';

/**
 * Actually deletes a volunteer. The old client-side path removed only the
 * userProfiles document, leaving the clearances subcollection, every uploaded
 * background check (each behind a 10-year signed URL), and the Auth account —
 * while the confirmation dialog claimed the compliance records were gone.
 * Background-check documents of a deleted volunteer must not stay fetchable
 * for a decade, so this runs with the Admin SDK and removes all of it.
 *
 * Site Admin only — this is the most destructive action in the portal.
 */
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    let decoded;
    try {
      decoded = await getAdminAuth().verifyIdToken(authHeader.slice(7));
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = getAdminFirestore();
    const callerSnap = await db.doc(`userProfiles/${decoded.uid}`).get();
    const caller = callerSnap.data();
    const isSiteAdmin =
      caller?.isSiteAdmin === true || caller?.roles?.includes('Site Admin') === true;
    if (!isSiteAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    const uid = body?.uid;
    if (typeof uid !== 'string' || !/^[A-Za-z0-9_-]+$/.test(uid)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    if (uid === decoded.uid) {
      return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 400 });
    }

    // Profile document plus every subcollection under it (clearances, players,
    // enrollments, pushTokens, …) in one recursive pass.
    await db.recursiveDelete(db.doc(`userProfiles/${uid}`));

    // Uploaded compliance files — deleting the objects invalidates their
    // long-lived signed URLs. Best-effort: a missing prefix is fine.
    const warnings: string[] = [];
    try {
      await getAdminStorage().bucket().deleteFiles({ prefix: `compliance/${uid}/` });
    } catch (err: any) {
      console.error(`[delete-coach] storage cleanup failed for ${uid}:`, err);
      warnings.push('Their uploaded files could not all be removed — contact support if this recurs.');
    }

    // The sign-in itself. A user record that was already gone is success.
    try {
      await getAdminAuth().deleteUser(uid);
    } catch (err: any) {
      if (err?.code !== 'auth/user-not-found') {
        console.error(`[delete-coach] auth cleanup failed for ${uid}:`, err);
        warnings.push('Their sign-in could not be removed; they may still be able to log in.');
      }
    }

    return NextResponse.json({ ok: true, warnings });
  } catch (err: any) {
    console.error('[delete-coach] error:', err);
    return NextResponse.json({ error: err.message || 'Delete failed' }, { status: 500 });
  }
}
