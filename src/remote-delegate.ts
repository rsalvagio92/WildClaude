/**
 * Remote machine delegation — forwards tasks to secondary WildClaude nodes
 * (WB2, WB3) when WB1's queue is saturated.
 *
 * Config: REMOTE_AGENTS env var (JSON array):
 *   [{"name":"WB2","url":"http://100.89.238.16:3141","token":"<dashboard-token>"}]
 */

import https from 'https';

import { getSecret } from './secrets.js';
import { logger } from './logger.js';

// Accept self-signed certs from fleet nodes (Tailscale internal — not exposed to internet)
const INSECURE_AGENT = new https.Agent({ rejectUnauthorized: false });

export interface RemoteAgent {
  name: string;
  url: string;
  token: string;
}

let _agents: RemoteAgent[] | null = null;

async function loadAgents(): Promise<RemoteAgent[]> {
  if (_agents !== null) return _agents;
  // REMOTE_AGENTS lives in the encrypted secrets store (getSecret falls back
  // to .env / process.env automatically) — readEnvFile alone would miss it.
  const raw = (await getSecret('REMOTE_AGENTS')) || process.env.REMOTE_AGENTS || '';
  if (!raw) {
    _agents = [];
    return _agents;
  }
  try {
    const parsed = JSON.parse(raw);
    _agents = Array.isArray(parsed) ? parsed : [];
  } catch {
    logger.warn({ raw: raw.slice(0, 100) }, 'REMOTE_AGENTS: invalid JSON, ignoring');
    _agents = [];
  }
  return _agents;
}

/** Reset cached agents (after REMOTE_AGENTS secret is updated) */
export function resetRemoteAgents(): void {
  _agents = null;
}

/** Get configured remote agents with url+token */
export async function getAvailableRemoteAgents(): Promise<RemoteAgent[]> {
  return (await loadAgents()).filter(a => a.url && a.token && a.name);
}

export interface RemoteTaskResult {
  text: string;
  agentName: string;
}

/**
 * Delegate a task to a remote WildClaude node.
 * The remote node runs runAgent() and returns the result.
 * Times out after timeoutMs (default 5 min).
 */
/**
 * Quick status check — returns true if the remote machine is currently busy
 * (processing a Telegram message OR already handling a remote task).
 * Times out in 3s so it never stalls the caller.
 */
export async function isRemoteBusy(agent: RemoteAgent): Promise<boolean> {
  const load = await getRemoteLoad(agent);
  if (load === null) return false; // unreachable — delegateToRemote will discover that
  return load.busy || load.queueDepth > 0;
}

export interface RemoteLoad {
  busy: boolean;
  /** Total pending work (telegram queue + in-flight remote tasks). */
  queueDepth: number;
  /** True if the machine answered the status probe at all. */
  reachable: boolean;
}

/**
 * Probe a remote machine's load. Returns null if unreachable.
 * `queueDepth` lets the caller pick the least-loaded peer (not just any free one).
 * Falls back gracefully if the peer runs older code without queueDepth/status.
 */
export async function getRemoteLoad(agent: RemoteAgent): Promise<RemoteLoad | null> {
  try {
    const fetchOpts: RequestInit & { agent?: unknown } = {
      headers: { 'Authorization': `Bearer ${agent.token}` },
      signal: AbortSignal.timeout(3000),
    };
    if (agent.url.startsWith('https://')) fetchOpts.agent = INSECURE_AGENT;
    const resp = await fetch(`${agent.url}/api/machine/status`, fetchOpts);
    if (!resp.ok) {
      // Old code without the status endpoint — assume reachable & idle.
      return { busy: false, queueDepth: 0, reachable: true };
    }
    const data = await resp.json() as { busy?: boolean; activeRemoteTasks?: number; queueDepth?: number };
    const busy = !!data.busy;
    // queueDepth from new peers; fall back to activeRemoteTasks (+busy) for older ones.
    const queueDepth = data.queueDepth ?? ((data.activeRemoteTasks ?? 0) + (busy ? 1 : 0));
    return { busy, queueDepth, reachable: true };
  } catch {
    return null; // timeout or unreachable
  }
}

/**
 * From the configured agents, return those that are reachable and not busy,
 * sorted ascending by queue depth (least-loaded first).
 */
export async function pickLeastLoadedAgents(agents: RemoteAgent[]): Promise<RemoteAgent[]> {
  const loads = await Promise.all(agents.map(async a => ({ agent: a, load: await getRemoteLoad(a) })));
  return loads
    .filter(x => x.load !== null && !x.load.busy)
    .sort((a, b) => (a.load!.queueDepth - b.load!.queueDepth))
    .map(x => x.agent);
}

export async function delegateToRemote(
  agent: RemoteAgent,
  message: string,
  model?: string,
  timeoutMs = 300_000,
): Promise<RemoteTaskResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const fetchOpts: RequestInit & { agent?: unknown } = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${agent.token}`,
      },
      body: JSON.stringify({ message, model }),
      signal: controller.signal,
    };
    // Accept self-signed certs for HTTPS fleet nodes (Tailscale internal)
    if (agent.url.startsWith('https://')) {
      fetchOpts.agent = INSECURE_AGENT;
    }
    const resp = await fetch(`${agent.url}/api/remote-task`, fetchOpts);
    clearTimeout(timer);

    if (!resp.ok) {
      logger.warn({ status: resp.status, agent: agent.name }, 'Remote agent HTTP error');
      return null;
    }

    const data = await resp.json() as { text?: string; error?: string };
    if (!data.text) return null;

    return { text: data.text, agentName: agent.name };
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('aborted') || msg.includes('AbortError')) {
      logger.warn({ agent: agent.name, timeoutMs }, 'Remote agent timed out');
    } else {
      logger.warn({ err: msg, agent: agent.name }, 'Remote agent delegation failed');
    }
    return null;
  }
}
