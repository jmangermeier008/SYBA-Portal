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
  'vicepresident@syba.blue': 'Secretary',
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

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Resend inbound email payload fields
    const fromRaw: string = body.from ?? '';
    const toRaw: string | string[] = body.to ?? '';
    const subject: string = body.subject ?? '(no subject)';
    const text: string = body.text ?? body.html ?? '(no message body)';

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
