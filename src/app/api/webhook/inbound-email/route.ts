import { NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebase-admin';
import { getTopicConfig } from '@/data/inquiry-topics';
import type { InquiryTopic } from '@/data/inquiry-topics';
import { verifyMailgunSignature } from '@/lib/mailgun';
import { sendInquiryNotification } from '@/lib/inquiry-notification';


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
    // Mailgun sends multipart/form-data with full email content including body
    const formData = await req.formData();

    // Reject anything not signed by Mailgun — without this check, anyone who
    // discovers the URL can inject forged inquiries and trigger board emails.
    const signingKey = process.env.MAILGUN_WEBHOOK_SIGNING_KEY ?? '';
    if (!signingKey) {
      console.error('[inbound-email] MAILGUN_WEBHOOK_SIGNING_KEY is not configured — rejecting all inbound mail');
      return NextResponse.json({ ok: false, error: 'Webhook not configured' }, { status: 503 });
    }
    const signatureValid = verifyMailgunSignature(
      {
        timestamp: (formData.get('timestamp') as string) ?? '',
        token: (formData.get('token') as string) ?? '',
        signature: (formData.get('signature') as string) ?? '',
      },
      signingKey
    );
    if (!signatureValid) {
      console.warn('[inbound-email] Rejected request with missing/invalid Mailgun signature');
      return NextResponse.json({ ok: false, error: 'Invalid signature' }, { status: 401 });
    }

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

    const db = getAdminFirestore();

    // Look up officer record by @syba.blue address to determine topic and assignedToRole dynamically
    let topic: InquiryTopic = 'general';
    let assignedToRole = 'Secretary';

    const officerSnap = await db.collection('officers')
      .where('email', '==', recipientEmail)
      .limit(1)
      .get();

    if (!officerSnap.empty) {
      const officer = officerSnap.docs[0].data();
      assignedToRole = officer.title ?? 'Secretary';
      topic = (officer.mappedTopic as InquiryTopic) ?? 'general';
    }

    const topicConfig = getTopicConfig(topic);
    if (!topicConfig) {
      return NextResponse.json({ ok: false, error: 'Unknown topic' }, { status: 400 });
    }

    const now = new Date().toISOString();
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

    // Notify the assigned board member after the confirmed Firestore write.
    // Direct library call — same process, no HTTP round-trip needed.
    try {
      const notifyResult = await sendInquiryNotification(docRef.id);
      if (notifyResult.ok) {
        console.log('[inbound-email] Notification sent', notifyResult.skipped ? '(skipped)' : '');
      } else {
        console.error('[inbound-email] Notification failed:', notifyResult.error);
      }
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
