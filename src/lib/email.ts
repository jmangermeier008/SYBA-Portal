// Server-side confirmation email sender, shared by the /api/email/confirmation
// route and the Stripe webhook (which calls it directly rather than over HTTP
// so it works regardless of NEXT_PUBLIC_BASE_URL).

export interface ConfirmationEmailParams {
  toEmail: string;
  playerName: string;
  seasonName: string;
  divisionName: string;
  isWaitlisted?: boolean;
  feeWaived?: boolean;
  /** A spot opened and an admin moved this player off the waitlist — payment now due. */
  waitlistPromoted?: boolean;
  sport?: string;
}

function sportPrefix(sport?: string): string {
  if (sport === 'baseball') return '[SYBA Baseball] ';
  if (sport === 'football') return '[SYFA Football] ';
  return '';
}

export async function sendConfirmationEmail(params: ConfirmationEmailParams): Promise<{ ok: boolean; error?: string }> {
  const { toEmail, playerName, seasonName, divisionName, isWaitlisted, feeWaived, waitlistPromoted, sport } = params;

  if (!toEmail) {
    return { ok: false, error: 'Missing toEmail' };
  }

  const prefix = sportPrefix(sport);
  const subject = waitlistPromoted
    ? `${prefix}A Spot Opened Up — ${seasonName} ${divisionName}`
    : isWaitlisted
    ? `${prefix}Waitlist Confirmation — ${seasonName} ${divisionName}`
    : `${prefix}Registration Confirmed — ${seasonName} ${divisionName}`;

  const body = waitlistPromoted
    ? `Great news! A spot opened up in ${divisionName} for ${seasonName}, and ${playerName} has been moved off the waitlist. Please log in to the portal and complete the registration payment to lock in the spot.`
    : isWaitlisted
    ? `Hi! You've been added to the waitlist for ${divisionName} in ${seasonName} for ${playerName}. We'll reach out when a spot opens up.`
    : feeWaived
    ? `Hi! ${playerName}'s registration for ${divisionName} in ${seasonName} is complete. Your registration fee has been waived.`
    : `Hi! ${playerName}'s registration for ${divisionName} in ${seasonName} is complete. Thank you for your payment!`;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      // Loop marker — the inbound-email webhook drops portal-sent mail
      headers: { 'X-SYBA-Mailer': 'portal' },
      from: process.env.RESEND_FROM_EMAIL ?? 'SYBA Portal <onboarding@resend.dev>',
      to: [toEmail],
      subject,
      text: body,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('[email] Resend error:', err);
    return { ok: false, error: err };
  }

  return { ok: true };
}
