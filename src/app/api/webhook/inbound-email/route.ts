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

/** Mailgun's `message-headers` form field: JSON array of [name, value] pairs. */
function parseMessageHeaders(formData: FormData): Map<string, string> {
  try {
    const raw = (formData.get('message-headers') as string) ?? '';
    if (!raw) return new Map();
    const pairs = JSON.parse(raw) as [string, unknown][];
    const map = new Map<string, string>();
    for (const [name, value] of pairs) {
      map.set(String(name).toLowerCase(), String(value));
    }
    return map;
  } catch {
    return new Map();
  }
}

/** The portal's own outbound sending addresses — mail from OR to these must
 *  never become an inquiry (it's our own output echoing back through Mailgun). */
function portalOutboundAddresses(): string[] {
  return [normalizeEmail(process.env.RESEND_FROM_EMAIL ?? ''), 'onboarding@resend.dev'].filter(
    Boolean
  );
}

/**
 * Loop and robot filtering. The announcement incident (2026-07-09): portal
 * email addressed to our own domain re-entered through this webhook, became
 * an inquiry, whose notification email to an officer @syba.blue alias
 * re-entered again — an infinite loop that burned the day's Resend quota in
 * under a minute. Every guard below closes one link of that chain.
 * Returns a drop reason, or null when the mail is a real human inquiry.
 */
function dropReason(
  senderEmail: string,
  recipientEmail: string,
  headers: Map<string, string>
): string | null {
  const ours = portalOutboundAddresses();
  if (ours.includes(senderEmail)) return 'self-sent (portal outbound address)';
  if (ours.includes(recipientEmail)) return 'addressed to the portal outbound address';
  // Any mail the portal itself sent carries this marker (see X-SYBA-Mailer in
  // the Resend calls) — catches every possible loop regardless of addressing.
  if (headers.has('x-syba-mailer')) return 'portal-originated (loop marker header)';
  const autoSubmitted = headers.get('auto-submitted')?.toLowerCase() ?? '';
  if (autoSubmitted.startsWith('auto')) return 'auto-submitted (out-of-office/bounce)';
  if (headers.has('x-auto-response-suppress')) return 'auto-responder';
  const precedence = headers.get('precedence')?.toLowerCase() ?? '';
  if (['bulk', 'junk', 'auto_reply', 'auto-reply'].includes(precedence)) {
    return `precedence: ${precedence}`;
  }
  const senderLocal = senderEmail.split('@')[0];
  if (['mailer-daemon', 'postmaster', 'no-reply', 'noreply', 'bounce'].includes(senderLocal)) {
    return 'automated sender address';
  }
  return null;
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

    // Loop-breakers and robot filtering — return 200 so Mailgun does not retry.
    const reason = dropReason(senderEmail, recipientEmail, parseMessageHeaders(formData));
    if (reason) {
      console.warn(`[inbound-email] Dropped (${reason})`, JSON.stringify({ from: senderEmail, to: recipientEmail, subject }));
      return NextResponse.json({ ok: true, dropped: reason });
    }

    const db = getAdminFirestore();

    // Runaway brake: if one sender has produced 5+ inquiries in the last 10
    // minutes, something automated slipped past the filters — stop feeding it.
    // (Equality-only query — no composite index needed; recency counted in code.)
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const recentSnap = await db
      .collection('inquiries')
      .where('senderEmail', '==', senderEmail)
      .limit(50)
      .get();
    const recentCount = recentSnap.docs.filter(d => (d.data().createdAt ?? '') > tenMinutesAgo).length;
    if (recentCount >= 5) {
      console.warn(`[inbound-email] Dropped (rate limit: ${recentCount} inquiries in 10min)`, JSON.stringify({ from: senderEmail, subject }));
      return NextResponse.json({ ok: true, dropped: 'sender rate limit' });
    }

    // Look up officer record by @syba.blue address to determine topic and assignedToRole dynamically
    let topic: InquiryTopic = 'general';
    let assignedToRole = 'Secretary';
    // The admin inquiries page is sport-scoped — an inquiry with no sport is
    // invisible in the UI (bug found during the 2026-07-09 loop incident).
    let sport = 'baseball';
    if (recipientEmail === 'football@sharpsvillesports.com') sport = 'football';

    const officerSnap = await db.collection('officers')
      .where('email', '==', recipientEmail)
      .limit(1)
      .get();

    if (!officerSnap.empty) {
      const officer = officerSnap.docs[0].data();
      assignedToRole = officer.title ?? 'Secretary';
      topic = (officer.mappedTopic as InquiryTopic) ?? 'general';
      if (officer.sport === 'baseball' || officer.sport === 'football') sport = officer.sport;
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
      sport,
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
