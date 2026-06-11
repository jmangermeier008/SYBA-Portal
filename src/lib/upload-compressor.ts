/**
 * Client-side document preparation for player document uploads.
 *
 * Phone cameras produce 6–12 MB photos that fail the 5 MB /api/upload limit,
 * so images are downscaled on-device (max edge 1600px, JPEG ~0.78) and
 * assembled into a single PDF — multiple photos (front/back of a form) become
 * one multi-page PDF. A real PDF under the limit passes through untouched.
 *
 * Contract: resolves with a File ≤ 5 MB, or rejects with a user-friendly
 * Error message. Callers toast the message; nothing here hard-crashes a
 * component. Canvas/PDF failures on memory-constrained devices fall back to a
 * single high-compression JPEG targeted under 2 MB.
 */

const MAX_BYTES = 5 * 1024 * 1024;
const FALLBACK_TARGET_BYTES = 2 * 1024 * 1024;
const MAX_EDGE = 1600;
const RETRY_MAX_EDGE = 1280;
const QUALITY = 0.78;
const RETRY_QUALITY = 0.6;
const MAX_IMAGES = 10;

const IMAGE_TYPES = ['image/jpeg', 'image/png'];

type DocKind = 'pdf' | 'image';

/** File extension matching the prepared file's content type, for upload paths. */
export function uploadExtensionFor(file: File): string {
  if (file.type === 'application/pdf') return 'pdf';
  if (file.type === 'image/png') return 'png';
  return 'jpg';
}

/**
 * Some Android pickers deliver files with an empty MIME type — fall back to
 * the filename extension before rejecting.
 */
function kindOf(file: File): DocKind | null {
  if (file.type === 'application/pdf') return 'pdf';
  if (IMAGE_TYPES.includes(file.type)) return 'image';
  if (!file.type) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.pdf')) return 'pdf';
    if (/\.(jpe?g|png)$/.test(name)) return 'image';
  }
  return null;
}

export async function prepareDocumentForUpload(files: File[], baseName: string): Promise<File> {
  if (files.length === 0) throw new Error('No file selected.');

  const kinds = files.map(kindOf);
  if (kinds.some(k => k === null)) {
    throw new Error('Invalid file type. Upload a PDF, JPG, or PNG.');
  }

  const pdfCount = kinds.filter(k => k === 'pdf').length;
  if (pdfCount > 0) {
    if (files.length > 1) {
      throw new Error('Select either one PDF or photos of the document — not both.');
    }
    if (files[0].size > MAX_BYTES) {
      throw new Error('This PDF is larger than 5 MB. Try a smaller scan, or take photos of the pages instead.');
    }
    return files[0];
  }

  if (files.length > MAX_IMAGES) {
    throw new Error(`Too many photos. Select up to ${MAX_IMAGES}.`);
  }

  let images: HTMLImageElement[];
  try {
    images = await Promise.all(files.map(loadImage));
  } catch {
    // Couldn't decode at all (corrupt file, exotic encoding). If the original
    // is already within limits let the server's own validation be the judge.
    if (files.length === 1 && files[0].size <= MAX_BYTES) return files[0];
    throw new Error("Couldn't read one of the selected photos. Try a different photo or a PDF scan.");
  }

  try {
    const pdf = await assemblePdf(images, baseName, MAX_EDGE, QUALITY);
    if (pdf.size <= MAX_BYTES) return pdf;

    const retry = await assemblePdf(images, baseName, RETRY_MAX_EDGE, RETRY_QUALITY);
    if (retry.size <= MAX_BYTES) return retry;

    if (images.length > 1) {
      throw new Error('These photos are too large to combine. Try fewer photos or a PDF scan.');
    }
    return await fallbackJpeg(images[0], baseName);
  } catch (err) {
    // Canvas/pdf-lib failure — typically memory saturation on large mobile
    // captures. A single image can still ship as a plain compressed JPEG.
    if (images.length === 1) {
      try {
        return await fallbackJpeg(images[0], baseName);
      } catch {
        throw new Error("Couldn't process this photo on your device. Try a smaller photo or a PDF scan.");
      }
    }
    throw err instanceof Error && err.message.includes('photos')
      ? err
      : new Error("Couldn't combine your photos on this device. Try a single photo or a PDF scan.");
  }
}

function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  // decode() bakes in EXIF orientation, so no manual rotation is needed
  return img.decode().then(() => img).finally(() => URL.revokeObjectURL(url));
}

/** Downscale to maxEdge on a white-backed canvas and export as JPEG. */
function compressToJpegBlob(img: HTMLImageElement, maxEdge: number, quality: number): Promise<Blob> {
  let width = img.naturalWidth;
  let height = img.naturalHeight;
  if (width > maxEdge || height > maxEdge) {
    if (width > height) {
      height = Math.round((height * maxEdge) / width);
      width = maxEdge;
    } else {
      width = Math.round((width * maxEdge) / height);
      height = maxEdge;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');

  // White fill so transparent PNG regions render white, not black, in JPEG
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error('Canvas export failed'))),
      'image/jpeg',
      quality
    );
  });
}

async function assemblePdf(
  images: HTMLImageElement[],
  baseName: string,
  maxEdge: number,
  quality: number
): Promise<File> {
  const jpegs: ArrayBuffer[] = [];
  for (const img of images) {
    const blob = await compressToJpegBlob(img, maxEdge, quality);
    jpegs.push(await blob.arrayBuffer());
  }

  // Dynamic import keeps pdf-lib (~300 KB) out of the page bundle
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  for (const jpeg of jpegs) {
    const embedded = await doc.embedJpg(jpeg);
    const page = doc.addPage([embedded.width, embedded.height]);
    page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
  }
  const bytes = await doc.save();
  return new File([bytes as BlobPart], `${baseName}.pdf`, { type: 'application/pdf' });
}

/**
 * Last-resort single-page JPEG: step quality down, then halve dimensions,
 * until under the 2 MB fallback target.
 */
async function fallbackJpeg(img: HTMLImageElement, baseName: string): Promise<File> {
  for (const maxEdge of [MAX_EDGE, Math.round(MAX_EDGE / 2)]) {
    for (const quality of [0.6, 0.5, 0.4]) {
      const blob = await compressToJpegBlob(img, maxEdge, quality);
      if (blob.size <= FALLBACK_TARGET_BYTES) {
        return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
      }
    }
  }
  throw new Error('Photo could not be compressed under the size limit.');
}
