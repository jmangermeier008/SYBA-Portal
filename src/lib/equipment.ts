/**
 * Shared football-equipment domain: types, the enrollment field map per item
 * type, and the issue/return write helpers. Used by the admin Equipment Manager
 * and the coach equipment page so both write identical shapes to
 * `userProfiles/{parent}/enrollments/{id}.footballEquipment.*` and
 * `equipmentInventory/{item}`.
 */
import {
  Timestamp,
  collection,
  deleteField,
  doc,
  getDoc,
  writeBatch,
  type Firestore,
  type WriteBatch,
} from 'firebase/firestore';

export type EquipmentStatus = 'not_issued' | 'issued' | 'returned';

export interface FootballEquipment {
  helmetSize?: string;
  helmetStatus?: EquipmentStatus;
  helmetInventoryId?: string;
  helmetTagNumber?: string;
  shoulderPadSize?: string;
  padStatus?: EquipmentStatus;
  padInventoryId?: string;
  padTagNumber?: string;
  jerseySize?: string;
  jerseyNumber?: string;
  gameJerseyStatus?: EquipmentStatus;
  gameJerseyInventoryId?: string;
  gameJerseyTagNumber?: string;
  // Historical note: this slot is SYFA's white game jersey. The `scrimmage`
  // field names are the original ones and are kept as-is — 85 inventory items
  // and every enrollment mirror reference them. The real scrimmage jersey is
  // the separate `scrimmageJersey2*` slot below.
  scrimmageJerseyStatus?: EquipmentStatus;
  scrimmageJerseyInventoryId?: string;
  scrimmageJerseyTagNumber?: string;
  scrimmageJersey2Status?: EquipmentStatus;
  scrimmageJersey2InventoryId?: string;
  scrimmageJersey2TagNumber?: string;
  practiceJerseyStatus?: EquipmentStatus;
  practiceJerseyInventoryId?: string;
  practiceJerseyTagNumber?: string;
  gamePantsSize?: string;
  gamePantsStatus?: EquipmentStatus;
  gamePantsInventoryId?: string;
  gamePantsTagNumber?: string;
  practicePantsSize?: string;
  practicePantsStatus?: EquipmentStatus;
  practicePantsInventoryId?: string;
  practicePantsTagNumber?: string;
  issuedAt?: string;
  verifiedWeight?: number;
}

export type ShedItemType =
  | 'helmet'
  | 'shoulder_pads'
  | 'game_jersey'
  | 'scrimmage_jersey'
  | 'scrimmage_jersey_2'
  | 'practice_jersey'
  | 'game_pants'
  | 'practice_pants';

export type ItemCondition = 'new' | 'good' | 'fair' | 'poor';

export interface ShedItem {
  id: string;
  tagNumber: string;
  // Standard ShedItemType or a custom type slug introduced via import/Add Item.
  // Custom types are assignable too via derived x_{slug}* enrollment fields —
  // see slotFieldsForType().
  type: string;
  size: string;
  status: 'available' | 'issued' | 'retired';
  issuedToPlayerId?: string;
  issuedToParentUserId?: string;
  issuedToEnrollmentId?: string;
  issuedAt?: string;
  issuedByUid?: string;
  issuedByName?: string;
  returnedAt?: string;
  retiredAt?: string;
  purchaseYear?: number;        // year the item was bought — drives 10-yr service-life flag
  lastRecertDate?: string;      // "YYYY" (legacy values may be "YYYY-MM-DD") — drives 2-yr recert cycle flag
  condition?: ItemCondition;    // captured at return time
  notes?: string;
}

export const HELMET_SIZES = ['XXS/XS', 'S', 'M', 'L', 'XL', '2XL'] as const;
export const PAD_SIZES = ['XXS', 'XS', 'YXXS', 'YXS', 'YS', 'YM', 'YL', 'YXL', 'AS', 'AM', 'AL', 'AXL'] as const;
export const JERSEY_SIZES = ['XXS', 'XS', 'YXXS', 'YXS', 'YS', 'YM', 'YL', 'YXL', 'AS', 'AM', 'AL', 'AXL'] as const;
export const PANTS_SIZES = ['XXS', 'XS', 'YXXS', 'YXS', 'YS', 'YM', 'YL', 'YXL', 'AS', 'AM', 'AL', 'AXL'] as const;

