import { getAdminAuth, getAdminFirestore } from '@/lib/firebase-admin';

/**
 * Verifies the Firebase ID token in an `Authorization: Bearer` header.
 * Returns the caller's uid, or null when the header is missing or invalid.
 */
export async function verifyBearerUid(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

export interface CallerProfile {
  uid: string;
  email: string;
  /** Effective roles: roles[] + legacy role + per-sport roles + Site Admin flag. */
  roles: Set<string>;
}

/**
 * Loads the caller's profile and flattens every role-grant path the Firestore
 * rules recognize (roles array, legacy single `role`, `sportRoles` map,
 * `isSiteAdmin` flag) into one set, so server checks match rule checks.
 */
export async function getCallerProfile(uid: string): Promise<CallerProfile> {
  const snap = await getAdminFirestore().collection('userProfiles').doc(uid).get();
  const data = snap.data() ?? {};
  const roles = new Set<string>();
  for (const r of (data.roles ?? []) as string[]) roles.add(r);
  if (typeof data.role === 'string' && data.role) roles.add(data.role);
  if (data.isSiteAdmin === true) roles.add('Site Admin');
  const sportRoles = (data.sportRoles ?? {}) as Record<string, string[]>;
  for (const sport of Object.keys(sportRoles)) {
    for (const r of sportRoles[sport] ?? []) roles.add(r);
  }
  return { uid, email: (data.email as string) ?? '', roles };
}

/** True when the caller holds any of the allowed roles (Site Admin always passes). */
export function hasAnyRole(profile: CallerProfile, allowed: string[]): boolean {
  if (profile.roles.has('Site Admin')) return true;
  return allowed.some(r => profile.roles.has(r));
}
