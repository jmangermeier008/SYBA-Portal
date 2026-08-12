import type { User } from 'firebase/auth';
import type { ClearanceType } from '@/lib/clearances';

export type PlayerDocType = 'birthCertificate' | 'physicalForm';

/**
 * Everything the packet route can merge. Player doc types and clearance types
 * never collide by name, so the server picks its branch straight from this
 * value — no extra discriminator is passed over the wire.
 */
export type PacketDocType = PlayerDocType | ClearanceType;

export type PacketMode = 'print' | 'download';

export interface DocumentPacketResult {
  ok: boolean;
  error?: string;
  /** Documents the server could not merge, even after rasterizing. */
  skippedCount?: number;
  /** Who those documents belonged to — surfaced so an admin knows who to chase. */
  skippedNames?: string[];
}

/** Human-readable file stem per document type, used for downloads. */
const FILE_STEMS: Record<string, string> = {
  birthCertificate: 'birth-certificates',
  physicalForm: 'physical-forms',
  ChildAbuse: 'pa-child-abuse-clearances',
  CriminalRecord: 'criminal-record-checks',
  USAFootball: 'usa-football-certs',
};

/** Local calendar date — never toISOString(), which is UTC and rolls a day early. */
function todayStamp(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function packetFilename(docType: PacketDocType): string {
  return `${FILE_STEMS[docType] ?? 'documents'}-${todayStamp()}.pdf`;
}

/** Phones and tablets — where the browser can't pop a print dialog for a PDF. */
function isTouchFirstDevice(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
}

/**
 * Replaces the "Preparing documents…" placeholder in the already-open tab with
 * a launch page. Inline styles only — this tab has no app context. The blob
 * URL stays alive for the page's lifetime; one object URL is an acceptable
 * cost for links that keep working however long the tab sits open.
 */
function writeMobileReadyPage(tab: Window, blobUrl: string, filename: string) {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const printHint = isIOS
    ? 'open the packet, tap the Share button, then choose Print.'
    : 'open the packet, tap the ⋮ menu (or Share), then choose Print.';
  tab.document.open();
  tab.document.write(
    '<html><head><title>Packet ready</title>' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"></head>' +
    '<body style="font-family:-apple-system,sans-serif;display:flex;flex-direction:column;align-items:center;' +
    'justify-content:center;min-height:100vh;margin:0;padding:24px;box-sizing:border-box;background:#f6f7f9;color:#1a1a1a">' +
    '<div style="max-width:24rem;width:100%;text-align:center">' +
    '<p style="font-size:2.5rem;margin:0 0 8px">📄</p>' +
    '<h1 style="font-size:1.25rem;margin:0 0 4px">Your packet is ready</h1>' +
    `<p style="font-size:.8rem;color:#666;margin:0 0 24px;word-break:break-all">${esc(filename)}</p>` +
    `<a href="${blobUrl}" style="display:block;background:#16a34a;color:#fff;text-decoration:none;` +
    'padding:14px;border-radius:12px;font-weight:600;margin-bottom:12px">Open Packet</a>' +
    `<a href="${blobUrl}" download="${esc(filename)}" style="display:block;background:#fff;color:#1a1a1a;` +
    'text-decoration:none;padding:14px;border-radius:12px;font-weight:600;border:1px solid #d4d4d8;margin-bottom:24px">' +
    'Download PDF</a>' +
    `<p style="font-size:.8rem;color:#666;line-height:1.5;margin:0">To print from your phone: ${printHint}</p>` +
    '</div></body></html>'
  );
  tab.document.close();
}

/**
 * Requests a merged, labeled PDF of player documents or volunteer clearances
 * from the server.
 *
 * In `print` mode it lands in a new tab, where the browser's native PDF viewer
 * handles printing on every platform (including iOS, where in-app PDF iframes
 * and cross-origin print calls both fail). That tab must be opened
 * synchronously inside the click handler, before any await, so popup blockers
 * treat it as user-initiated — the same rule openPrintTab() in print-job.ts
 * follows.
 *
 * In `download` mode nothing is opened at all: the finished blob is saved
 * straight to disk under a dated filename, ready to attach to an email. No
 * popup, so no blocker to appease.
 */
export async function openDocumentPacket(opts: {
  user: User;
  docType: PacketDocType;
  refPaths: string[];
  mode?: PacketMode;
}): Promise<DocumentPacketResult> {
  const mode = opts.mode ?? 'print';
  const tab = mode === 'print' ? window.open('', '_blank') : null;
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
    const rawNames = res.headers.get('X-Skipped-Names') ?? '';
    let skippedNames: string[] = [];
    try {
      skippedNames = rawNames ? decodeURIComponent(rawNames).split('|').filter(Boolean) : [];
    } catch { /* truncated encoding — fall back to the count alone */ }

    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);

    if (mode === 'download') {
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = packetFilename(opts.docType);
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Safari needs the URL alive until the save has actually started
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } else if (tab && isTouchFirstDevice()) {
      // No mobile browser lets a page open the print dialog for a PDF — the
      // print action lives behind the share/⋮ menu, which nobody finds. So on
      // phones the tab becomes a launch page that says where Print actually
      // is, with the packet and a download one tap away. Desktop skips this:
      // its native PDF viewer has a visible print button.
      writeMobileReadyPage(tab, blobUrl, packetFilename(opts.docType));
    } else if (tab) {
      tab.location.href = blobUrl;
    } else {
      // Popup was blocked despite the synchronous open — last-resort fallback
      window.location.href = blobUrl;
    }
    return { ok: true, skippedCount, skippedNames };
  } catch (err: any) {
    tab?.close();
    return { ok: false, error: err?.message ?? 'Failed to build the document packet.' };
  }
}
