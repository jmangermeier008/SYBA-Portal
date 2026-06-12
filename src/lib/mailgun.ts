import { createHmac, timingSafeEqual } from 'crypto';

/** Maximum allowed age of a webhook timestamp, in seconds (replay-attack guard). */
export const MAILGUN_TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

export interface MailgunSignatureFields {
  timestamp: string;
  token: string;
  signature: string;
}

/**
 * Verifies a Mailgun webhook signature.
 *
 * Mailgun signs every webhook with HMAC-SHA256 over `timestamp + token` using
 * the account's webhook signing key (Mailgun dashboard → Sending → Webhooks →
 * "HTTP webhook signing key" — distinct from the API key).
 *
 * Returns false for missing fields, malformed hex, stale timestamps, or
 * signature mismatch. Uses timingSafeEqual to avoid timing side channels.
 */
export function verifyMailgunSignature(
  fields: Partial<MailgunSignatureFields>,
  signingKey: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): boolean {
  const { timestamp, token, signature } = fields;
  if (!signingKey || !timestamp || !token || !signature) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(nowSeconds - ts) > MAILGUN_TIMESTAMP_TOLERANCE_SECONDS) return false;

  const expected = createHmac('sha256', signingKey)
    .update(timestamp + token)
    .digest('hex');

  const expectedBuf = Buffer.from(expected, 'hex');
  let providedBuf: Buffer;
  try {
    providedBuf = Buffer.from(signature, 'hex');
  } catch {
    return false;
  }
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}