/** Slots whose registered size falls back to the enrollment's top-level
 *  jerseySize/shirtSize (the only size captured at registration). Declared
 *  above sizesForType so it stays the single source of truth for "is a jersey". */
export const JERSEY_SLOTS = new Set<ShedItemType>([
  'game_jersey',
  'scrimmage_jersey',
  'scrimmage_jersey_2',
  'practice_jersey',
]);

/** Standard size list for a type slug, or null for custom types (free text). */
export function sizesForType(slug: string): readonly string[] | null {
  if (slug === 'helmet') return HELMET_SIZES;
  if (slug === 'shoulder_pads') return PAD_SIZES;
  // Membership first: scrimmage_jersey_2 is a jersey but doesn't end in "_jersey".
  if (JERSEY_SLOTS.has(slug as ShedItemType)) return JERSEY_SIZES;
  if (slug.endsWith('_jersey')) return JERSEY_SIZES;
  if (slug.endsWith('_pants')) return PANTS_SIZES;
  return null;
}

/**
 * The eight tracked types, in display order. Keys are permanent — they are the
 * `type` value on every equipmentInventory doc — so the labels, not the slugs,
 * carry SYFA's naming:
 *   - `game_jersey` is the BLUE game jersey
 *   - `scrimmage_jersey` is the WHITE game jersey (renamed in 2026; 85 items)
 *   - `scrimmage_jersey_2` is the actual scrimmage jersey, added afterwards
 *     because the obvious slug was already spoken for.
 * Renaming a slug would mean rewriting every inventory doc and enrollment
 * mirror field, so we don't.
 */
export const SHED_ITEM_TYPES: Record<ShedItemType, string> = {
  helmet: 'Helmet',
  shoulder_pads: 'Shoulder Pads',
  game_jersey: 'Blue Game Jersey',
  scrimmage_jersey: 'White Game Jersey',
  scrimmage_jersey_2: 'Scrimmage Jersey',
  practice_jersey: 'Practice Jersey',
  game_pants: 'Game Pants',
  practice_pants: 'Practice Pants',
};

/** Admin-editable display labels from `equipmentTypes/{slug}` docs, keyed by slug. */
export type TypeLabelOverrides = Record<string, string>;

