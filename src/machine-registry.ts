/**
 * Machine registry — track connected secondaries.
 * Primary pings secondaries via /api/sync/status; secondaries auto-register on first sync.
 */

import { logger } from './logger.js';

export interface MachineInfo {
  machineId: string;
  primaryUrl?: string; // secondaries only
  lastSeen: number; // timestamp
  status: 'online' | 'offline';
  memoryCount?: number; // reported by sync/status
}

const registry = new Map<string, MachineInfo>();

export function registerMachine(id: string, url?: string): void {
  const existing = registry.get(id);
  const now = Date.now();

  registry.set(id, {
    machineId: id,
    primaryUrl: url,
    lastSeen: now,
    status: 'online',
    memoryCount: existing?.memoryCount,
  });

  logger.info({ machineId: id, url }, 'Machine registered');
}

export function updateMachineStatus(id: string, online: boolean, memoryCount?: number): void {
  const machine = registry.get(id);
  if (!machine) {
    registerMachine(id);
    return;
  }

  machine.status = online ? 'online' : 'offline';
  machine.lastSeen = Date.now();
  if (memoryCount !== undefined) machine.memoryCount = memoryCount;
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
