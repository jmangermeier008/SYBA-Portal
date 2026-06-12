import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import {
  verifyMailgunSignature,
  MAILGUN_TIMESTAMP_TOLERANCE_SECONDS,
} from '@/lib/mailgun';

const KEY = 'test-signing-key';

function sign(timestamp: string, token: string, key: string = KEY): string {
  return createHmac('sha256', key).update(timestamp + token).digest('hex');
}

describe('verifyMailgunSignature', () => {
  const now = 1_750_000_000;
  const timestamp = String(now);
  const token = 'a-random-mailgun-token';

  it('accepts a correctly signed payload', () => {
    const fields = { timestamp, token, signature: sign(timestamp, token) };
    expect(verifyMailgunSignature(fields, KEY, now)).toBe(true);
  });

  it('rejects a signature produced with a different key', () => {
    const fields = { timestamp, token, signature: sign(timestamp, token, 'wrong-key') };
    expect(verifyMailgunSignature(fields, KEY, now)).toBe(false);
  });

  it('rejects a tampered token', () => {
    const fields = { timestamp, token: 'forged-token', signature: sign(timestamp, token) };
    expect(verifyMailgunSignature(fields, KEY, now)).toBe(false);
  });

  it('rejects missing fields', () => {
    expect(verifyMailgunSignature({}, KEY, now)).toBe(false);
    expect(verifyMailgunSignature({ timestamp, token }, KEY, now)).toBe(false);
    expect(verifyMailgunSignature({ timestamp, signature: 'abc' }, KEY, now)).toBe(false);
  });

  it('rejects an empty signing key', () => {
    const fields = { timestamp, token, signature: sign(timestamp, token, '') };
    expect(verifyMailgunSignature(fields, '', now)).toBe(false);
  });

  it('rejects a stale timestamp (replay guard)', () => {
    const staleTs = String(now - MAILGUN_TIMESTAMP_TOLERANCE_SECONDS - 1);
    const fields = { timestamp: staleTs, token, signature: sign(staleTs, token) };
    expect(verifyMailgunSignature(fields, KEY, now)).toBe(false);
  });

  it('accepts a timestamp just inside the tolerance window', () => {
    const ts = String(now - MAILGUN_TIMESTAMP_TOLERANCE_SECONDS + 5);
    const fields = { timestamp: ts, token, signature: sign(ts, token) };
    expect(verifyMailgunSignature(fields, KEY, now)).toBe(true);
  });

  it('rejects a non-numeric timestamp', () => {
    const fields = { timestamp: 'not-a-number', token, signature: sign('not-a-number', token) };
    expect(verifyMailgunSignature(fields, KEY, now)).toBe(false);
  });

  it('rejects malformed hex and wrong-length signatures without throwing', () => {
    expect(verifyMailgunSignature({ timestamp, token, signature: 'zzzz' }, KEY, now)).toBe(false);
    expect(verifyMailgunSignature({ timestamp, token, signature: 'abcd' }, KEY, now)).toBe(false);
  });
});
