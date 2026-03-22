import { NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebase-admin';
import { getTopicConfig } from '@/data/inquiry-topics';
import type { InquiryTopic } from '@/data/inquiry-topics';

// Maps syba.blue recipient address → inquiry topic
const INBOUND_TOPIC_MAP: Record<string, InquiryTopic> = {
  'registration@syba.blue': 'registration',
  'concessions@syba.blue': 'concessions',
  'treasurer@syba.blue': 'general',
  'secretary@syba.blue': 'registration',
  'president@syba.blue': 'general',
  'vicepresident@syba.blue': 'general',
  'grounds@syba.blue': 'field_maintenance',
  'admin@syba.blue': 'general',
  'info@syba.blue': 'general',
};

// Override assignedToRole for specific inbound addresses (takes precedence over topic-derived role)
const INBOUND_ROLE_OVERRIDE_MAP: Record<string, string> = {
  'vicepresident@syba.blue': 'Vice President',
  'treasurer@syba.blue': 'Finance Committee Chair',
  'grounds@syba.blue': 'Building/Grounds Committee Chair',
  'admin@syba.blue': 'Site Admin',
};

function parseEmailAddress(raw: string): { name: string; email: string } {
  // Handles "First Last <email@domain.com>" or plain "email@domain.com"
  const match = raw.match(/^(?:"?([^"<]*)"?\s*)?<([^>]+)>$/);
  if (match) {
    return { name: match[1]?.trim() || match[2], email: match[2].trim().toLowerCase() };
  }
  return { name: raw.trim(), email: raw.trim().toLowerCase() };
}

function normalizeEmail(raw: string): string {
  const { email } = parseEmailAddress(raw);
  return email;
}

export async function GET() {
  const keySet = !!process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  let firestoreOk = false;
  let firestoreError = '';
  if (keySet) {
    try {
      const db = getAdminFirestore();
      await db.collection('inquiries').limit(1).get();
      firestoreOk = true;
    } catch (e: any) {
      firestoreError = e.message;
    }
  }
  return NextResponse.json({
    ok: keySet && firestoreOk,
    FIREBASE_SERVICE_ACCOUNT_KEY: keySet ? 'set' : 'MISSING',
    firestore: firestoreOk ? 'connected' : `error: ${firestoreError}`,
    topicMap: INBOUND_TOPIC_MAP,
    roleOverrideMap: INBOUND_ROLE_OVERRIDE_MAP,
  });
}

export async function POST(req: Request) {
  try {
    // Read raw body as text first so we can see exactly what Resend sends
    const rawBody = await req.text();
    const contentType = req.headers.get('content-type') ?? '';
    console.log('[inbound-email] Content-Type', contentType);
    console.log('[inbound-email] RAW BODY (first 1000 chars)', rawBody.slice(0, 1000));

    // Try JSON first, then URL-encoded form data
    let body: any = {};
    try {
      body = JSON.parse(rawBody);
    } catch {
      try {
        const params = new URLSearchParams(rawBody);
        body = Object.fromEntries(params.entries());
      } catch {
        // Body stays as empty object — logs will reveal what was sent
      }
    }

    console.log('[inbound-email] PARSED BODY KEYS', JSON.stringify(Object.keys(body?.data ?? body)));
    console.log('[inbound-email] PARSED BODY', JSON.stringify(body));

    // Resend inbound email payload wraps fields inside body.data
    const data = body.data ?? body;
    const fromRaw: string = data.from ?? '';
    const toRaw: string | string[] = data.to ?? '';
    const subject: string = data.subject ?? '(no subject)';

    // Try all common field names for the plain-text body
    const rawText: string | undefined = data.text ?? data.plain ?? data.body ?? data.content;
    const rawHtml: string | undefined = data.html;

    // Strip HTML tags to produce readable plain text when only HTML is available
    function stripHtml(html: string): string {
      return html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim();
    }

    const text: string = rawText?.trim()
      ? rawText.trim()
      : rawHtml
      ? stripHtml(rawHtml)
      : '(no message body)';

    console.log('[inbound-email] Webhook called', JSON.stringify({ from: fromRaw, to: toRaw, subject, textSnippet: text?.slice(0, 100) }));

    const { name: senderName, email: senderEmail } = parseEmailAddress(fromRaw);

    // Determine recipient — use first address in the "to" field
    const recipientRaw = Array.isArray(toRaw) ? toRaw[0] : toRaw;
    const recipientEmail = normalizeEmail(recipientRaw);

    const topic: InquiryTopic = INBOUND_TOPIC_MAP[recipientEmail] ?? 'general';
    const topicConfig = getTopicConfig(topic);
    if (!topicConfig) {
      return NextResponse.json({ ok: false, error: 'Unknown topic' }, { status: 400 });
    }

    const db = getAdminFirestore();
    const now = new Date().toISOString();

    await db.collection('inquiries').add({
      senderId: null,
      senderName: senderName || senderEmail,
      senderEmail,
      senderRole: 'Email',
      topic,
      subject: subject.slice(0, 100),
      message: text.trim(),
      messageHtml: rawHtml ?? null,
      status: 'open',
      assignedToRole: INBOUND_ROLE_OVERRIDE_MAP[recipientEmail] ?? topicConfig.assignedToRole,
      createdAt: now,
      updatedAt: now,
      resolvedAt: null,
      replies: [],
      inboundRecipient: recipientEmail,
    });

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[inbound-email] Error:', error.message);
    // Return 200 so Resend doesn't retry indefinitely on misconfiguration
    return NextResponse.json({ ok: false, error: error.message }, { status: 200 });
  }
}
