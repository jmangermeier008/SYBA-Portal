/**
 * Read-only audit of every volunteer clearance document.
 *
 * Answers the question "why is my printed packet short?" by walking the same
 * chain the admin Coaches tab and the /api/documents/packet route walk, and
 * reporting where each document falls out:
 *
 *   - is the owning profile visible in each sport's Coaches tab?
 *   - does the record's userId match the path it lives at?
 *   - is a file attached, and can it actually be fetched?
 *   - is it a content type the packet route can embed?
 *   - can pdf-lib merge it on its own, or does it need rasterizing?
 *
 * Writes nothing. Run from the project root:
 *   npx tsx --env-file=.env.local scripts/audit-clearance-documents.ts
 *   npx tsx --env-file=.env.local scripts/audit-clearance-documents.ts --type ChildAbuse
 *
 * Requires FIREBASE_SERVICE_ACCOUNT_KEY in .env.local
 */

import { PDFDocument } from 'pdf-lib';
import { getAdminFirestore } from '../src/lib/firebase-admin';
import { CLEARANCE_TYPES } from '../src/lib/clearances';

/** Mirrors the coach-list filter in src/app/admin/registration/page.tsx. */
const STAFF_ROLES = ['Coach', 'Board Member', 'Admin'];
const SPORTS = ['football', 'baseball'] as const;

function isStaff(profile: any | undefined, sport: string): boolean {
  if (!profile) return false;
  if (profile.isSiteAdmin === true) return true;
  const sportRoles: string[] = profile.sportRoles?.[sport] ?? [];
  if (sportRoles.some(r => STAFF_ROLES.includes(r))) return true;
  const legacy: string[] = profile.roles ?? (profile.role ? [profile.role] : []);
  return legacy.some(r => STAFF_ROLES.includes(r));
}

interface Row {
  name: string;
  ownerExists: boolean;
  docId: string;
  type: string;
  status: string;
  userIdOk: boolean;
  visibleIn: string[];
  fetchOk: boolean;
  contentType: string;
  bytes: number;
  encrypted: boolean;
  /** 'merge' = pdf-lib alone, 'raster' = needs PDF.js, 'image' = embedded directly, 'none' = placeholder */
  path: 'merge' | 'raster' | 'image' | 'none';
  note: string;
}

async function classify(url: string): Promise<Pick<Row, 'fetchOk' | 'contentType' | 'bytes' | 'encrypted' | 'path' | 'note'>> {
  const base = { fetchOk: false, contentType: '', bytes: 0, encrypted: false, path: 'none' as const, note: '' };
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err: any) {
    return { ...base, note: `fetch threw: ${err.message}` };
  }
  if (!res.ok) return { ...base, note: `HTTP ${res.status}` };

  const contentType = (res.headers.get('content-type') ?? '').split(';')[0];
  const buf = Buffer.from(await res.arrayBuffer());
  const common = { fetchOk: true, contentType, bytes: buf.length };

  if (contentType.includes('pdf')) {
    const encrypted = /\/Encrypt/.test(buf.toString('latin1'));
    try {
      const src = await PDFDocument.load(new Uint8Array(buf), { ignoreEncryption: true });
      const out = await PDFDocument.create();
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach(p => out.addPage(p));
      return { ...common, encrypted, path: 'merge', note: `${src.getPageCount()} page(s)` };
    } catch (err: any) {
      // Not fatal — the route rasterizes these via PDF.js. Flagged so a new
      // failure mode is visible rather than silently absorbed.
      return { ...common, encrypted, path: 'raster', note: `pdf-lib: ${err.message.slice(0, 44)}` };
    }
  }
  if (/jpe?g|png/.test(contentType)) return { ...common, encrypted: false, path: 'image', note: '' };
  return { ...common, encrypted: false, path: 'none', note: `unsupported: ${contentType || 'unknown'}` };
}

async function main() {
  const typeArg = process.argv.includes('--type')
    ? process.argv[process.argv.indexOf('--type') + 1]
    : null;

  const db = getAdminFirestore();
  const profileSnap = await db.collection('userProfiles').get();
  const profiles = new Map<string, any>();
  profileSnap.forEach(d => profiles.set(d.id, d.data()));

  const clearanceSnap = await db.collectionGroup('clearances').get();
  console.log(`userProfiles: ${profileSnap.size}   clearance docs: ${clearanceSnap.size}\n`);

  const rows: Row[] = [];
  for (const d of clearanceSnap.docs) {
    const uid = d.ref.parent.parent?.id ?? '';
    const data = d.data();
    const type = data.type ?? d.id;
    if (typeArg && type.toLowerCase() !== typeArg.toLowerCase() && d.id.toLowerCase() !== typeArg.toLowerCase()) continue;

    const profile = profiles.get(uid);
    const probe = data.fileUrl
      ? await classify(data.fileUrl)
      : { fetchOk: false, contentType: '', bytes: 0, encrypted: false, path: 'none' as const, note: 'no fileUrl' };

    rows.push({
      name: profile ? (profile.displayName || profile.email || uid) : `(no profile: ${uid.slice(0, 8)})`,
      ownerExists: !!profile,
      docId: d.id,
      type,
      status: data.status ?? '(none)',
      userIdOk: data.userId === uid,
      visibleIn: SPORTS.filter(s => isStaff(profile, s)),
      ...probe,
    });
  }

  rows.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  for (const r of rows) {
    console.log(
      [
        r.name.slice(0, 22).padEnd(22),
        r.docId.padEnd(15),
        r.status.padEnd(9),
        `uid:${r.userIdOk ? 'ok ' : 'BAD'}`,
        `seen:${(r.visibleIn.join('+') || 'NOWHERE').padEnd(17)}`,
        r.path.padEnd(7),
        r.encrypted ? 'enc' : '   ',
        String(Math.round(r.bytes / 1024)).padStart(5) + 'kb',
        r.note,
      ].join(' ')
    );
  }

  const n = (f: (r: Row) => boolean) => rows.filter(f).length;
  console.log('\n─── summary ───');
  console.log(`total documents examined     : ${rows.length}`);
  console.log(`embed via pdf-lib directly   : ${n(r => r.path === 'merge')}`);
  console.log(`embed as image               : ${n(r => r.path === 'image')}`);
  console.log(`need rasterizing (PDF.js)    : ${n(r => r.path === 'raster')}   <- encrypted: ${n(r => r.path === 'raster' && r.encrypted)}`);
  console.log(`cannot be included at all    : ${n(r => r.path === 'none')}`);
  console.log(`owner profile missing        : ${n(r => !r.ownerExists)}`);
  console.log(`userId does not match path   : ${n(r => !r.userIdOk)}`);
  for (const s of SPORTS) {
    console.log(`hidden from the ${s.padEnd(8)} tab : ${n(r => !r.visibleIn.includes(s))}`);
  }
  console.log('\nPer type, how many would land in a packet built from the All filter:');
  for (const { type, label } of CLEARANCE_TYPES) {
    const own = rows.filter(r => r.type === type || r.docId.toLowerCase() === type.toLowerCase());
    const printable = own.filter(r => r.ownerExists && r.visibleIn.length > 0 && r.path !== 'none');
    console.log(`  ${label.padEnd(42)} ${printable.length} of ${own.length}`);
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
