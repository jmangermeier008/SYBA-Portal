import { describe, it, expect } from 'vitest';
import {
  normalizeTypeSlug,
  recertYear,
  recertState,
  resolveNewTypeSlug,
  sizesForType,
  slotFieldsForType,
  JERSEY_SIZES,
  JERSEY_SLOTS,
  SHED_ITEM_TYPES,
  type ShedItem,
} from '@/lib/equipment';

const STANDARD = Object.keys(SHED_ITEM_TYPES);

const NOW = new Date().getFullYear();

function item(overrides: Partial<ShedItem> = {}): ShedItem {
  return {
    id: 'i1',
    tagNumber: '12',
    type: 'helmet',
    size: 'M',
    status: 'available',
    ...overrides,
  };
}

describe('recertYear', () => {
  it('reads the new "YYYY" format', () => {
    expect(recertYear('2025')).toBe(2025);
  });

  it('reads the legacy "YYYY-MM-DD" format', () => {
    expect(recertYear('2025-06-01')).toBe(2025);
  });

  it('returns null for missing or unparseable values', () => {
    expect(recertYear(undefined)).toBeNull();
    expect(recertYear('')).toBeNull();
    expect(recertYear('not-a-year')).toBeNull();
  });
});

describe('recertState', () => {
  it('returns null for types with no recert obligation', () => {
    expect(recertState(item({ type: 'game_jersey', purchaseYear: 1990 }))).toBeNull();
    expect(recertState(item({ type: 'practice_pants' }))).toBeNull();
  });

  it('applies to both helmets and shoulder pads', () => {
    expect(recertState(item({ type: 'helmet' }))).toBe('no-record');
    expect(recertState(item({ type: 'shoulder_pads' }))).toBe('no-record');
  });

  it('flags retirement past the 10-year service life, ahead of recert', () => {
    // A fresh recert does not extend service life — retirement wins.
    expect(recertState(item({ purchaseYear: NOW - 10, lastRecertDate: String(NOW) }))).toBe('retire');
    expect(recertState(item({ purchaseYear: NOW - 11 }))).toBe('retire');
  });

  it('does not retire an item still inside its service life', () => {
    expect(recertState(item({ purchaseYear: NOW - 9, lastRecertDate: String(NOW) }))).toBe('ok');
  });

  it('reports no-record when neither date is present', () => {
    expect(recertState(item())).toBe('no-record');
  });

  it('flags recert due at the 2-year boundary, measured from the last recert', () => {
    expect(recertState(item({ lastRecertDate: String(NOW - 2) }))).toBe('due');
    expect(recertState(item({ lastRecertDate: String(NOW - 1) }))).toBe('ok');
    expect(recertState(item({ lastRecertDate: String(NOW) }))).toBe('ok');
  });

  it('falls back to the purchase year when there is no recert record', () => {
    expect(recertState(item({ purchaseYear: NOW - 3 }))).toBe('due');
    expect(recertState(item({ purchaseYear: NOW - 1 }))).toBe('ok');
  });

  it('prefers the recert year over the purchase year', () => {
    // Bought 5 years ago but reconditioned this year — not due.
    expect(recertState(item({ purchaseYear: NOW - 5, lastRecertDate: String(NOW) }))).toBe('ok');
  });
});

describe('normalizeTypeSlug', () => {
  it('lowercases and underscores a display name', () => {
    expect(normalizeTypeSlug('Mouth Guard')).toBe('mouth_guard');
    expect(normalizeTypeSlug('  Scrimmage   Jersey ')).toBe('scrimmage_jersey');
  });
});

