import { getAdminFirestore } from '@/lib/firebase-admin';
import { getTopicConfig } from '@/data/inquiry-topics';
import { SPORT_CONFIG } from '@/config/sports';
import type { Sport } from '@/types/scheduling';

async function getRecipientEmails(assignedToRole: string): Promise<string[]> {
  const db = getAdminFirestore();
  const snap = await db.collection('userProfiles')
    .where('officerTitles', 'array-contains', assignedToRole)
    .get();

  const emails: string[] = [];
  snap.forEach(doc => {
    const email = doc.data().email;
    if (email) emails.push(email);
  });
  return emails;
}

export interface InquiryNotificationResult {
  ok: boolean;
  skipped?: boolean;
  error?: string;
}

/**
 * Emails the assigned board member(s) about an inquiry, building the message
 * exclusively from the Firestore document — never from caller-supplied content,
 * so the HTTP route that fronts this cannot be used as an email-forgery relay.
 *
 * A transactional `notificationSentAt` claim on the inquiry doc guarantees at
 * most one notification per inquiry, no matter how often this is called.
 */
export async function sendInquiryNotification(inquiryId: string): Promise<InquiryNotificationResult> {
  const db = getAdminFirestore();
  const ref = db.collection('inquiries').doc(inquiryId);

  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const data = snap.data() as Record<string, any>;
    if (data.notificationSentAt) return 'already-sent' as const;
    tx.update(ref, { notificationSentAt: new Date().toISOString() });
    return data;
  });

  if (claimed === null) return { ok: false, error: 'Inquiry not found' };
  if (claimed === 'already-sent') return { ok: true, skipped: true };

  const inquiry = claimed;
  const assignedToRole: string = inquiry.assignedToRole ?? 'Secretary';
  const topicLabel = getTopicConfig(inquiry.topic)?.label ?? inquiry.topic ?? 'General';
  const sport: string | undefined = inquiry.sport;

  const recipients = await getRecipientEmails(assignedToRole);
  if (recipients.length === 0) {
    const fallback = process.env.INQUIRY_NOTIFICATION_EMAIL;
    if (!fallback) {
      console.warn('[inquiry-notification] No recipients found for role and no fallback configured, skipping');
      return { ok: true, skipped: true };
    }
    recipients.push(fallback);
  }

  const siteAdminEmail = process.env.INQUIRY_EMAIL_SITE_ADMIN;
  if (siteAdminEmail && !recipients.includes(siteAdminEmail)) {
    recipients.push(siteAdminEmail);
  }

  const appUrl = process.env.NEXT_PUBLIC_BASE_URL ?? '';
  const portalUrl = `${appUrl}/admin/inquiries?id=${inquiryId}`;

  const sportConfig = sport === 'baseball' || sport === 'football'
    ? SPORT_CONFIG[sport as Sport]
    : null;
  const subjectPrefix = sportConfig ? `[${sportConfig.acronym} ${sportConfig.label}] ` : '';
  const replyTo = sportConfig?.contactEmail;
  const emailSubject = `${subjectPrefix}[${topicLabel}] New Inquiry: ${inquiry.subject ?? '(no subject)'}`;
  const emailBody = [
    `New inquiry received.`,
    ``,
    `From:    ${inquiry.senderName ?? inquiry.senderEmail ?? 'Unknown'}`,
    `Topic:   ${topicLabel}`,
    `Subject: ${inquiry.subject ?? '(no subject)'}`,
    ``,
    `--- Message ---`,
    inquiry.message ?? '',
    `---------------`,
    ``,
    `Reply in Portal: ${portalUrl}`,
  ].join('\n');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL ?? 'SYBA Portal <notifications@syba.blue>',
      to: recipients,
      ...(replyTo ? { reply_to: replyTo } : {}),
      subject: emailSubject,
      text: emailBody,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('[inquiry-notification] Resend error:', err);
    // Release the claim so a retry can attempt the send again.
    await ref.update({ notificationSentAt: null }).catch(() => {});
    return { ok: false, error: err };
  }

  return { ok: true };
}
