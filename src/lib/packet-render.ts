/**
 * Server-only image work for the document packet route.
 *
 * Two jobs, both about getting an uploaded document into a merged PDF:
 *
 *  - Rasterizing PDFs that pdf-lib cannot read. The PA CWIS clearance
 *    certificates are AES-128 encrypted (permissions-locked so a clearance
 *    can't be altered), and pdf-lib implements no decryption at all — it
 *    loads them, finds ciphertext where the page tree should be, and throws.
 *    PDF.js decrypts them, so we render the pages and embed the images.
 *
 *  - Shrinking oversized photos. Coaches upload 3-4 MB phone pictures; merged
 *    as-is a full packet lands around 26 MB, past most mail servers' limits.
 *    Capping them at print resolution costs nothing visible on paper.
 */

import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';

/** 200 DPI across the 8.5in printable width — the long edge of a letter page. */
const MAX_IMAGE_EDGE_PX = 1700;
const JPEG_QUALITY = 82;
const RENDER_DPI = 200;

/** Guards against one pathological upload eating the whole request budget. */
const MAX_RENDERED_PAGES = 20;

/**
 * Locates PDF.js's own asset directories on disk.
 *
 * Not resolved through `pdfjs-dist/package.json` — that file is not in the
 * deployed function's trace. `legacy/build/pdf.mjs` is (it's the module we
 * import), so we walk up from there, with a cwd-relative fallback.
 */
function resolvePdfjsAssetDir(name: 'standard_fonts' | 'wasm' | 'iccs'): string | undefined {
  const candidates: string[] = [];
  try {
    const require = createRequire(path.join(process.cwd(), 'index.js'));
    const buildDir = path.dirname(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'));
    candidates.push(path.join(buildDir, '..', '..', name) + path.sep);
  } catch { /* fall through to the cwd guess */ }
  candidates.push(path.join(process.cwd(), 'node_modules', 'pdfjs-dist', name) + path.sep);

  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir)) return dir;
    } catch { /* unreadable path — try the next */ }
  }
  // Degraded text beats a failed packet, so this warns rather than throwing.
  console.warn(`[packet-render] pdfjs ${name} directory not found; rendering may be degraded`);
  return undefined;
}

let assetDirs: { standardFontDataUrl?: string; wasmUrl?: string; iccUrl?: string } | null = null;
function pdfjsAssetOptions() {
  if (!assetDirs) {
    assetDirs = {
      standardFontDataUrl: resolvePdfjsAssetDir('standard_fonts'),
      wasmUrl: resolvePdfjsAssetDir('wasm'),
      iccUrl: resolvePdfjsAssetDir('iccs'),
    };
  }
  return assetDirs;
}

/** JPEG/PNG bytes ready to embed, plus which of the two it is. */
export interface PreparedImage {
  bytes: Uint8Array;
  isJpeg: boolean;
}

/**
 * Rasterizes a PDF that pdf-lib refused, one JPEG per page.
 *
 * Returns an empty array when PDF.js can't read it either, so the caller can
 * fall through to a placeholder page rather than dropping the document.
 */
export async function renderPdfPages(bytes: Uint8Array): Promise<Uint8Array[]> {
  const { createCanvas } = await import('@napi-rs/canvas');
  // The legacy build is the one that runs outside a browser; the default
  // entry point assumes DOM globals that don't exist in a serverless runtime.
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const loadingTask = pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    // The PA clearance certificates embed no fonts at all. Without its own
    // font data PDF.js draws every glyph with ctx.fillText against an
    // operating-system font — which a dev Mac has and the Linux serverless
    // runtime does not, so pages arrived with the form rules but no text.
    // Supplying these makes PDF.js draw the glyph outlines itself, identically
    // everywhere. useSystemFonts stays false: there are none to use.
    useSystemFonts: false,
    ...pdfjsAssetOptions(),
    // Missing glyphs render as blanks rather than rejecting the whole document
    stopAtErrors: false,
  });
  const doc = await loadingTask.promise;

  const pages: Uint8Array[] = [];
  try {
    const count = Math.min(doc.numPages, MAX_RENDERED_PAGES);
    for (let i = 1; i <= count; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: RENDER_DPI / 72 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({
        canvasContext: canvas.getContext('2d') as any,
        viewport,
        canvas: canvas as any,
      }).promise;
      pages.push(new Uint8Array(canvas.toBuffer('image/jpeg', JPEG_QUALITY)));
      page.cleanup?.();
    }
  } finally {
    // Teardown lives on the loading task, not the document proxy. Never let a
    // cleanup failure discard pages that already rendered successfully.
    try {
      await loadingTask.destroy();
    } catch { /* nothing left worth reporting */ }
  }
  return pages;
}

/**
 * Caps an uploaded image at print resolution. Anything already small enough is
 * passed through untouched, so a tidy scan is never re-encoded.
 */
export async function prepareImage(bytes: Uint8Array, isJpeg: boolean): Promise<PreparedImage> {
  try {
    const { createCanvas, loadImage } = await import('@napi-rs/canvas');
    const img = await loadImage(Buffer.from(bytes));
    const longEdge = Math.max(img.width, img.height);
    if (longEdge <= MAX_IMAGE_EDGE_PX) return { bytes, isJpeg };

    const scale = MAX_IMAGE_EDGE_PX / longEdge;
    const canvas = createCanvas(Math.round(img.width * scale), Math.round(img.height * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return { bytes: new Uint8Array(canvas.toBuffer('image/jpeg', JPEG_QUALITY)), isJpeg: true };
  } catch {
    // Downscaling is an optimization — a failure here must never lose the page.
    return { bytes, isJpeg };
  }
}
