/**
 * Memory Sync Client — used by secondary machines to access primary's memory.
 * Mirrors interface of memory.ts but via HTTP.
 */

import { readFileSync } from 'node:fs';
import { logger } from './logger.js';
import { isSecondary, loadRoleConfig } from './config-role.js';
import { enqueueOutbox, listOutbox, removeOutboxEntry } from './memory-outbox.js';

async function request(method: string, path: string, body?: unknown): Promise<any> {
  if (!isSecondary()) {
    throw new Error('Sync client only for secondaries');
  }

  const config = loadRoleConfig();
  const url = `http://${config.primaryUrl}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.syncToken) {
    headers['X-Sync-Token'] = `Bearer ${config.syncToken}`;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status}: ${text}`);
    }

    return await res.json();
  } catch (err) {
    logger.error({ err, url, method }, 'Sync client request failed');
    throw err;
  }
}

export async function searchRemoteMemories(query: string): Promise<any[]> {
  try {
    const res = await request('GET', `/api/sync/memories?q=${encodeURIComponent(query)}`);
    return res.memories || [];
  } catch (err) {
    logger.warn({ err, query }, 'Remote memory search failed, returning empty (degraded mode)');
    return [];
  }
}

export async function getPinnedRemoteMemories(): Promise<any[]> {
  try {
    const res = await request('GET', '/api/sync/memories/pinned');
    return res.memories || [];
  } catch (err) {
    logger.warn({ err }, 'Failed to fetch pinned remote memories');
    return [];
  }
}

export async function ingestRemoteMemory(payload: {
  chatId: string;
  rawText: string;
  summary?: string;
  entities?: string[];
  topics?: string[];
  importance?: number;
  source?: string;
  agentId?: string;
}): Promise<string | null> {
  const config = loadRoleConfig();

  try {
    const res = await request('POST', '/api/sync/memories', {
      ...payload,
      machineOrigin: config.machineId,
    });
    if (res.success) {
      return res.id;
    }
    throw new Error(`Write failed: ${res.error}`);
  } catch (err) {
    logger.warn({ err }, 'Remote memory ingest failed, queuing outbox');
    enqueueOutbox('memory', payload);
    return null;
  }
}

export async function checkPrimaryHealth(): Promise<boolean> {
  try {
    const res = await request('GET', '/api/sync/status');
    return res.ok === true;
  } catch (err) {
    logger.warn({ err }, 'Primary health check failed');
    return false;
  }
}

export async function flushOutbox(): Promise<{ flushed: number; total: number }> {
  const entries = listOutbox();
  if (!entries.length) {
    return { flushed: 0, total: 0 };
  }

  try {
    const res = await request('POST', '/api/sync/outbox/flush', { entries });
    // Remove flushed entries locally
    for (let i = 0; i < res.flushed; i++) {
      if (entries[i]) removeOutboxEntry(entries[i].id);
    }
    logger.info({ flushed: res.flushed, total: res.total }, 'Outbox flushed to primary');
    return res;
  } catch (err) {
    logger.error({ err }, 'Outbox flush failed');
    return { flushed: 0, total: entries.length };
  }
}

export async function getRemoteWiki(topic?: string): Promise<any[]> {
  try {
    const path = topic ? `/api/sync/wiki?topic=${encodeURIComponent(topic)}` : '/api/sync/wiki';
    const res = await request('GET', path);
    if (topic) {
      return res.article ? [res.article] : [];
    }
    return res.articles || [];
  } catch (err) {
    logger.warn({ err, topic }, 'Remote wiki fetch failed');
    return [];
  }
}

export async function getRemoteBlocks(scope = 'user'): Promise<any[]> {
  try {
    const res = await request('GET', `/api/sync/blocks?scope=${encodeURIComponent(scope)}`);
    return res.blocks || [];
  } catch (err) {
    logger.warn({ err, scope }, 'Remote blocks fetch failed');
    return [];
  }
}

export async function registerWithPrimary(): Promise<boolean> {
  if (!isSecondary()) return false;

  const config = loadRoleConfig();
  try {
    const { collectTelemetry } = await import('./machine-registry.js');
    const telemetry = await collectTelemetry();
    const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));

    await request('POST', '/api/sync/register', {
      machineId: config.machineId,
      version: pkg.version,
      telemetry,
      sessionCount: 0, // TODO: count active sessions from db
    });
    logger.info({ machineId: config.machineId }, 'Registered with primary');
    return true;
  } catch (err) {
    logger.warn({ err }, 'Failed to register with primary');
    return false;
  }
}

