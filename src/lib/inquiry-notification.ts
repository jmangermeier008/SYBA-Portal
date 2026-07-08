import { getAdminFirestore } from '@/lib/firebase-admin';
import { getTopicConfig } from '@/data/inquiry-topics';
import type { InquiryTopic } from '@/data/inquiry-topics';
import { SPORT_CONFIG } from '@/config/sports';
import type { Sport, InquiryDeliveryConfig } from '@/types/scheduling';

/** Case-insensitive de-dupe of email addresses, preserving the first-seen original casing. */
function dedupeEmails(emails: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of emails) {
    const email = (raw ?? '').trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

/**
 * Resolves the role-based recipients for an inquiry:
 *  1. Officer directory emails — any `officers` doc for this sport whose `handlesTopics`
 *     contains the topic, plus the doc whose `title` matches `assignedToRole` (back-compat
 *     for inbound email, which sets a title directly). This is what makes the Settings
 *     "Email" field actually control where web-form inquiries go.
 *  2. Title holders — login accounts whose `officerTitles` includes the role, so a titled
 *     person with a blank directory email still gets the mail.
 */
async function getRoleRecipientEmails(
  assignedToRole: string,
  topic: string,
  sport: Sport | undefined,
): Promise<string[]> {
  const db = getAdminFirestore();
  const emails: string[] = [];

  // 1. Officer directory — scope by sport when known, otherwise match across sports.
  const officersRef = db.collection('officers');
  const officerQueries = [
    sport ? officersRef.where('sport', '==', sport) : officersRef,
  ];
  for (const q of officerQueries) {
    const snap = await q.get();
    snap.forEach(doc => {
      const data = doc.data();
      const email = data.email;
      if (!email) return;
      const handles: string[] = Array.isArray(data.handlesTopics) ? data.handlesTopics : [];
      if (handles.includes(topic) || data.title === assignedToRole) {
        emails.push(email);
      }
    });
  }

  // 2. Title holders (login accounts).
  const holders = await db.collection('userProfiles')
    .where('officerTitles', 'array-contains', assignedToRole)
    .get();
  holders.forEach(doc => {
    const email = doc.data().email;
    if (email) emails.push(email);
  });

  return emails;
}

async function getDeliveryConfig(): Promise<InquiryDeliveryConfig | null> {
  try {
    const db = getAdminFirestore();
    const snap = await db.doc('systemConfig/inquiries').get();
    return snap.exists ? (snap.data() as InquiryDeliveryConfig) : null;
  } catch (err) {
    console.warn('[inquiry-notification] Could not read systemConfig/inquiries, falling back to env:', err);
    return null;
  }
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
  const topic: string = inquiry.topic ?? 'general';
  const topicLabel = getTopicConfig(inquiry.topic)?.label ?? inquiry.topic ?? 'General';
  const sport: Sport | undefined =
    inquiry.sport === 'baseball' || inquiry.sport === 'football' ? inquiry.sport : undefined;

  const config = await getDeliveryConfig();

  // Primary delivery: role/directory emails + title holders + admin-set per-topic ad-hoc emails.
  const recipients: string[] = await getRoleRecipientEmails(assignedToRole, topic, sport);
  const adHoc = sport
    ? config?.topicOverrides?.[sport]?.[topic as InquiryTopic] ?? []
    : [];
  recipients.push(...adHoc);

  // Nothing resolved → admin-managed per-sport fallback, then env backstop.
  if (recipients.length === 0) {
    const sportFallback = sport ? config?.fallbackEmails?.[sport] ?? [] : [];
    const allFallback = config?.fallbackEmails?.all ?? [];
    recipients.push(...sportFallback, ...allFallback);
    if (recipients.length === 0) {
      const envFallback = process.env.INQUIRY_NOTIFICATION_EMAIL;
      if (envFallback) recipients.push(envFallback);
    }
    if (recipients.length === 0) {
      console.warn('[inquiry-notification] No recipients found for role and no fallback configured, skipping');
      // Release the claim so a later retry (e.g. after config is set) can still deliver.
      await ref.update({ notificationSentAt: null }).catch(() => {});
      return { ok: true, skipped: true };
    }
  }

  // Master CC: admin-managed catch-all + env backstop — added to every inquiry.
  recipients.push(...(config?.alwaysCcEmails ?? []));
  const siteAdminEmail = process.env.INQUIRY_EMAIL_SITE_ADMIN;
  if (siteAdminEmail) recipients.push(siteAdminEmail);

  const finalRecipients = dedupeEmails(recipients);

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
      // Loop marker — the inbound-email webhook drops portal-sent mail. This
      // send goes to officer @syba.blue aliases that route back through the
      // webhook, so without the marker it would loop (2026-07-09 incident).
      headers: { 'X-SYBA-Mailer': 'portal' },
      from: process.env.RESEND_FROM_EMAIL ?? 'SYBA Portal <notifications@syba.blue>',
      to: finalRecipients,
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
