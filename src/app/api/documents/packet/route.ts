import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getAdminAuth, getAdminFirestore } from '@/lib/firebase-admin';
import { CLEARANCE_TYPES, isClearanceType } from '@/lib/clearances';

const DOC_FIELDS = {
  birthCertificate: { field: 'birthCertificateUrl', label: 'Birth Certificate', filename: 'birth-certificates.pdf' },
  physicalForm: { field: 'physicalFormUrl', label: 'Physical Form', filename: 'physical-forms.pdf' },
} as const;

type DocType = keyof typeof DOC_FIELDS;

// Only player docs and volunteer clearances may be read through this route —
// never arbitrary Firestore paths.
const PLAYER_REF_PATH = /^userProfiles\/[A-Za-z0-9_-]+\/players\/[A-Za-z0-9_-]+$/;
const CLEARANCE_REF_PATH = /^userProfiles\/[A-Za-z0-9_-]+\/clearances\/[A-Za-z0-9_-]+$/;

const LETTER = { width: 612, height: 792 } as const; // points
const MARGIN = 36; // 0.5in
const LABEL_SIZE = 11;

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const idToken = authHeader.slice(7);
    let decoded;
    try {
      decoded = await getAdminAuth().verifyIdToken(idToken);
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = getAdminFirestore();

    // Children's documents and volunteer background checks are the most
    // sensitive files in the app — Admin only. Mirrors the client derivation:
    // isSiteAdmin flag, legacy roles array, or 'Admin' in any sport's sportRoles.
    const callerSnap = await db.doc(`userProfiles/${decoded.uid}`).get();
    const caller = callerSnap.data();
    const isAdminUser =
      caller?.isSiteAdmin === true ||
      caller?.roles?.includes('Admin') === true ||
      caller?.roles?.includes('Site Admin') === true ||
      Object.values(caller?.sportRoles ?? {}).some(
        (r) => Array.isArray(r) && r.includes('Admin')
      );
    if (!isAdminUser) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    const docType = body?.docType;
    const refPaths = body?.refPaths;

    // Player doc types and clearance types share one parameter — their names
    // never collide, so whichever map the value lands in selects the branch.
    const isPlayerDoc = typeof docType === 'string' && docType in DOC_FIELDS;
    const isClearanceDoc = isClearanceType(docType);
    if ((!isPlayerDoc && !isClearanceDoc) || !Array.isArray(refPaths) || refPaths.length === 0) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    if (refPaths.length > 200) {
      return NextResponse.json({ error: 'Too many documents requested (max 200)' }, { status: 400 });
    }
    const refPattern = isPlayerDoc ? PLAYER_REF_PATH : CLEARANCE_REF_PATH;
    if (!refPaths.every((p) => typeof p === 'string' && refPattern.test(p))) {
      return NextResponse.json({ error: 'Invalid document reference' }, { status: 400 });
    }

    const out = await PDFDocument.create();
    const font = await out.embedFont(StandardFonts.Helvetica);
    const skipped: string[] = [];

    const drawLabel = (page: ReturnType<typeof out.addPage>, text: string) => {
      const textWidth = font.widthOfTextAtSize(text, LABEL_SIZE);
      const { width, height } = page.getSize();
      // Opaque backing so the label stays legible over full-bleed scans
      page.drawRectangle({
        x: 0,
        y: height - 22,
        width,
        height: 22,
        color: rgb(1, 1, 1),
      });
      page.drawText(text, {
        x: Math.max((width - textWidth) / 2, 8),
        y: height - 16,
        size: LABEL_SIZE,
        font,
        color: rgb(0, 0, 0),
      });
    };

    const snaps = await db.getAll(...refPaths.map((p: string) => db.doc(p)));
    let filename: string;

    if (isPlayerDoc) {
      const { field, label, filename: playerFilename } = DOC_FIELDS[docType as DocType];
      filename = playerFilename;

      for (const snap of snaps) {
        const player = snap.exists ? snap.data() : undefined;
        const name = player ? `${player.firstName ?? ''} ${player.lastName ?? ''}`.trim() : snap.id;
        const url = player?.[field];
        if (!url || typeof url !== 'string') {
          skipped.push(name || snap.id);
          continue;
        }
        const labelText = [name, player?.dateOfBirth ? `DOB ${player.dateOfBirth}` : null, label]
          .filter(Boolean)
          .join(' — ');
        const added = await appendDocument(out, url, labelText, drawLabel, snap.ref.path);
        if (!added) skipped.push(name || snap.id);
      }
    } else {
      const slot = CLEARANCE_TYPES.find((c) => c.type === docType)!;
      filename = slot.filename;

      // A clearance document carries only its owner's uid — the volunteer's
      // name lives on the parent userProfiles doc, so resolve those in one
      // batch before labeling the pages.
      const ownerUids = [
        ...new Set(snaps.map((s) => s.ref.parent.parent?.id).filter((id): id is string => !!id)),
      ];
      const ownerSnaps = ownerUids.length
        ? await db.getAll(...ownerUids.map((uid) => db.doc(`userProfiles/${uid}`)))
        : [];
      const names = new Map(
        ownerSnaps.map((s) => [s.id, (s.data()?.displayName as string) || (s.data()?.email as string) || s.id])
      );

      for (const snap of snaps) {
        const record = snap.exists ? snap.data() : undefined;
        const ownerUid = snap.ref.parent.parent?.id ?? '';
        const name = names.get(ownerUid) ?? ownerUid;
        const url = record?.fileUrl;
        if (!url || typeof url !== 'string') {
          skipped.push(name);
          continue;
        }
        const labelText = [name, slot.label, record?.expirationDate ? `Expires ${record.expirationDate}` : null]
          .filter(Boolean)
          .join(' — ');
        const added = await appendDocument(out, url, labelText, drawLabel, snap.ref.path);
        if (!added) skipped.push(name);
      }
    }

    if (out.getPageCount() === 0) {
      return NextResponse.json(
        { error: 'None of the requested documents could be included.', skipped },
        { status: 422 }
      );
    }

    const pdfBytes = await out.save();
    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'X-Skipped-Count': String(skipped.length),
      },
    });
  } catch (err: any) {
    console.error('[documents/packet] error:', err);
    return NextResponse.json({ error: err.message || 'Failed to build document packet' }, { status: 500 });
  }
}

