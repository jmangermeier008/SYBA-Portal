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
  });
}

export async function POST(req: Request) {
  try {
    // Mailgun sends multipart/form-data with full email content including body
    const formData = await req.formData();

    const fromRaw: string = (formData.get('sender') as string) ?? '';
    const toRaw: string = (formData.get('recipient') as string) ?? '';
    const subject: string = (formData.get('subject') as string) ?? '(no subject)';

    // 'stripped-text' removes quoted reply chains — cleaner for portal display
    const rawText: string =
      (formData.get('stripped-text') as string) ||
      (formData.get('body-plain') as string) ||
      '';
    const rawHtml: string = (formData.get('body-html') as string) || '';

    // Strip HTML tags to produce readable plain text when only HTML is available
    function stripHtml(html: string): string {
      return html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim();
    }

    const text: string = rawText.trim()
      ? rawText.trim()
      : rawHtml
      ? stripHtml(rawHtml)
      : '(no message body)';

    console.log('[inbound-email] Webhook called', JSON.stringify({ from: fromRaw, to: toRaw, subject, textSnippet: text.slice(0, 100) }));

    const { name: senderName, email: senderEmail } = parseEmailAddress(fromRaw);
    const recipientEmail = normalizeEmail(toRaw);

    const topic: InquiryTopic = INBOUND_TOPIC_MAP[recipientEmail] ?? 'general';
    const topicConfig = getTopicConfig(topic);
    if (!topicConfig) {
      return NextResponse.json({ ok: false, error: 'Unknown topic' }, { status: 400 });
    }

    const db = getAdminFirestore();
    const now = new Date().toISOString();

    const assignedToRole = INBOUND_ROLE_OVERRIDE_MAP[recipientEmail] ?? topicConfig.assignedToRole;
    const message = text.trim();

    const docRef = await db.collection('inquiries').add({
      senderId: null,
      senderName: senderName || senderEmail,
      senderEmail,
      senderRole: 'Email',
      topic,
      subject: subject.slice(0, 100),
      message,
      messageHtml: rawHtml || null,
      status: 'open',
      assignedToRole,
      createdAt: now,
      updatedAt: now,
      resolvedAt: null,
      replies: [],
      inboundRecipient: recipientEmail,
    });

    // Notify the assigned board member — fire-and-forget after confirmed Firestore write
    try {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
      await fetch(`${appUrl}/api/email/inquiry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderName: senderName || senderEmail,
          topic,
          subject: subject.slice(0, 100),
          message,
          assignedToRole,
          inquiryId: docRef.id,
        }),
      });
    } catch (notifyErr: any) {
      console.error('[inbound-email] Notification dispatch failed:', notifyErr.message);
      // Do not rethrow — record is saved, return 200 regardless
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[inbound-email] Error:', error.message);
    // Return 500 for infrastructure errors (Firestore down, etc.) so Mailgun retries.
    // Return 200 only for parse/mapping errors where retrying won't help.
    const isInfraError = error.code && (
      error.code === 'unavailable' ||
      error.code === 'deadline-exceeded' ||
      error.code === 'internal'
    );
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: isInfraError ? 500 : 200 }
    );
  }
}
