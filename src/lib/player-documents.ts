import { doc, getDoc, updateDoc, type Firestore } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import type { PlayerDocType } from '@/lib/document-packet';
import { prepareDocumentForUpload, uploadExtensionFor } from '@/lib/upload-compressor';
import { combinedRejectionReason, rollupVerificationStatus } from '@/types/scheduling';

/**
 * Upload/replace a player's birth certificate or physical form. Shared by the
 * admin audit dialog and every parent surface, so the post-upload bookkeeping
 * only has to be right in one place.
 *
 * Uploads through /api/upload, points the player doc at the new file, clears
 * any rejection on *that* document, and sends it back through the verify flow.
 * The other document's verdict is left alone — replacing a bad physical must
 * not quietly un-reject the birth certificate.
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

  const playerRef = doc(db, refPath);

  // Read the current verdicts so the rollup reflects the *other* document too —
  // a family can have both rejected, and fixing one shouldn't clear the other.
  const snap = await getDoc(playerRef);
  const current = (snap.data()?.compliance ?? {}) as {
    birthCertificateVerified?: boolean;
    physicalVerified?: boolean;
    birthCertificateRejected?: boolean;
    birthCertificateRejectionReason?: string;
    physicalRejected?: boolean;
    physicalRejectionReason?: string;
  };

  const next = {
    ...current,
    ...(docType === 'birthCertificate'
      ? { birthCertificateVerified: false, birthCertificateRejected: false, birthCertificateRejectionReason: '' }
      : { physicalVerified: false, physicalRejected: false, physicalRejectionReason: '' }),
  };

  const update: Record<string, string | boolean> = {
    'compliance.verificationStatus': rollupVerificationStatus(next),
    'compliance.rejectionReason': combinedRejectionReason(next),
    updatedAt: new Date().toISOString(),
  };
  if (docType === 'birthCertificate') {
    update.birthCertificateUrl = data.url;
    update['compliance.birthCertificateVerified'] = false;
    update['compliance.birthCertificateRejected'] = false;
    update['compliance.birthCertificateRejectionReason'] = '';
    update.ageVerified = false;
  } else {
    update.physicalFormUrl = data.url;
    update['compliance.physicalVerified'] = false;
    update['compliance.physicalRejected'] = false;
    update['compliance.physicalRejectionReason'] = '';
  }
  await updateDoc(playerRef, update);

  return { url: data.url };
}