export function typeLabel(type: string, overrides?: TypeLabelOverrides): string {
  return (
    overrides?.[type] ??
    SHED_ITEM_TYPES[type as ShedItemType] ??
    type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/** Normalizes a display name to a slug: "Mouth Guard" → "mouth_guard". */
export function normalizeTypeSlug(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '_');
}

/**
 * Decides the slug for a newly-added equipment type, or null when the name is
 * already in use.
 *
 * Two subtleties, both of which used to block a legitimate add:
 *  - Uniqueness is judged on the EFFECTIVE label (renames applied), not the
 *    built-in name. Renaming `scrimmage_jersey` to "White Game Jersey" frees
 *    the name "Scrimmage Jersey" for a genuinely new type.
 *  - The slug derived from that freed name still collides with the standard
 *    slot it came from, so we suffix it (`scrimmage_jersey_2`) instead of
 *    refusing. Slugs are internal; only the label is ever displayed.
 */
export function resolveNewTypeSlug(
  label: string,
  existingSlugs: string[],
  overrides: TypeLabelOverrides
): string | null {
  const base = normalizeTypeSlug(label);
  if (!base) return null;

  const wanted = label.trim().toLowerCase();
  if (existingSlugs.some((s) => typeLabel(s, overrides).trim().toLowerCase() === wanted)) return null;

  const taken = new Set(existingSlugs);
  let slug = base;
  for (let n = 2; taken.has(slug) || slug in SHED_ITEM_TYPES || overrides[slug]; n++) {
    slug = `${base}_${n}`;
  }
  return slug;
}

export const EQUIP_FIELD_MAP: Record<ShedItemType, {
  statusField: keyof FootballEquipment;
  sizeField: keyof FootballEquipment | null;
  inventoryIdField: keyof FootballEquipment;
  tagField: keyof FootballEquipment;
}> = {
  helmet:           { statusField: 'helmetStatus',           sizeField: 'helmetSize',       inventoryIdField: 'helmetInventoryId',          tagField: 'helmetTagNumber' },
  shoulder_pads:    { statusField: 'padStatus',              sizeField: 'shoulderPadSize',  inventoryIdField: 'padInventoryId',             tagField: 'padTagNumber' },
  game_jersey:      { statusField: 'gameJerseyStatus',       sizeField: 'jerseySize',       inventoryIdField: 'gameJerseyInventoryId',      tagField: 'gameJerseyTagNumber' },
  scrimmage_jersey: { statusField: 'scrimmageJerseyStatus',  sizeField: null,               inventoryIdField: 'scrimmageJerseyInventoryId', tagField: 'scrimmageJerseyTagNumber' },
  scrimmage_jersey_2: { statusField: 'scrimmageJersey2Status', sizeField: null,             inventoryIdField: 'scrimmageJersey2InventoryId', tagField: 'scrimmageJersey2TagNumber' },
  practice_jersey:  { statusField: 'practiceJerseyStatus',   sizeField: null,               inventoryIdField: 'practiceJerseyInventoryId',  tagField: 'practiceJerseyTagNumber' },
  game_pants:       { statusField: 'gamePantsStatus',        sizeField: 'gamePantsSize',    inventoryIdField: 'gamePantsInventoryId',       tagField: 'gamePantsTagNumber' },
  practice_pants:   { statusField: 'practicePantsStatus',    sizeField: 'practicePantsSize',inventoryIdField: 'practicePantsInventoryId',   tagField: 'practicePantsTagNumber' },
};

/** Field names on footballEquipment for ANY type slug. Standard types use
 *  their legacy field names; custom types get derived `x_{slug}...` fields so
 *  they are fully assignable too. All custom-slot writes stay inside the
 *  footballEquipment map, so no security-rules changes are needed. */
export interface SlotFields {
  statusField: string;
  sizeField: string | null;
  inventoryIdField: string;
  tagField: string;
}

export function slotFieldsForType(slug: string): SlotFields {
  const std = EQUIP_FIELD_MAP[slug as ShedItemType];
  if (std) {
    return {
      statusField: String(std.statusField),
      sizeField: std.sizeField ? String(std.sizeField) : null,
      inventoryIdField: String(std.inventoryIdField),
      tagField: String(std.tagField),
    };
  }
  return {
    statusField: `x_${slug}Status`,
    sizeField: null,
    inventoryIdField: `x_${slug}InventoryId`,
    tagField: `x_${slug}TagNumber`,
  };
}

/** Slug for a custom-slot status field name (`x_{slug}Status`), else null. */
export function customSlugFromStatusField(key: string): string | null {
  return key.startsWith('x_') && key.endsWith('Status') ? key.slice(2, -6) : null;
}

/** Count of items currently issued on an enrollment's mirror fields —
 *  covers both standard slots and derived custom slots. */
export function countIssuedEquipment(fe?: FootballEquipment): number {
  if (!fe) return 0;
  return Object.entries(fe as Record<string, unknown>)
    .filter(([key, val]) => key.endsWith('Status') && val === 'issued').length;
}

export function hasIssuedEquipment(fe?: FootballEquipment): boolean {
  return countIssuedEquipment(fe) > 0;
}

/** Helmets and shoulder pads carry NOCSAE-style recert obligations. */
export const RECERT_TYPES = new Set<string>(['helmet', 'shoulder_pads']);
export const RECERT_CYCLE_YEARS = 2;
export const MAX_SERVICE_YEARS = 10;

export type RecertState = 'retire' | 'due' | 'no-record' | 'ok';

/** Extracts the 4-digit year from a stored recert value — new records store
 *  "YYYY", legacy live data may still be "YYYY-MM-DD". */
export function recertYear(value?: string): number | null {
  if (!value) return null;
  const y = Number(value.slice(0, 4));
  return Number.isInteger(y) && y > 0 ? y : null;
}

/** Recert/service-life state for an item, or null for types with no
 *  recert obligation. */
export function recertState(item: ShedItem): RecertState | null {
  if (!RECERT_TYPES.has(item.type)) return null;
  const nowYear = new Date().getFullYear();
  if (item.purchaseYear && nowYear - item.purchaseYear >= MAX_SERVICE_YEARS) return 'retire';
  const baselineYear = recertYear(item.lastRecertDate) ?? item.purchaseYear;
  if (!baselineYear) return 'no-record';
  return nowYear - baselineYear >= RECERT_CYCLE_YEARS ? 'due' : 'ok';
}

export interface EquipmentNotifyInfo {
  parentUserId: string;
  /** Linked co-parents on the enrollment — notified alongside the primary. */
  additionalParentUids?: string[];
  actorUid: string;
  event: 'issued' | 'returned';
  itemLabel: string;
  tagNumber?: string;
  playerName?: string;
  /** Sport tag on the notification (inbox filters by active sport). */
  sport?: 'baseball' | 'football';
  /** Overrides the composed body — used for consolidated bulk-return messages. */
  body?: string;
}

/** Adds the parent-facing in-app notifications (primary parent + linked
 *  co-parents) to an existing equipment batch, matching the doc shape of
 *  coach-notifications' batchNotifications. Skips missing parents and the
 *  actor (no self-notification). Returns the notified uids + the composed
 *  payload so callers can push AFTER the batch commits. */
export function addEquipmentNotificationToBatch(
  batch: WriteBatch,
  db: Firestore,
  info: EquipmentNotifyInfo
): { recipients: string[]; title: string; body: string } | null {
  const recipients = [...new Set([info.parentUserId, ...(info.additionalParentUids ?? [])])]
    .filter(uid => uid && uid !== info.actorUid);
  if (recipients.length === 0) return null;
  const tag = info.tagNumber ? ` #${info.tagNumber}` : '';
  const who = info.playerName || 'your player';
  const title = info.event === 'issued' ? 'Equipment issued' : 'Equipment returned';
  const body = info.body ?? (info.event === 'issued'
    ? `${info.itemLabel}${tag} was issued to ${who}.`
    : `${info.itemLabel}${tag} was returned for ${who}.`);
  for (const uid of recipients) {
    batch.set(doc(db, 'notifications', crypto.randomUUID()), {
      userId: uid,
      type: 'equipment',
      title,
      body,
      read: false,
      createdAt: Timestamp.now(),
      sport: info.sport ?? 'football',
    });
  }
  return { recipients, title, body };
}

export interface EquipmentEnrollmentRef {
  id: string;
  parentUserId: string;
  playerId: string;
  footballEquipment?: FootballEquipment;
}

export type EquipmentHistoryEventType = 'issued' | 'returned' | 'retired' | 'restored';

/** Append-only audit event stored at `equipmentInventory/{itemId}/history/{eventId}`. */
export interface EquipmentHistoryEvent {
  event: EquipmentHistoryEventType;
  at: string; // ISO timestamp
  playerId?: string;
  playerName?: string;
  actorUid: string;
  actorName: string;
}

export function addHistoryToBatch(
  batch: WriteBatch,
  db: Firestore,
  itemId: string,
  event: EquipmentHistoryEvent
): void {
  batch.set(doc(collection(db, 'equipmentInventory', itemId, 'history')), event);
}

/** Thrown when the race pre-check finds the item was just issued elsewhere. */
export class ItemAlreadyIssuedError extends Error {
  constructor(tagNumber: string) {
    super(`Tag #${tagNumber} was just assigned to another player. Please try a different item.`);
    this.name = 'ItemAlreadyIssuedError';
  }
}

/** Optional extras for the parent-facing notification the commit helpers write. */
export interface EquipmentCommitOptions {
  /** Linked co-parents on the enrollment — notified alongside the primary. */
  additionalParentUids?: string[];
  /** Admin-renamed display label; defaults to the built-in typeLabel(). */
  itemLabel?: string;
}

/** Issue an inventory item to a player: updates the enrollment's
 *  footballEquipment fields and the inventory doc in one batch, releasing any
 *  previously-assigned item for the same slot. Throws on failure.
 *  Returns the notification payload (or null) so callers can push AFTER the
 *  batch commits. */
export async function commitAssignItem(
  db: Firestore,
  enrollment: EquipmentEnrollmentRef,
  item: ShedItem,
  equipType: string,
  actor: { uid: string; name: string },
  playerName?: string,
  opts?: EquipmentCommitOptions
): Promise<{ recipients: string[]; title: string; body: string } | null> {
  // Pre-check for race condition: verify item is still free (or already assigned here)
  const freshSnap = await getDoc(doc(db, 'equipmentInventory', item.id));
  const freshData = freshSnap.data();
  if (freshData?.status === 'issued' && freshData?.issuedToEnrollmentId !== enrollment.id) {
    throw new ItemAlreadyIssuedError(item.tagNumber);
  }

  const { statusField, sizeField, inventoryIdField, tagField } = slotFieldsForType(equipType);
  const prevInventoryId = ((enrollment.footballEquipment ?? {}) as Record<string, unknown>)[inventoryIdField] as string | undefined;

  const batch = writeBatch(db);
  const now = new Date().toISOString();

  const enrollmentUpdates: Record<string, any> = {
    [`footballEquipment.${String(statusField)}`]: 'issued',
    [`footballEquipment.${String(inventoryIdField)}`]: item.id,
    [`footballEquipment.${String(tagField)}`]: item.tagNumber,
    'footballEquipment.issuedAt': now,
  };
  if (sizeField) {
    enrollmentUpdates[`footballEquipment.${String(sizeField)}`] = item.size;
  }
  batch.update(doc(db, 'userProfiles', enrollment.parentUserId, 'enrollments', enrollment.id), enrollmentUpdates);

  batch.update(doc(db, 'equipmentInventory', item.id), {
    status: 'issued',
    issuedToPlayerId: enrollment.playerId,
    issuedToParentUserId: enrollment.parentUserId,
    issuedToEnrollmentId: enrollment.id,
    issuedAt: now,
    issuedByUid: actor.uid,
    issuedByName: actor.name,
    returnedAt: '',
  });

  addHistoryToBatch(batch, db, item.id, {
    event: 'issued',
    at: now,
    playerId: enrollment.playerId,
    playerName: playerName ?? '',
    actorUid: actor.uid,
    actorName: actor.name,
  });

  const notif = addEquipmentNotificationToBatch(batch, db, {
    parentUserId: enrollment.parentUserId,
    additionalParentUids: opts?.additionalParentUids,
    actorUid: actor.uid,
    event: 'issued',
    itemLabel: opts?.itemLabel ?? typeLabel(equipType),
    tagNumber: item.tagNumber,
    playerName,
  });

  // If a different item was previously assigned for this slot, return it to available
  if (prevInventoryId && prevInventoryId !== item.id) {
    batch.update(doc(db, 'equipmentInventory', prevInventoryId), {
      status: 'available',
      issuedToPlayerId: '',
      issuedToParentUserId: '',
      issuedToEnrollmentId: '',
      returnedAt: now,
    });
    addHistoryToBatch(batch, db, prevInventoryId, {
      event: 'returned',
      at: now,
      playerId: enrollment.playerId,
      playerName: playerName ?? '',
      actorUid: actor.uid,
      actorName: actor.name,
    });
  }

  await batch.commit();
  return notif;
}

/** Return an issued item: clears the enrollment's inventory/tag fields and
 *  frees the inventory doc. Throws on failure. Returns the notification
 *  payload (or null) so callers can push AFTER the batch commits. */
export async function commitReturnItem(
  db: Firestore,
  enrollment: EquipmentEnrollmentRef,
  item: ShedItem,
  equipType: string,
  actor?: { uid: string; name: string },
  playerName?: string,
  opts?: EquipmentCommitOptions
): Promise<{ recipients: string[]; title: string; body: string } | null> {
  const { statusField, inventoryIdField, tagField } = slotFieldsForType(equipType);

  const batch = writeBatch(db);
  const now = new Date().toISOString();

  batch.update(doc(db, 'userProfiles', enrollment.parentUserId, 'enrollments', enrollment.id), {
    [`footballEquipment.${String(statusField)}`]: 'returned',
    [`footballEquipment.${String(inventoryIdField)}`]: deleteField(),
    [`footballEquipment.${String(tagField)}`]: deleteField(),
  });

  batch.update(doc(db, 'equipmentInventory', item.id), {
    status: 'available',
    issuedToPlayerId: '',
    issuedToParentUserId: '',
    issuedToEnrollmentId: '',
    returnedAt: now,
  });

  let notif: { recipients: string[]; title: string; body: string } | null = null;
  if (actor) {
    addHistoryToBatch(batch, db, item.id, {
      event: 'returned',
      at: now,
      playerId: enrollment.playerId,
      playerName: playerName ?? '',
      actorUid: actor.uid,
      actorName: actor.name,
    });
    notif = addEquipmentNotificationToBatch(batch, db, {
      parentUserId: enrollment.parentUserId,
      additionalParentUids: opts?.additionalParentUids,
      actorUid: actor.uid,
      event: 'returned',
      itemLabel: opts?.itemLabel ?? typeLabel(equipType),
      tagNumber: item.tagNumber,
      playerName,
    });
  }

  await batch.commit();
  return notif;
}
