/**
 * Playwright global teardown — removes every trace of E2E data
 * (seasons, divisions, e2e-domain users, their profile trees, uploads).
 */
import fs from 'fs';
import path from 'path';
import { cleanupAllE2EData } from './admin';

export default async function globalTeardown() {
  console.log('[e2e teardown] Removing all E2E data…');
  await cleanupAllE2EData();
  const stateFile = path.resolve(__dirname, '..', '.e2e-state.json');
  if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
  console.log('[e2e teardown] Done.');
}