/**
 * Fetches one uploaded document and appends it to the packet, labeling every
 * page it contributes. Returns false when the file could not be included.
 *
 * Content-type is checked before the URL extension on purpose: compliance
 * uploads are stored as `compliance/{uid}/{type}_{timestamp}` with no
 * extension at all, so extension sniffing alone would skip every clearance.
 */
async function appendDocument(
  out: PDFDocument,
  url: string,
  labelText: string,
  drawLabel: (page: ReturnType<PDFDocument['addPage']>, text: string) => void,
  refPath: string
): Promise<boolean> {
  try {
    const res = await fetch(url);
    if (!res.ok) return false;

    const contentType = res.headers.get('content-type') ?? '';
    const pathname = new URL(url).pathname.toLowerCase();
    const bytes = new Uint8Array(await res.arrayBuffer());

    if (contentType.includes('pdf') || pathname.endsWith('.pdf')) {
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = await out.copyPages(src, src.getPageIndices());
      for (const page of pages) {
        out.addPage(page);
        drawLabel(page, labelText);
      }
      return true;
    }
    if (contentType.includes('jpeg') || contentType.includes('jpg') || /\.jpe?g$/.test(pathname)) {
      addImagePage(out, await out.embedJpg(bytes), drawLabel, labelText);
      return true;
    }
    if (contentType.includes('png') || pathname.endsWith('.png')) {
      addImagePage(out, await out.embedPng(bytes), drawLabel, labelText);
      return true;
    }
    return false;
  } catch (err) {
    console.error(`[documents/packet] failed for ${refPath}:`, err);
    return false;
  }
}

function addImagePage(
  out: PDFDocument,
  img: Awaited<ReturnType<PDFDocument['embedJpg']>>,
  drawLabel: (page: ReturnType<PDFDocument['addPage']>, text: string) => void,
  labelText: string
) {
  const page = out.addPage([LETTER.width, LETTER.height]);
  const maxW = LETTER.width - MARGIN * 2;
  const maxH = LETTER.height - MARGIN * 2 - 22; // leave room below the label strip
  const scale = Math.min(maxW / img.width, maxH / img.height, 1);
  const w = img.width * scale;
  const h = img.height * scale;
  page.drawImage(img, {
    x: (LETTER.width - w) / 2,
    y: (LETTER.height - 22 - h) / 2, // center in the area below the label strip
    width: w,
    height: h,
  });
  drawLabel(page, labelText);
}
