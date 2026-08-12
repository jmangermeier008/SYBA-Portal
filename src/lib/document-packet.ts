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

/**
 * Documents per server call. The packet route downscales phone photos and
 * decrypt-rasterizes the PA certificates, and on Vercel's throttled Hobby CPU
 * a batch of three heavy documents was measured at ~39s against a hard 60s
 * function ceiling (a single 15-document call flatly 504s — that outage is why
 * batching exists). Two per call keeps roughly 2x headroom.
 */
const BATCH_SIZE = 2;
/** Parallel in-flight batches. */
const CONCURRENCY = 2;

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

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/**
 * Requests a merged, labeled PDF of player documents or volunteer clearances,
 * built in small server batches and stitched together in the browser.
 *
 * In `print` mode it lands in a new tab: desktop goes straight to the native
 * PDF viewer (which has a print button); phones get a launch page saying where
 * the phone's own Print action lives, because no mobile browser lets a page
 * open the print dialog for a PDF. The tab must be opened synchronously inside
 * the click handler, before any await, so popup blockers treat it as
 * user-initiated — the same rule openPrintTab() in print-job.ts follows. While
 * batches build, the tab shows live progress; on failure the error is written
 * into the tab rather than closing it, since on phones a toast behind the tab
 * is never seen.
 *
 * In `download` mode nothing is opened: the stitched blob is saved under a
 * dated filename, ready to attach to an email.
 *
 * `labels`, when provided, aligns 1:1 with `refPaths` so a batch that fails
 * outright can still be reported by name in the result panel.
 */
export async function openDocumentPacket(opts: {
  user: User;
  docType: PacketDocType;
  refPaths: string[];
  mode?: PacketMode;
  labels?: string[];
}): Promise<DocumentPacketResult> {
  const mode = opts.mode ?? 'print';
  const total = opts.refPaths.length;
  const tab = mode === 'print' ? window.open('', '_blank') : null;

  let progressEl: HTMLElement | null = null;
  if (tab) {
    // Written once, before any await; afterwards only this node's textContent
    // is mutated — re-running document.write after an await is unreliable on
    // iOS and is what previously left tabs stuck on "Preparing documents…".
    tab.document.write(
      '<html><head><title>Preparing documents…</title>' +
      '<meta name="viewport" content="width=device-width, initial-scale=1"></head>' +
      '<body style="font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;' +
      'min-height:100vh;margin:0;padding:24px;color:#555;text-align:center">' +
      `<p id="syba-progress" style="line-height:1.6">Preparing documents… 0 of ${total}</p>` +
      '</body></html>'
    );
    tab.document.close();
    progressEl = tab.document.getElementById('syba-progress');
  }
  const setProgress = (text: string) => {
    try {
      if (progressEl) progressEl.textContent = text;
    } catch { /* tab was closed by the user — progress is moot */ }
  };
  const failInTab = (message: string) => {
    setProgress(`${message} — you can close this tab and try again.`);
  };

  try {
    const idToken = await opts.user.getIdToken();

    const batches: { refPaths: string[]; labels: string[] }[] = [];
    for (let i = 0; i < total; i += BATCH_SIZE) {
      batches.push({
        refPaths: opts.refPaths.slice(i, i + BATCH_SIZE),
        labels: opts.labels?.slice(i, i + BATCH_SIZE) ?? [],
      });
    }

    // Results keyed by batch index so the stitched packet preserves the
    // caller's (name-sorted) order regardless of which batch finishes first.
    const parts: (Uint8Array | null)[] = new Array(batches.length).fill(null);
    const skippedNames: string[] = [];
    let skippedCount = 0;
    let processed = 0;

    const runBatch = async (index: number) => {
      const batch = batches[index];
      const fallbackNames = () =>
        batch.labels.length ? batch.labels : [`${batch.refPaths.length} document(s)`];

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await fetch('/api/documents/packet', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
            body: JSON.stringify({ docType: opts.docType, refPaths: batch.refPaths }),
          });

          if (res.status === 422) {
            // Nothing in this batch could be included — record the names the
            // server sends back and keep building the rest of the packet.
            const data = await res.json().catch(() => null);
            const names: string[] = Array.isArray(data?.skipped) ? data.skipped : fallbackNames();
            skippedNames.push(...names);
            skippedCount += batch.refPaths.length;
            return;
          }
          if (!res.ok) throw new Error(`HTTP ${res.status}`);

          skippedCount += Number(res.headers.get('X-Skipped-Count') ?? '0');
          const rawNames = res.headers.get('X-Skipped-Names') ?? '';
          try {
            if (rawNames) skippedNames.push(...decodeURIComponent(rawNames).split('|').filter(Boolean));
          } catch { /* truncated encoding — the count still reflects them */ }

          parts[index] = new Uint8Array(await res.arrayBuffer());
          return;
        } catch (err) {
          if (attempt === 1) {
            // Retried and still failing — report these documents by name
            // rather than sinking the whole packet.
            skippedNames.push(...fallbackNames());
            skippedCount += batch.refPaths.length;
          }
        }
      }
    };

    // Small worker pool — batches start in order, at most CONCURRENCY in flight
    let next = 0;
    const worker = async () => {
      while (next < batches.length) {
        const index = next++;
        await runBatch(index);
        processed += batches[index].refPaths.length;
        setProgress(`Preparing documents… ${Math.min(processed, total)} of ${total}`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));

    const pdfParts = parts.filter((p): p is Uint8Array => !!p);
    if (pdfParts.length === 0) {
      const message = 'None of the requested documents could be included.';
      failInTab(message);
      return { ok: false, error: message, skippedCount, skippedNames };
    }

    setProgress('Combining pages…');
    const blob = pdfParts.length === 1
      ? new Blob([pdfParts[0] as BlobPart], { type: 'application/pdf' })
      : await stitchPdfParts(pdfParts);
    const blobUrl = URL.createObjectURL(blob);
    const filename = packetFilename(opts.docType);

    if (mode === 'download') {
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Safari needs the URL alive until the save has actually started
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } else if (tab && isTouchFirstDevice()) {
      // Navigation is the reliable cross-window operation after awaits; the
      // launch page itself ships as a blob: document rather than a second
      // document.write.
      tab.location.href = buildMobileReadyPageUrl(blobUrl, filename);
    } else if (tab) {
      tab.location.href = blobUrl;
    } else {
      // Popup was blocked despite the synchronous open — last-resort fallback
      window.location.href = blobUrl;
    }
    return { ok: true, skippedCount, skippedNames };
  } catch (err: any) {
    const message = err?.message ?? 'Failed to build the document packet.';
    failInTab(message);
    return { ok: false, error: message };
  }
}

