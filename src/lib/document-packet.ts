import type { User } from 'firebase/auth';
import type { ClearanceType } from '@/lib/clearances';

export type PlayerDocType = 'birthCertificate' | 'physicalForm';

/**
 * Everything the packet route can merge. Player doc types and clearance types
 * never collide by name, so the server picks its branch straight from this
 * value — no extra discriminator is passed over the wire.
 */
export type PacketDocType = PlayerDocType | ClearanceType;

export interface DocumentPacketResult {
  ok: boolean;
  error?: string;
  skippedCount?: number;
}

/**
 * Requests a merged, labeled PDF of player documents or volunteer clearances
 * from the server and shows it in a new tab, where the browser's native PDF
 * viewer handles printing on every platform (including iOS, where in-app PDF
 * iframes and cross-origin print calls both fail).
 *
 * Must be called synchronously inside a click handler: the tab is opened
 * before any await so popup blockers treat it as user-initiated — the same
 * rule openPrintTab() in print-job.ts follows.
 */
export async function openDocumentPacket(opts: {
  user: User;
  docType: PacketDocType;
  refPaths: string[];
}): Promise<DocumentPacketResult> {
  const tab = window.open('', '_blank');
  if (tab) {
    tab.document.write(
      '<html><head><title>Preparing documents…</title></head>' +
      '<body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#555">' +
      '<p>Preparing documents…</p></body></html>'
    );
  }

  try {
    const idToken = await opts.user.getIdToken();
    const res = await fetch('/api/documents/packet', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ docType: opts.docType, refPaths: opts.refPaths }),
    });

    if (!res.ok) {
      let message = 'Failed to build the document packet.';
      try {
        const data = await res.json();
        if (data?.error) message = data.error;
      } catch { /* non-JSON error body */ }
      tab?.close();
      return { ok: false, error: message };
    }

    const skippedCount = Number(res.headers.get('X-Skipped-Count') ?? '0');
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    if (tab) {
      tab.location.href = blobUrl;
    } else {
      // Popup was blocked despite the synchronous open — last-resort fallback
      window.location.href = blobUrl;
    }
    return { ok: true, skippedCount };
  } catch (err: any) {
    tab?.close();
    return { ok: false, error: err?.message ?? 'Failed to build the document packet.' };
  }
}
