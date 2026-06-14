import { NextResponse } from 'next/server';
import { getStripeConfig, getModeKeyStatus } from '@/lib/stripe-config';

export async function GET() {
  const keyStatus = getModeKeyStatus();
  const config = await getStripeConfig();
  // 'configured' stays true when any usable key set is present (back-compat with the
  // existing settings UI), and we surface the active mode + per-mode availability.
  const configured =
    keyStatus.legacyConfigured || keyStatus.testConfigured || keyStatus.liveConfigured;
  return NextResponse.json({
    configured,
    mode: config?.mode ?? 'sandbox',
    // Per-mode flags reflect DEDICATED keys only — never the legacy fallback. Switching
    // is only safe/meaningful when the target mode has its own key, otherwise the toggle
    // would relabel the mode without actually changing which key is used.
    testConfigured: keyStatus.testConfigured,
    liveConfigured: keyStatus.liveConfigured,
    updatedAt: config?.updatedAt ?? '',
    updatedBy: config?.updatedBy ?? '',
    updatedByName: config?.updatedByName ?? '',
  });
}
