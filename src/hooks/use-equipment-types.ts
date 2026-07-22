'use client';

/**
 * Subscribes to the admin-managed `equipmentTypes/{slug}` registry and exposes
 * display-label overrides for equipment type slugs. Standard types only have a
 * doc when renamed; custom types always have one so they survive having zero
 * inventory items. Pass `enabled: false` for users without read permission.
 */
import { useMemo } from 'react';
import { collection } from 'firebase/firestore';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase';
import type { TypeLabelOverrides } from '@/lib/equipment';

export interface ManagedEquipmentType {
  slug: string;
  label: string;
}

export function useEquipmentTypes(enabled: boolean): {
  labels: TypeLabelOverrides;
  managedTypes: ManagedEquipmentType[];
  isLoading: boolean;
} {
  const db = useFirestore();

  const typesQuery = useMemoFirebase(() => {
    if (!db || !enabled) return null;
    return collection(db, 'equipmentTypes');
  }, [db, enabled]);

  const { data: typeDocs, isLoading } = useCollection<{ id: string; label: string }>(typesQuery);

  const { labels, managedTypes } = useMemo(() => {
    const labels: TypeLabelOverrides = {};
    const managedTypes: ManagedEquipmentType[] = [];
    (typeDocs ?? []).forEach((d) => {
      const label = (d.label ?? '').trim();
      if (!label) return;
      labels[d.id] = label;
      managedTypes.push({ slug: d.id, label });
    });
    managedTypes.sort((a, b) => a.label.localeCompare(b.label));
    return { labels, managedTypes };
  }, [typeDocs]);

  return { labels, managedTypes, isLoading };
}
