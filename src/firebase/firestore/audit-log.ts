import { Firestore, collection, doc, setDoc } from 'firebase/firestore';
import type { AuditAction } from '@/types/scheduling';

export interface WriteAuditLogOptions {
  action: AuditAction;
  adminUid: string;
  targetCollection: string;
  targetDocId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  sport?: string;
}

/**
 * Writes an immutable audit record to `auditLogs/{id}`.
 * Fire-and-forget — errors are swallowed so audit failures never block user actions.
 */
export async function writeAuditLog(
  db: Firestore,
  opts: WriteAuditLogOptions,
): Promise<void> {
  try {
    const id = crypto.randomUUID();
    await setDoc(doc(collection(db, 'auditLogs'), id), {
      id,
      action: opts.action,
      adminUid: opts.adminUid,
      targetCollection: opts.targetCollection,
      targetDocId: opts.targetDocId,
      before: opts.before ?? null,
      after: opts.after ?? null,
      meta: opts.meta ?? null,
      sport: opts.sport ?? null,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[writeAuditLog] Failed:', err);
  }
}