describe('resolveNewTypeSlug', () => {
  it('mints a plain slug for a brand-new name', () => {
    expect(resolveNewTypeSlug('Mouth Guard', STANDARD, {})).toBe('mouth_guard');
  });

  it('rejects a name already used by a standard type', () => {
    expect(resolveNewTypeSlug('Scrimmage Jersey', STANDARD, {})).toBeNull();
    expect(resolveNewTypeSlug('White Game Jersey', STANDARD, {})).toBeNull();
    expect(resolveNewTypeSlug('  helmet  ', STANDARD, {})).toBeNull();
  });

  it('rejects a name already used by a custom type', () => {
    const slugs = [...STANDARD, 'mouth_guard'];
    const overrides = { mouth_guard: 'Mouth Guard' };
    expect(resolveNewTypeSlug('mouth guard', slugs, overrides)).toBeNull();
  });

  it('rejects a name that matches a RENAMED standard type', () => {
    const overrides = { practice_jersey: 'Pinnie' };
    expect(resolveNewTypeSlug('Pinnie', STANDARD, overrides)).toBeNull();
  });

  it('frees a built-in name once that standard type has been renamed away', () => {
    // Renaming practice_jersey to "Pinnie" leaves "Practice Jersey" unused, so
    // adding it must succeed — under a slug that doesn't collide with the
    // standard slot it came from. (This is how Blue/White Game Jersey came to be.)
    const overrides = { practice_jersey: 'Pinnie' };
    expect(resolveNewTypeSlug('Practice Jersey', STANDARD, overrides)).toBe('practice_jersey_2');
  });

  it('keeps suffixing until it finds a free slug', () => {
    const overrides = { practice_jersey: 'Pinnie', practice_jersey_2: 'Old Practice' };
    const slugs = [...STANDARD, 'practice_jersey_2'];
    expect(resolveNewTypeSlug('Practice Jersey', slugs, overrides)).toBe('practice_jersey_3');
  });

  it('returns null for an empty or whitespace-only name', () => {
    expect(resolveNewTypeSlug('   ', STANDARD, {})).toBeNull();
  });
});

describe('the eight tracked standard types', () => {
  it('are exactly these slugs, in display order', () => {
    expect(Object.keys(SHED_ITEM_TYPES)).toEqual([
      'helmet',
      'shoulder_pads',
      'game_jersey',
      'scrimmage_jersey',
      'scrimmage_jersey_2',
      'practice_jersey',
      'game_pants',
      'practice_pants',
    ]);
  });

  it('carry SYFA’s names, including the two repurposed jersey slots', () => {
    expect(SHED_ITEM_TYPES.game_jersey).toBe('Blue Game Jersey');
    expect(SHED_ITEM_TYPES.scrimmage_jersey).toBe('White Game Jersey');
    expect(SHED_ITEM_TYPES.scrimmage_jersey_2).toBe('Scrimmage Jersey');
  });

  it('all have distinct labels', () => {
    const labels = Object.values(SHED_ITEM_TYPES);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('every standard slug has a named field mapping and every slot is distinct', () => {
    const slugs = Object.keys(SHED_ITEM_TYPES);
    const seen = new Set<string>();
    for (const slug of slugs) {
      const f = slotFieldsForType(slug);
      // Named mapping, not the x_{slug} fallback used by custom types
      expect(f.statusField.startsWith('x_')).toBe(false);
      for (const field of [f.statusField, f.inventoryIdField, f.tagField]) {
        expect(seen.has(field)).toBe(false);
        seen.add(field);
      }
    }
  });

  it('keeps the existing white-game-jersey fields untouched', () => {
    // 85 inventory items and every live assignment hang off these names
    expect(slotFieldsForType('scrimmage_jersey')).toEqual({
      statusField: 'scrimmageJerseyStatus',
      sizeField: null,
      inventoryIdField: 'scrimmageJerseyInventoryId',
      tagField: 'scrimmageJerseyTagNumber',
    });
  });

  it('gives the new scrimmage jersey its own fields and jersey sizes', () => {
    expect(slotFieldsForType('scrimmage_jersey_2')).toEqual({
      statusField: 'scrimmageJersey2Status',
      sizeField: null,
      inventoryIdField: 'scrimmageJersey2InventoryId',
      tagField: 'scrimmageJersey2TagNumber',
    });
    expect(sizesForType('scrimmage_jersey_2')).toEqual(JERSEY_SIZES);
    expect(JERSEY_SLOTS.has('scrimmage_jersey_2')).toBe(true);
  });
});
