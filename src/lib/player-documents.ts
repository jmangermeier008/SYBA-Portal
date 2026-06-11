import { doc, updateDoc, type Firestore } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import type { PlayerDocType } from '@/lib/document-packet';
import { prepareDocumentForUpload, uploadExtensionFor } from '@/lib/upload-compressor';

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
  files: File[];
}): Promise<{ url: string }> {
  const { user, db, refPath, docType, files } = opts;

  const playerId = refPath.split('/').pop();
  if (!playerId) throw new Error('Invalid player reference.');

  // Validates type/size, compresses oversized photos, and merges multiple
  // photos into one PDF; throws user-friendly messages.
  const prefix = docType === 'birthCertificate' ? 'birth_cert' : 'physical';
  const file = await prepareDocumentForUpload(files, prefix);
  const path = `players/${playerId}/${prefix}_${Date.now()}.${uploadExtensionFor(file)}`;

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
