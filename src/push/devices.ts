/**
 * Push device registry — the persistence layer behind Expo push.
 *
 * One row per device token. The mobile app registers its Expo push token on
 * first launch (POST /api/push/register) and updates notification preferences
 * from its settings screen (POST /api/push/prefs). The dispatcher (./expo.ts)
 * reads the enabled tokens here and prunes ones Expo reports as dead.
 *
 * Storage lives in the main SQLite db (push_devices table, created in db.ts's
 * createSchema). We keep the CRUD here so the push module is self-contained.
 */

import { getDb } from '../db.js';
import { logger } from '../logger.js';

/** An Expo push token looks like `ExponentPushToken[xxxxxxxx]` (or ExpoPushToken[…]). */
export function isValidExpoToken(token: unknown): token is string {
  return typeof token === 'string' && /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token.trim());
}

/** Per-category opt-out map. Absent or true = deliver; explicit false = skip. */
export type CategoryPrefs = Record<string, boolean>;

export interface DevicePrefs {
  /** Master switch for this device. */
  enabled: boolean;
  /** Per-category toggles, e.g. { chat: true, agent: false }. */
  categories: CategoryPrefs;
}

export interface PushDevice {
  token: string;
  platform: string | null;
  deviceName: string | null;
  prefs: DevicePrefs;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
}

interface PushDeviceRow {
  token: string;
  platform: string | null;
  device_name: string | null;
  prefs: string;
  enabled: number;
  created_at: number;
  updated_at: number;
  last_used_at: number | null;
}

const DEFAULT_PREFS: DevicePrefs = { enabled: true, categories: {} };

function parsePrefs(json: string): DevicePrefs {
  try {
    const raw = JSON.parse(json) as Partial<DevicePrefs>;
    return {
      enabled: raw.enabled !== false,
      categories: raw.categories && typeof raw.categories === 'object' ? raw.categories : {},
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function rowToDevice(row: PushDeviceRow): PushDevice {
  return {
    token: row.token,
    platform: row.platform,
    deviceName: row.device_name,
    prefs: parsePrefs(row.prefs),
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
  };
}

/**
 * Register or refresh a device. Idempotent on the token (PRIMARY KEY): a repeat
 * registration updates platform/name and bumps updated_at without clobbering
 * existing prefs unless new ones are supplied.
 */
export function registerDevice(input: {
  token: string;
  platform?: string | null;
  deviceName?: string | null;
  prefs?: Partial<DevicePrefs>;
}): PushDevice {
  if (!isValidExpoToken(input.token)) {
    throw new Error('invalid Expo push token');
  }
  const token = input.token.trim();
  const now = Date.now();
  const db = getDb();

  const existing = db
    .prepare('SELECT * FROM push_devices WHERE token = ?')
    .get(token) as PushDeviceRow | undefined;

  // Start from existing prefs (or defaults), then apply only the fields the
  // caller actually supplied — an absent field never clobbers a stored value.
  const base = existing ? parsePrefs(existing.prefs) : { ...DEFAULT_PREFS };
  const prefs: DevicePrefs = {
    enabled: input.prefs?.enabled !== undefined ? input.prefs.enabled : base.enabled,
    categories:
      input.prefs?.categories && typeof input.prefs.categories === 'object'
        ? { ...base.categories, ...input.prefs.categories }
        : base.categories,
  };

  db.prepare(
    `INSERT INTO push_devices (token, platform, device_name, prefs, enabled, created_at, updated_at, last_used_at)
     VALUES (@token, @platform, @device_name, @prefs, @enabled, @created_at, @updated_at, NULL)
     ON CONFLICT(token) DO UPDATE SET
       platform    = COALESCE(excluded.platform, push_devices.platform),
       device_name = COALESCE(excluded.device_name, push_devices.device_name),
       prefs       = excluded.prefs,
       enabled     = excluded.enabled,
       updated_at  = excluded.updated_at`,
  ).run({
    token,
    platform: input.platform ?? null,
    device_name: input.deviceName ?? null,
    prefs: JSON.stringify(prefs),
    enabled: prefs.enabled ? 1 : 0,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  });

  logger.info({ token: token.slice(0, 24) + '…', platform: input.platform }, 'push: device registered');
  return getDevice(token)!;
}

/** Update notification preferences (and/or the master enabled switch) for a token. */
export function setDevicePrefs(
  token: string,
  patch: { enabled?: boolean; categories?: CategoryPrefs },
): PushDevice | null {
  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM push_devices WHERE token = ?')
    .get(token) as PushDeviceRow | undefined;
  if (!existing) return null;

  const current = parsePrefs(existing.prefs);
  const next: DevicePrefs = {
    enabled: patch.enabled !== undefined ? patch.enabled : current.enabled,
    categories: patch.categories
      ? { ...current.categories, ...patch.categories }
      : current.categories,
  };

  db.prepare(
    'UPDATE push_devices SET prefs = ?, enabled = ?, updated_at = ? WHERE token = ?',
  ).run(JSON.stringify(next), next.enabled ? 1 : 0, Date.now(), token);

  return getDevice(token);
}

export function getDevice(token: string): PushDevice | null {
  const row = getDb()
    .prepare('SELECT * FROM push_devices WHERE token = ?')
    .get(token) as PushDeviceRow | undefined;
  return row ? rowToDevice(row) : null;
}

/** All registered devices (for debugging / a settings overview). */
export function listDevices(): PushDevice[] {
  const rows = getDb()
    .prepare('SELECT * FROM push_devices ORDER BY updated_at DESC')
    .all() as PushDeviceRow[];
  return rows.map(rowToDevice);
}

/** Tokens eligible for a notification in `category` (master + category opt-in). */
export function getEligibleTokens(category?: string): string[] {
  const rows = getDb()
    .prepare('SELECT * FROM push_devices WHERE enabled = 1')
    .all() as PushDeviceRow[];
  return rows
    .filter((row) => {
      if (!category) return true;
      const prefs = parsePrefs(row.prefs);
      return prefs.categories[category] !== false; // default-on per category
    })
    .map((row) => row.token);
}

/** Remove a device (unregister on logout / toggle-off / dead token). */
export function removeDevice(token: string): boolean {
  const info = getDb().prepare('DELETE FROM push_devices WHERE token = ?').run(token);
  return info.changes > 0;
}

/** Mark tokens as just-delivered-to (for staleness tracking). */
export function touchDevices(tokens: string[]): void {
  if (tokens.length === 0) return;
  const stmt = getDb().prepare('UPDATE push_devices SET last_used_at = ? WHERE token = ?');
  const now = Date.now();
  const tx = getDb().transaction((toks: string[]) => {
    for (const t of toks) stmt.run(now, t);
  });
  tx(tokens);
}
