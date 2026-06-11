import { doc, updateDoc, type Firestore } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import type { PlayerDocType } from '@/lib/document-packet';

const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Admin upload/replace of a player's birth certificate or physical form.
 * Uploads through /api/upload (same pipeline parents use), then points the
 * player doc at the new file and resets its verification to pending — a
 * replaced document always goes back through the verify flow, mirroring the
 * parent re-upload on the dashboard.
 *
 * Throws with a user-friendly message on any failure; callers toast.
 */
export async function uploadPlayerDocument(opts: {
  user: User;
  db: Firestore;
  refPath: string; // userProfiles/{parentUid}/players/{playerId}
  docType: PlayerDocType;
  file: File;
}): Promise<{ url: string }> {
  const { user, db, refPath, docType, file } = opts;

  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Invalid file type. Upload a PDF, JPG, or PNG.');
  }
  if (file.size > MAX_BYTES) {
    throw new Error('File too large. Maximum 5 MB.');
  }

  const playerId = refPath.split('/').pop();
  if (!playerId) throw new Error('Invalid player reference.');

  const prefix = docType === 'birthCertificate' ? 'birth_cert' : 'physical';
  const path = `players/${playerId}/${prefix}_${Date.now()}`;

  const idToken = await user.getIdToken();
  const formData = new FormData();
  formData.append('file', file);
  formData.append('path', path);

  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}` },
    body: formData,
  });
  const data = await res.json();
  if (!res.ok || !data?.url) {
    throw new Error(data?.error || 'Upload failed.');
  }

  const update: Record<string, string | boolean> = {
    'compliance.verificationStatus': 'pending',
    updatedAt: new Date().toISOString(),
  };
  if (docType === 'birthCertificate') {
    update.birthCertificateUrl = data.url;
    update['compliance.birthCertificateVerified'] = false;
    update.ageVerified = false;
  } else {
    update.physicalFormUrl = data.url;
    update['compliance.physicalVerified'] = false;
  }
  await updateDoc(doc(db, refPath), update);

  return { url: data.url };
}
