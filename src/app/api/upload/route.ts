import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminStorage } from '@/lib/firebase-admin';

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

    // Only the two known upload locations are allowed; compliance uploads must
    // be under the caller's own uid. Blocks path traversal and overwriting
    // arbitrary bucket objects.
    const playerDocPath = /^players\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/;
    const compliancePath = new RegExp(`^compliance/${decoded.uid}/[A-Za-z0-9_.-]+$`);
    if (!playerDocPath.test(path) && !compliancePath.test(path)) {
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