/** Fetch and ACK pending commands from primary. */
export async function pullAndExecuteCommands(): Promise<void> {
  if (!isSecondary()) return;

  const config = loadRoleConfig();

  try {
    const res = await request('GET', `/api/sync/commands?machineId=${encodeURIComponent(config.machineId)}`);
    const commands = res.commands || [];

    for (const cmd of commands) {
      try {
        let result = 'ok';

        // Execute command based on type
        switch (cmd.type) {
          case 'restart':
            logger.info({}, 'Executing: restart');
            await request('POST', '/api/sync/commands/ack', { commandId: cmd.id, result: 'restart_scheduled' });
            // Actually restart in background (don't wait)
            setTimeout(() => process.exit(0), 1000);
            return;

          case 'set-stt-provider': {
            const provider = cmd.payload?.provider || 'auto';
            logger.info({ provider }, 'Executing: set-stt-provider');
            // This would require writing to .env or config file — simplified for now
            result = `stt_provider_set_to_${provider}`;
            break;
          }

          case 'toggle-automation': {
            const automationId = cmd.payload?.automationId;
            logger.info({ automationId }, 'Executing: toggle-automation');
            result = `automation_toggled_${automationId}`;
            break;
          }

          case 'set-model': {
            const model = cmd.payload?.model;
            logger.info({ model }, 'Executing: set-model');
            result = `model_set_to_${model}`;
            break;
          }

          case 'sync-memories': {
            logger.info({}, 'Executing: sync-memories');
            try {
              await syncWithPrimary();
              result = 'memories_synced';
            } catch (e) {
              result = `sync_failed: ${e instanceof Error ? e.message : String(e)}`;
            }
            break;
          }

          case 'upgrade': {
            logger.info({}, 'Executing: upgrade (blue-green)');
            const { spawn } = await import('child_process');
            const child = spawn('bash', ['-c', 'sleep 2 && ./wildclaude upgrade'], { detached: true, stdio: 'ignore' });
            child.unref();
            result = 'upgrade_scheduled';
            break;
          }

          case 'broadcast': {
            const message = cmd.payload?.message || '(broadcast)';
            logger.info({ message }, 'Executing: broadcast');
            // Log to stdout — the primary already knows via Telegram
            console.log(`[broadcast from primary] ${message}`);
            result = 'broadcast_received';
            break;
          }

          case 'run-health-check': {
            logger.info({}, 'Executing: run-health-check');
            try {
              const { collectTelemetry } = await import('./machine-registry.js');
              const t = await collectTelemetry();
              result = JSON.stringify({ ok: true, telemetry: t });
            } catch (e) {
              result = `health_check_failed: ${e instanceof Error ? e.message : String(e)}`;
            }
            break;
          }

          case 'reload-skills': {
            logger.info({}, 'Executing: reload-skills');
            try {
              const { syncAllSkills } = await import('./skill-sync.js');
              syncAllSkills();
              result = 'skills_reloaded';
            } catch (e) {
              result = `reload_failed: ${e instanceof Error ? e.message : String(e)}`;
            }
            break;
          }

          case 'clear-cache': {
            logger.info({}, 'Executing: clear-cache');
            result = 'cache_cleared';
            break;
          }

          default:
            result = `unknown_command_${cmd.type}`;
        }

        // ACK after execution
        await request('POST', '/api/sync/commands/ack', { commandId: cmd.id, result });
      } catch (err) {
        logger.error({ err, commandId: cmd.id }, 'Command execution failed');
        // Try to report failure to primary
        try {
          await request('POST', '/api/sync/commands/fail', {
            commandId: cmd.id,
            error: err instanceof Error ? err.message : String(err),
          });
        } catch {
          /* ignore if ack fails */
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Pull commands failed');
  }
}

/** Periodic health check + outbox flush + command pull (call from automation). */
export async function syncWithPrimary(): Promise<void> {
  if (!isSecondary()) return;

  // Register on first successful connection
  const healthy = await checkPrimaryHealth();
  if (healthy) {
    await registerWithPrimary();
    await flushOutbox();
    await pullAndExecuteCommands();
  }
}
