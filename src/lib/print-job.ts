import type { WaiverPrintEntry } from '@/components/registration/ShenangoValleyWaiverPrintable';
import type { ClearanceState } from '@/lib/clearances';

export interface RosterPrintRow {
  playerName: string;
  dateOfBirth: string;
  parentName: string;
  parentPhone: string;
  weight: string;
  assignment: string;
}

export interface EquipmentChaseRow {
  playerName: string;
  division: string;
  items: string[];       // e.g. ["Helmet #H-014", "Shoulder Pads #SP-022"]
  parentName: string;
  parentPhone: string;
  parentEmail: string;
}

/** One volunteer's row on the compliance summary sheet. */
export interface CompliancePrintRow {
  name: string;
  email: string;
  /** One cell per CLEARANCE_TYPES entry, in that order. */
  cells: { state: ClearanceState; expirationDate?: string }[];
}

export type PrintJobPayload =
  | { kind: 'waivers'; entries: WaiverPrintEntry[] }
  | { kind: 'roster'; title: string; subtitle?: string; rows: RosterPrintRow[]; showWeight: boolean }
  | { kind: 'equipment-chase'; title: string; subtitle?: string; rows: EquipmentChaseRow[] }
  | { kind: 'compliance'; title: string; subtitle?: string; columns: string[]; rows: CompliancePrintRow[] };

const KEY_PREFIX = 'syba:print:';

/**
 * Hands the payload to the dedicated /print tab via localStorage and opens
 * the tab. Must be called synchronously inside a click handler so the
 * browser treats window.open as user-initiated.
 *
 * Printing happens in its own tab with the content visible because mobile
 * browsers (Android Chrome especially) render blank pages when asked to
 * print content that is display:none on screen, and silently drop
 * window.print() calls made too long after the originating tap.
 */
export function openPrintTab(payload: PrintJobPayload) {
  // Prune handoffs from earlier jobs before stashing the new one
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key?.startsWith(KEY_PREFIX)) localStorage.removeItem(key);
  }
  const jobId = Date.now().toString(36);
  localStorage.setItem(`${KEY_PREFIX}${jobId}`, JSON.stringify(payload));
  window.open(`/print?job=${jobId}`, '_blank');
}

export function readPrintJob(jobId: string): PrintJobPayload | null {
  try {
    const raw = localStorage.getItem(`${KEY_PREFIX}${jobId}`);
    return raw ? (JSON.parse(raw) as PrintJobPayload) : null;
  } catch {
    return null;
  }
}
