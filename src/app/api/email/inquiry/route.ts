import { NextResponse } from 'next/server';
import { sendInquiryNotification } from '@/lib/inquiry-notification';

/**
 * POST /api/email/inquiry
 *
 * Notifies the assigned board member(s) about an inquiry. Accepts only an
 * `inquiryId` — the email content is built server-side from the Firestore
 * document, and a notify-once flag on the doc caps repeat calls, so this
 * endpoint can stay open to the public contact form without becoming an
 * email-forgery or spam relay.
 */
export async function POST(req: Request) {
  try {
    const { inquiryId } = await req.json();

    if (!inquiryId || typeof inquiryId !== 'string') {
      return NextResponse.json({ error: 'Missing inquiryId' }, { status: 400 });
    }

    const result = await sendInquiryNotification(inquiryId);
    if (!result.ok) {
      const status = result.error === 'Inquiry not found' ? 404 : 500;
      return NextResponse.json({ ok: false, error: result.error }, { status });
    }
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[email] Inquiry notification error:', error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
