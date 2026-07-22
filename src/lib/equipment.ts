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
  scrimmageJerseyStatus?: EquipmentStatus;
  scrimmageJerseyInventoryId?: string;
  scrimmageJerseyTagNumber?: string;
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

export type ShedItemType = 'helmet' | 'shoulder_pads' | 'game_jersey' | 'scrimmage_jersey' | 'practice_jersey' | 'game_pants' | 'practice_pants';

export type ItemCondition = 'new' | 'good' | 'fair' | 'poor';

export interface ShedItem {
  id: string;
  tagNumber: string;
  // Standard ShedItemType or a custom type slug introduced via import/Add Item.
  // Custom types are inventory-only: no assignment column, no EQUIP_FIELD_MAP entry.
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
  lastRecertDate?: string;      // YYYY-MM-DD — drives 2-yr recert cycle flag
  condition?: ItemCondition;    // captured at return time
  notes?: string;
}

export const SHED_ITEM_TYPES: Record<ShedItemType, string> = {
  helmet: 'Helmet',
  shoulder_pads: 'Shoulder Pads',
  game_jersey: 'Game Jersey',
  scrimmage_jersey: 'Scrimmage Jersey',
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
  practice_jersey:  { statusField: 'practiceJerseyStatus',   sizeField: null,               inventoryIdField: 'practiceJerseyInventoryId',  tagField: 'practiceJerseyTagNumber' },
  game_pants:       { statusField: 'gamePantsStatus',        sizeField: 'gamePantsSize',    inventoryIdField: 'gamePantsInventoryId',       tagField: 'gamePantsTagNumber' },
  practice_pants:   { statusField: 'practicePantsStatus',    sizeField: 'practicePantsSize',inventoryIdField: 'practicePantsInventoryId',   tagField: 'practicePantsTagNumber' },
};

/** Count of standard-slot items currently issued on an enrollment's mirror fields. */
export function countIssuedEquipment(fe?: FootballEquipment): number {
  if (!fe) return 0;
  return Object.values(EQUIP_FIELD_MAP)
    .filter(({ statusField }) => fe[statusField] === 'issued').length;
}

export function hasIssuedEquipment(fe?: FootballEquipment): boolean {
  return countIssuedEquipment(fe) > 0;
}

export interface EquipmentNotifyInfo {
  parentUserId: string;
  actorUid: string;
  event: 'issued' | 'returned';
  itemLabel: string;
  tagNumber?: string;
  playerName?: string;
  /** Overrides the composed body — used for consolidated bulk-return messages. */
  body?: string;
}

/** Adds the parent-facing in-app notification to an existing equipment batch,
 *  matching the doc shape of coach-notifications' batchNotifications. No-ops
 *  when the parent is missing or is the actor (no self-notification).
 *  Limitation: enrollments carry only the primary parentUserId — a second
 *  parent on two-parent families is not notified. */
export function addEquipmentNotificationToBatch(
  batch: WriteBatch,
  db: Firestore,
  info: EquipmentNotifyInfo
): void {
  if (!info.parentUserId || info.parentUserId === info.actorUid) return;
  const tag = info.tagNumber ? ` #${info.tagNumber}` : '';
  const who = info.playerName || 'your player';
  batch.set(doc(db, 'notifications', crypto.randomUUID()), {
    userId: info.parentUserId,
    type: 'equipment',
    title: info.event === 'issued' ? 'Equipment issued' : 'Equipment returned',
    body: info.body ?? (info.event === 'issued'
      ? `${info.itemLabel}${tag} was issued to ${who}.`
      : `${info.itemLabel}${tag} was returned for ${who}.`),
    read: false,
    createdAt: Timestamp.now(),
    sport: 'football',
  });
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

/** Issue an inventory item to a player: updates the enrollment's
 *  footballEquipment fields and the inventory doc in one batch, releasing any
 *  previously-assigned item for the same slot. Throws on failure. */
export async function commitAssignItem(
  db: Firestore,
  enrollment: EquipmentEnrollmentRef,
  item: ShedItem,
  equipType: ShedItemType,
  actor: { uid: string; name: string },
  playerName?: string
): Promise<void> {
  // Pre-check for race condition: verify item is still free (or already assigned here)
  const freshSnap = await getDoc(doc(db, 'equipmentInventory', item.id));
  const freshData = freshSnap.data();
  if (freshData?.status === 'issued' && freshData?.issuedToEnrollmentId !== enrollment.id) {
    throw new ItemAlreadyIssuedError(item.tagNumber);
  }

  const { statusField, sizeField, inventoryIdField, tagField } = EQUIP_FIELD_MAP[equipType];
  const prevInventoryId = (enrollment.footballEquipment ?? {})[inventoryIdField] as string | undefined;

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

  addEquipmentNotificationToBatch(batch, db, {
    parentUserId: enrollment.parentUserId,
    actorUid: actor.uid,
    event: 'issued',
    itemLabel: typeLabel(equipType),
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
}

/** Return an issued item: clears the enrollment's inventory/tag fields and
 *  frees the inventory doc. Throws on failure. */
export async function commitReturnItem(
  db: Firestore,
  enrollment: EquipmentEnrollmentRef,
  item: ShedItem,
  equipType: ShedItemType,
  actor?: { uid: string; name: string },
  playerName?: string
): Promise<void> {
  const { statusField, inventoryIdField, tagField } = EQUIP_FIELD_MAP[equipType];

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

  if (actor) {
    addHistoryToBatch(batch, db, item.id, {
      event: 'returned',
      at: now,
      playerId: enrollment.playerId,
      playerName: playerName ?? '',
      actorUid: actor.uid,
      actorName: actor.name,
    });
    addEquipmentNotificationToBatch(batch, db, {
      parentUserId: enrollment.parentUserId,
      actorUid: actor.uid,
      event: 'returned',
      itemLabel: typeLabel(equipType),
      tagNumber: item.tagNumber,
      playerName,
    });
  }

  await batch.commit();
}
