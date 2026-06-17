import { NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebase-admin';
import { INQUIRY_TOPICS } from '@/data/inquiry-topics';
import type { InquiryTopic } from '@/data/inquiry-topics';
import type { InquiryDeliveryConfig, Sport } from '@/types/scheduling';

const SPORTS: Sport[] = ['baseball', 'football'];
const TOPIC_VALUES = new Set<string>(INQUIRY_TOPICS.map(t => t.value));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Parse a comma/newline/semicolon-separated string (or array) into a validated, deduped email list. */
function parseEmails(input: unknown): string[] {
  const raw = Array.isArray(input)
    ? input.map(String)
    : typeof input === 'string'
      ? input.split(/[\n,;]+/)
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const email = r.trim();
    if (!email) continue;
    if (!EMAIL_RE.test(email)) {
      throw new Error(`Invalid email address: "${email}"`);
    }
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

/** Verifies the bearer token and Site-Admin status. Returns the decoded user + profile, or a NextResponse error. */
async function requireSiteAdmin(req: Request) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(authHeader.slice(7));
  } catch {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const db = getAdminFirestore();
  const callerSnap = await db.doc(`userProfiles/${decoded.uid}`).get();
  const caller = callerSnap.data();
  const isSiteAdmin =
    caller?.isSiteAdmin === true || caller?.roles?.includes('Site Admin') === true;
  if (!isSiteAdmin) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { db, decoded, caller };
}

/**
 * Reads the inquiry delivery config (`systemConfig/inquiries`) server-side. Site Admin only.
 * The settings page fetches this instead of reading systemConfig from the browser, matching
 * the Stripe-status pattern — client-side systemConfig reads are blocked by Firestore rules.
 */
export async function GET(req: Request) {
  try {
    const auth = await requireSiteAdmin(req);
    if ('error' in auth) return auth.error;
    const snap = await auth.db.doc('systemConfig/inquiries').get();
    const config: InquiryDeliveryConfig = snap.exists ? (snap.data() as InquiryDeliveryConfig) : {};
    return NextResponse.json(config);
  } catch (err: any) {
    console.error('[inquiry-config GET] error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * Writes the Site-Admin-managed inquiry delivery config (`systemConfig/inquiries`):
 * master CC, per-topic ad-hoc recipients, and per-sport fallbacks. Site Admin only.
 * Writes go through the Admin SDK (Firestore rules deny client writes to systemConfig).
 */
export async function POST(req: Request) {
  try {
    const auth = await requireSiteAdmin(req);
    if ('error' in auth) return auth.error;
    const { db, decoded, caller } = auth;

    const body = await req.json();

    // Build the config defensively — only known sports/topics are accepted.
    const alwaysCcEmails = parseEmails(body?.alwaysCcEmails);

    const topicOverrides: InquiryDeliveryConfig['topicOverrides'] = {};
    const rawOverrides = body?.topicOverrides ?? {};
    for (const sport of SPORTS) {
      const sportMap = rawOverrides?.[sport];
      if (!sportMap) continue;
      const cleaned: Partial<Record<InquiryTopic, string[]>> = {};
      for (const [topic, value] of Object.entries(sportMap)) {
        if (!TOPIC_VALUES.has(topic)) continue;
        const emails = parseEmails(value);
        if (emails.length) cleaned[topic as InquiryTopic] = emails;
      }
      if (Object.keys(cleaned).length) topicOverrides![sport] = cleaned;
    }

    const fallbackEmails: InquiryDeliveryConfig['fallbackEmails'] = {};
    const rawFallback = body?.fallbackEmails ?? {};
    for (const key of [...SPORTS, 'all'] as const) {
      const emails = parseEmails(rawFallback?.[key]);
      if (emails.length) fallbackEmails![key] = emails;
    }

    const config: InquiryDeliveryConfig = {
      alwaysCcEmails,
      topicOverrides,
      fallbackEmails,
      updatedAt: new Date().toISOString(),
      updatedByUid: decoded.uid,
      updatedByName: caller?.displayName ?? caller?.email ?? '',
    };

    // Full overwrite (not merge): the editor submits the complete config, so cleared
    // topic/fallback entries should disappear rather than linger as stale nested keys.
    await db.doc('systemConfig/inquiries').set(config);

    return NextResponse.json({ ok: true, ...config });
  } catch (err: any) {
    console.error('[inquiry-config] error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
