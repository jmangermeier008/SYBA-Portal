import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminStorage, getAdminFirestore } from '@/lib/firebase-admin';

// True when the caller holds a staff role (Admin / Board Member) in any sport or
// is a Site Admin — those users may upload compliance docs on another user's behalf.
async function isPrivilegedUploader(uid: string): Promise<boolean> {
  try {
    const snap = await getAdminFirestore().doc(`userProfiles/${uid}`).get();
    if (!snap.exists) return false;
    const data = snap.data() ?? {};
    if (data.isSiteAdmin === true) return true;
    const STAFF = ['Admin', 'Board Member'];
    const sportRoles = (data.sportRoles ?? {}) as Record<string, string[]>;
    if (Object.values(sportRoles).some(roles => (roles ?? []).some(r => STAFF.includes(r)))) return true;
    const legacy: string[] = data.roles ?? (data.role ? [data.role] : []);
    return legacy.some(r => STAFF.includes(r));
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const idToken = authHeader.slice(7);
    const decoded = await getAdminAuth().verifyIdToken(idToken);

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const path = formData.get('path') as string | null;

    if (!file || !path) {
      return NextResponse.json({ error: 'Missing file or path' }, { status: 400 });
    }

    // Only the two known upload locations are allowed. Compliance uploads must be
    // under the caller's own uid, EXCEPT staff (Admin/Board/Site Admin) may upload
    // on another user's behalf. Blocks path traversal and overwriting arbitrary
    // bucket objects.
    const playerDocPath = /^players\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/;
    const complianceSelfPath = new RegExp(`^compliance/${decoded.uid}/[A-Za-z0-9_.-]+$`);
    const complianceAnyPath = /^compliance\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/;
    const isPlayerPath = playerDocPath.test(path);
    const isCompliancePath = complianceAnyPath.test(path);
    const isOwnCompliance = complianceSelfPath.test(path);
    if (!isPlayerPath && !isCompliancePath) {
      return NextResponse.json({ error: 'Invalid upload path' }, { status: 400 });
    }
    // Uploading compliance docs for a DIFFERENT uid requires staff privileges.
    if (isCompliancePath && !isOwnCompliance && !(await isPrivilegedUploader(decoded.uid))) {
      return NextResponse.json({ error: 'Invalid upload path' }, { status: 400 });
    }

    const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!ALLOWED.includes(file.type)) {
      return NextResponse.json({ error: 'Invalid file type. Upload a PDF, JPG, or PNG.' }, { status: 400 });
    }
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large. Maximum 5 MB.' }, { status: 400 });
    }

    const bucket = getAdminStorage().bucket();
    const fileRef = bucket.file(path);
    const buffer = Buffer.from(await file.arrayBuffer());
    await fileRef.save(buffer, {
      contentType: file.type,
      metadata: { metadata: { uploadedBy: decoded.uid } },
    });

    const [url] = await fileRef.getSignedUrl({
      action: 'read',
      expires: Date.now() + 10 * 365 * 24 * 60 * 60 * 1000, // 10 years
    });
    return NextResponse.json({ url });
  } catch (err: any) {
    console.error('[upload] error:', err);
    return NextResponse.json({ error: err.message || 'Upload failed' }, { status: 500 });
  }
}
