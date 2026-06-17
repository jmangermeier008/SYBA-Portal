import Stripe from 'stripe';
import { getAdminFirestore } from '@/lib/firebase-admin';

/**
 * Runtime Stripe environment selection.
 *
 * The active mode lives in Firestore (`systemConfig/stripe`) so a Site Admin can flip
 * the live site between Test and Live payments without an env change or redeploy. The
 * mode-specific keys (…_TEST / …_LIVE) fall back to the legacy single keys so nothing
 * breaks before they are populated.
 *
 * SAFETY: if the config doc is missing, malformed, or unreadable we default to
 * 'sandbox' — a config failure must never silently put the site into live mode.
 */

export type StripeMode = 'sandbox' | 'production';

export interface StripeSystemConfig {
  mode: StripeMode;
  updatedAt: string;
  updatedBy: string;
  updatedByName?: string;
}

const CONFIG_PATH = 'systemConfig/stripe';

// Per-instance cache so we don't read Firestore on every checkout/webhook call.
// A mode change propagates within CACHE_TTL_MS on each warm serverless instance.
const CACHE_TTL_MS = 30_000;
let cachedMode: StripeMode | null = null;
let cachedAt = 0;

/** Force the next getStripeMode() to re-read Firestore (called after a mode write). */
export function invalidateStripeModeCache(): void {
  cachedMode = null;
  cachedAt = 0;
}

/** Resolve the active Stripe mode from Firestore, defaulting to 'sandbox' on any problem. */
export async function getStripeMode(): Promise<StripeMode> {
  if (cachedMode && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedMode;
  }
  let mode: StripeMode = 'sandbox';
  try {
    const snap = await getAdminFirestore().doc(CONFIG_PATH).get();
    const data = snap.exists ? (snap.data() as Partial<StripeSystemConfig>) : null;
    if (data?.mode === 'production') mode = 'production';
  } catch (err: any) {
    console.error('[stripe-config] Could not read mode, defaulting to sandbox:', err?.message);
    mode = 'sandbox';
  }
  cachedMode = mode;
  cachedAt = Date.now();
  return mode;
}

/** Read the full config doc (for the admin UI / status route). Returns null if unset. */
export async function getStripeConfig(): Promise<StripeSystemConfig | null> {
  try {
    const snap = await getAdminFirestore().doc(CONFIG_PATH).get();
    if (!snap.exists) return null;
    const data = snap.data() as Partial<StripeSystemConfig>;
    return {
      mode: data.mode === 'production' ? 'production' : 'sandbox',
      updatedAt: data.updatedAt ?? '',
      updatedBy: data.updatedBy ?? '',
      updatedByName: data.updatedByName ?? '',
    };
  } catch (err: any) {
    console.error('[stripe-config] Could not read config:', err?.message);
    return null;
  }
}

function secretKeyForMode(mode: StripeMode): string | undefined {
  const specific =
    mode === 'production'
      ? process.env.STRIPE_SECRET_KEY_LIVE
      : process.env.STRIPE_SECRET_KEY_TEST;
  return specific || process.env.STRIPE_SECRET_KEY;
}

/** Build a Stripe client for the currently active mode. */
export async function getStripeClient(): Promise<{ stripe: Stripe; mode: StripeMode }> {
  const mode = await getStripeMode();
  const key = secretKeyForMode(mode);
  if (!key) {
    throw new Error(`Stripe secret key not configured for ${mode} mode`);
  }
  return { stripe: new Stripe(key), mode };
}

/** Build a Stripe client for an explicit mode (e.g. from a verified webhook's livemode flag). */
export function getStripeClientForMode(mode: StripeMode): Stripe {
  const key = secretKeyForMode(mode);
  if (!key) {
    throw new Error(`Stripe secret key not configured for ${mode} mode`);
  }
  return new Stripe(key);
}

/**
 * All webhook signing secrets that may be present, deduped. Stripe signs each event with
 * the Dashboard endpoint's own secret (test endpoint ≠ live endpoint), independent of our
 * runtime mode — so the webhook route must try every secret we have.
 */
export function getWebhookSecrets(): string[] {
  const candidates = [
    process.env.STRIPE_WEBHOOK_SECRET_LIVE,
    process.env.STRIPE_WEBHOOK_SECRET_TEST,
    process.env.STRIPE_WEBHOOK_SECRET,
  ].filter((s): s is string => !!s);
  return [...new Set(candidates)];
}

/** Which key sets are present in the environment — surfaced to the admin UI. */
export function getModeKeyStatus(): {
  testConfigured: boolean;
  liveConfigured: boolean;
  legacyConfigured: boolean;
} {
  return {
    testConfigured: !!process.env.STRIPE_SECRET_KEY_TEST,
    liveConfigured: !!process.env.STRIPE_SECRET_KEY_LIVE,
    legacyConfigured: !!process.env.STRIPE_SECRET_KEY,
  };
}
