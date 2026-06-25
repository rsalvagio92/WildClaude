/**
 * Multi-machine role configuration.
 * WILD_ROLE: primary | secondary
 * - Primary: manages shared memory (memories, wiki, projects, consolidations)
 * - Secondary: reads remote memory, forwards new learns to primary, has local session/conv_log
 */

import { readEnvFile } from './env.js';

export type WildRole = 'primary' | 'secondary';

export interface RoleConfig {
  role: WildRole;
  // Secondary only
  primaryUrl?: string; // IP:port of primary, e.g., "192.168.1.100:3141"
  syncToken?: string; // bearer token for sync API
  machineId: string; // unique identifier: "primary" | "wb2" | "wb3" etc
}

export function loadRoleConfig(): RoleConfig {
  // Prefer process.env (explicit shell var), fall back to .env file
  const env = readEnvFile(['WILD_ROLE', 'WILD_PRIMARY_URL', 'WILD_SYNC_TOKEN', 'WILD_MACHINE_ID']);
  const role = (process.env.WILD_ROLE || env.WILD_ROLE || 'primary') as WildRole;
  const primaryUrl = process.env.WILD_PRIMARY_URL || env.WILD_PRIMARY_URL;
  const syncToken = process.env.WILD_SYNC_TOKEN || env.WILD_SYNC_TOKEN;
  const machineId = process.env.WILD_MACHINE_ID || env.WILD_MACHINE_ID || role;

  if (role === 'secondary' && !primaryUrl) {
    throw new Error('WILD_ROLE=secondary requires WILD_PRIMARY_URL (e.g., 192.168.1.100:3141)');
  }

  return {
    role,
    primaryUrl,
    syncToken,
    machineId,
  };
}

export function isPrimary(): boolean {
  return loadRoleConfig().role === 'primary';
}

export function isSecondary(): boolean {
  return loadRoleConfig().role === 'secondary';
}