/** Concatenates the per-batch PDFs; pages arrive already labeled by the server. */
async function stitchPdfParts(parts: Uint8Array[]): Promise<Blob> {
  const { PDFDocument } = await import('pdf-lib');
  const out = await PDFDocument.create();
  for (const part of parts) {
    const src = await PDFDocument.load(part);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach(p => out.addPage(p));
  }
  return new Blob([(await out.save()) as BlobPart], { type: 'application/pdf' });
}

/**
 * The phone launch page, served as a blob: HTML document. Inline styles only —
 * it has no app context. The object URLs stay alive for the page's lifetime;
 * two of them is an acceptable cost for links that keep working however long
 * the tab sits open.
 */
function buildMobileReadyPageUrl(pdfBlobUrl: string, filename: string): string {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const printHint = isIOS
    ? 'open the packet, tap the Share button, then choose Print.'
    : 'open the packet, tap the ⋮ menu (or Share), then choose Print.';
  const html =
    '<html><head><title>Packet ready</title>' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"></head>' +
    '<body style="font-family:-apple-system,sans-serif;display:flex;flex-direction:column;align-items:center;' +
    'justify-content:center;min-height:100vh;margin:0;padding:24px;box-sizing:border-box;background:#f6f7f9;color:#1a1a1a">' +
    '<div style="max-width:24rem;width:100%;text-align:center">' +
    '<p style="font-size:2.5rem;margin:0 0 8px">📄</p>' +
    '<h1 style="font-size:1.25rem;margin:0 0 4px">Your packet is ready</h1>' +
    `<p style="font-size:.8rem;color:#666;margin:0 0 24px;word-break:break-all">${esc(filename)}</p>` +
    `<a href="${pdfBlobUrl}" style="display:block;background:#16a34a;color:#fff;text-decoration:none;` +
    'padding:14px;border-radius:12px;font-weight:600;margin-bottom:12px">Open Packet</a>' +
    `<a href="${pdfBlobUrl}" download="${esc(filename)}" style="display:block;background:#fff;color:#1a1a1a;` +
    'text-decoration:none;padding:14px;border-radius:12px;font-weight:600;border:1px solid #d4d4d8;margin-bottom:24px">' +
    'Download PDF</a>' +
    `<p style="font-size:.8rem;color:#666;line-height:1.5;margin:0">To print from your phone: ${printHint}</p>` +
    '</div></body></html>';
  return URL.createObjectURL(new Blob([html], { type: 'text/html' }));
}
