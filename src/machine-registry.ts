/**
 * Machine registry — track connected secondaries with telemetry.
 * Primary pings secondaries via /api/sync/status; secondaries auto-register on first sync.
 * Secondaries report telemetry (CPU, RAM, disk, uptime, etc.) with each heartbeat.
 */

import os from 'node:os';
import { logger } from './logger.js';
import { upsertMachine, loadAllMachines } from './db.js';

export interface MachineTelemetry {
  cpuPercent?: number; // 0-100
  ramUsed?: number; // MB
  ramTotal?: number; // MB
  diskUsed?: number; // MB
  diskTotal?: number; // MB
  uptime?: number; // seconds
  loadAverage?: number; // 1-min average
}

export interface MachineInfo {
  machineId: string;
  primaryUrl?: string; // secondaries only
  lastSeen: number; // timestamp
  status: 'online' | 'offline';
  version?: string; // WildClaude version
  memoryCount?: number; // reported by sync/status
  sessionCount?: number; // active sessions
  telemetry?: MachineTelemetry;
  lastError?: string;
}

const registry = new Map<string, MachineInfo>();

/** Load persisted machines from SQLite into the in-memory registry at startup. */
export function seedRegistryFromDb(): void {
  try {
    const rows = loadAllMachines();
    for (const row of rows) {
      registry.set(row.machine_id, {
        machineId: row.machine_id,
        primaryUrl: row.primary_url ?? undefined,
        lastSeen: row.last_seen,
        status: 'offline', // assume offline until they re-register
        memoryCount: row.memory_count ?? undefined,
        sessionCount: row.session_count ?? undefined,
        version: row.version ?? undefined,
        telemetry: row.telemetry ? JSON.parse(row.telemetry) : undefined,
        lastError: row.last_error ?? undefined,
      });
    }
    if (rows.length) logger.info({ count: rows.length }, 'Machine registry seeded from DB');
  } catch (err) {
    logger.warn({ err }, 'Could not seed machine registry from DB');
  }
}

export function registerMachine(id: string, url?: string): void {
  const existing = registry.get(id);
  const now = Date.now();

  const info: MachineInfo = {
    machineId: id,
    primaryUrl: url,
    lastSeen: now,
    status: 'online',
    memoryCount: existing?.memoryCount,
    telemetry: existing?.telemetry,
    version: existing?.version,
    sessionCount: existing?.sessionCount,
  };
  registry.set(id, info);
  try { upsertMachine({ machineId: id, primaryUrl: url, status: 'online', lastSeen: now, memoryCount: existing?.memoryCount, version: existing?.version, telemetry: existing?.telemetry, sessionCount: existing?.sessionCount }); } catch { /* non-fatal */ }

  logger.info({ machineId: id, url }, 'Machine registered');
}

export function updateMachineStatus(
  id: string,
  online: boolean,
  memoryCount?: number,
  telemetry?: MachineTelemetry,
  version?: string,
  sessionCount?: number,
  lastError?: string,
): void {
  const machine = registry.get(id);
  if (!machine) {
    registerMachine(id);
    return;
  }

  machine.status = online ? 'online' : 'offline';
  machine.lastSeen = Date.now();
  if (memoryCount !== undefined) machine.memoryCount = memoryCount;
  if (telemetry) machine.telemetry = telemetry;
  if (version) machine.version = version;
  if (sessionCount !== undefined) machine.sessionCount = sessionCount;
  if (lastError !== undefined) machine.lastError = lastError;

  try {
    upsertMachine({
      machineId: id, primaryUrl: machine.primaryUrl, status: machine.status,
      lastSeen: machine.lastSeen, memoryCount: machine.memoryCount,
      sessionCount: machine.sessionCount, version: machine.version,
      telemetry: machine.telemetry, lastError: machine.lastError,
    });
  } catch { /* non-fatal */ }
}

export function getMachines(): MachineInfo[] {
  const now = Date.now();
  const result = Array.from(registry.values());

  // Mark offline if not seen in 2 minutes
  for (const m of result) {
    if (m.status === 'online' && now - m.lastSeen > 2 * 60 * 1000) {
      m.status = 'offline';
    }
  }

  return result;
}

export function getMachine(id: string): MachineInfo | null {
  return registry.get(id) || null;
}

export function pruneOffline(maxAgeMs = 10 * 60 * 1000): void {
  const now = Date.now();
  for (const [id, m] of registry) {
    if (m.status === 'offline' && now - m.lastSeen > maxAgeMs) {
      registry.delete(id);
      logger.info({ machineId: id }, 'Offline machine pruned');
    }
  }
}

/** Collect system telemetry for heartbeat reporting. */
export async function collectTelemetry(): Promise<MachineTelemetry> {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(execFile);

  const telemetry: MachineTelemetry = {};

  try {
    // CPU usage — 1-minute load average
    if (process.platform !== 'win32') {
      const { stdout: loadStr } = await execAsync('uptime');
      const match = loadStr.match(/load average[s]?: ([\d.]+)/);
      if (match) {
        const numCores = os.cpus().length;
        telemetry.loadAverage = parseFloat(match[1]);
        telemetry.cpuPercent = Math.min(100, (telemetry.loadAverage / numCores) * 100);
      }
    }
  } catch {
    /* ignore */
  }

  try {
    // RAM usage
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    telemetry.ramTotal = Math.round(totalMem / 1024 / 1024);
    telemetry.ramUsed = Math.round((totalMem - freeMem) / 1024 / 1024);
  } catch {
    /* ignore */
  }

  try {
    // Disk usage — root FS only
    if (process.platform !== 'win32') {
      const { stdout: dfStr } = await execAsync('df', ['-B1', '/']);
      const lines = dfStr.trim().split('\n');
      if (lines[1]) {
        const parts = lines[1].split(/\s+/);
        const total = parseInt(parts[1], 10);
        const used = parseInt(parts[2], 10);
        if (total && used >= 0) {
          telemetry.diskTotal = Math.round(total / 1024 / 1024);
          telemetry.diskUsed = Math.round(used / 1024 / 1024);
        }
      }
    }
  } catch {
    /* ignore */
  }

  try {
    // Uptime
    telemetry.uptime = Math.round(os.uptime());
  } catch {
    /* ignore */
  }

  return telemetry;
}
