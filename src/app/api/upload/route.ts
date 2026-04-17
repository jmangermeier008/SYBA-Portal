import { NextRequest, NextResponse } from 'next/server';
import { getStorage } from 'firebase-admin/storage';
import { getAdminAuth } from '@/lib/firebase-admin';
import { initializeApp, getApps, cert } from 'firebase-admin/app';

function getAdminApp() {
  if (getApps().length > 0) return getApps()[0];
  const key = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!key) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY is not set');
  return initializeApp({ credential: cert(JSON.parse(key)), storageBucket: 'syba-bucket' });
}

export async function POST(req: NextRequest) {
  try {
    // Verify the caller is authenticated
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const idToken = authHeader.slice(7);
    const auth = getAdminAuth();
    await auth.verifyIdToken(idToken);

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const path = formData.get('path') as string | null;

    if (!file || !path) {
      return NextResponse.json({ error: 'Missing file or path' }, { status: 400 });
    }

    const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!ALLOWED.includes(file.type)) {
      return NextResponse.json({ error: 'Invalid file type. Upload a PDF, JPG, or PNG.' }, { status: 400 });
    }
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large. Maximum 5 MB.' }, { status: 400 });
    }

    const app = getAdminApp();
    const bucket = getStorage(app).bucket();
    const fileRef = bucket.file(path);

    const buffer = Buffer.from(await file.arrayBuffer());
    await fileRef.save(buffer, { contentType: file.type });
    await fileRef.makePublic();

    const url = `https://storage.googleapis.com/syba-bucket/${encodeURIComponent(path).replace(/%2F/g, '/')}`;
    return NextResponse.json({ url });
  } catch (err: any) {
    console.error('[upload] error:', err);
    return NextResponse.json({ error: err.message || 'Upload failed' }, { status: 500 });
  }
}
