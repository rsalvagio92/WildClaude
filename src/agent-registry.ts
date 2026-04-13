import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

import { PROJECT_ROOT } from './config.js';
import { logger } from './logger.js';
import { USER_DATA_DIR } from './paths.js';

// ── Types ────────────────────────────────────────────────────────────

export interface RegisteredAgent {
  id: string;
  name: string;
  description: string;
  model: string;
  lane: string;
}

// ── Registry load ────────────────────────────────────────────────────

const REGISTRY_PATH = path.join(PROJECT_ROOT, 'agents', 'registry.yaml');

/** Cached registry, loaded once on first access. */
let _registry: RegisteredAgent[] | null = null;

/**
 * Parse YAML front-matter from an agent .md file and return metadata overrides.
 * Returns null if no valid front-matter found.
 */
function parseFrontmatter(content: string): Partial<RegisteredAgent> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  try {
    const fm = yaml.load(match[1]) as Record<string, string>;
    const result: Partial<RegisteredAgent> = {};
    if (fm.name) result.name = fm.name;
    if (fm.description) result.description = fm.description.replace(/\s+/g, ' ').trim();
    if (fm.model) result.model = fm.model;
    if (fm.lane) result.lane = fm.lane;
    return result;
  } catch { return null; }
}

/**
 * Scan USER_DATA_DIR/agents/ for overlay .md files and merge their
 * front-matter metadata into the registry. This ensures that edits
 * made via the dashboard (which write to overlay) are reflected.
 */
function applyOverlayMetadata(agents: RegisteredAgent[]): RegisteredAgent[] {
  const overlayDir = path.join(USER_DATA_DIR, 'agents');
  if (!fs.existsSync(overlayDir)) return agents;

  const agentMap = new Map(agents.map((a) => [a.id, { ...a }]));

  try {
    for (const lane of fs.readdirSync(overlayDir)) {
      const laneDir = path.join(overlayDir, lane);
      if (!fs.statSync(laneDir).isDirectory()) continue;
      for (const file of fs.readdirSync(laneDir)) {
        if (!file.endsWith('.md')) continue;
        const id = file.replace(/\.md$/, '');
        try {
          const content = fs.readFileSync(path.join(laneDir, file), 'utf-8');
          const overrides = parseFrontmatter(content);
          if (!overrides) continue;
          if (agentMap.has(id)) {
            // Merge overlay metadata into existing registry entry
            Object.assign(agentMap.get(id)!, overrides);
          } else {
            // Overlay-only agent (not in registry.yaml) — add it
            agentMap.set(id, {
              id,
              name: overrides.name ?? id,
              description: overrides.description ?? '',
              model: overrides.model ?? 'claude-sonnet-4-6',
              lane: overrides.lane ?? lane,
            });
          }
        } catch { /* skip unreadable files */ }
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to scan overlay agents');
  }

  return Array.from(agentMap.values());
}

function loadRegistry(): RegisteredAgent[] {
  if (_registry !== null) return _registry;

  let baseAgents: RegisteredAgent[] = [];

  if (fs.existsSync(REGISTRY_PATH)) {
    try {
      const raw = yaml.load(fs.readFileSync(REGISTRY_PATH, 'utf-8')) as {
        agents?: Array<{
          id: string;
          name: string;
          description: string;
          model: string;
          lane: string;
        }>;
      };

      baseAgents = (raw?.agents ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        description: (a.description ?? '').replace(/\s+/g, ' ').trim(),
        model: a.model ?? 'claude-sonnet-4-6',
        lane: a.lane ?? 'domain',
      }));
    } catch (err) {
      logger.error({ err, path: REGISTRY_PATH }, 'Failed to parse agents/registry.yaml');
    }
  } else {
    logger.warn({ path: REGISTRY_PATH }, 'agents/registry.yaml not found — loading from overlay only');
  }

  // Merge with overlay metadata (user edits from dashboard)
  _registry = applyOverlayMetadata(baseAgents);

  logger.info(
    { count: _registry.length, ids: _registry.map((a) => a.id) },
    'Agent registry loaded (base + overlay)',
  );

  return _registry;
}

// ── Public API ───────────────────────────────────────────────────────

/** Force-reload registry from disk on next access. */
export function reloadRegistry(): void {
  _registry = null;
}

/** Return all registered agents with full metadata. */
export function getRegisteredAgents(): RegisteredAgent[] {
  return [...loadRegistry()];
}

/** Return agents belonging to a specific lane (case-insensitive). */
export function getAgentsByLane(lane: string): RegisteredAgent[] {
  const target = lane.toLowerCase();
  return loadRegistry().filter((a) => a.lane.toLowerCase() === target);
}

/**
 * Suggest an agent for a user message using keyword matching against
 * the agent descriptions (which embed trigger keywords).
 * Returns the best-matching agent or null if nothing matches.
 */
export function findAgentForMessage(message: string): RegisteredAgent | null {
  const lower = message.toLowerCase();
  const registry = loadRegistry();

  let bestAgent: RegisteredAgent | null = null;
  let bestScore = 0;

  for (const agent of registry) {
    // Extract trigger keywords from the description.
    // Descriptions follow the pattern: "... Trigger keywords: kw1, kw2, ..."
    const triggerMatch = agent.description.match(/trigger keywords?:\s*([^.]+)/i);
    const keywords: string[] = triggerMatch
      ? triggerMatch[1].split(',').map((k) => k.trim().toLowerCase())
      : [];

    let score = 0;
    for (const kw of keywords) {
      if (kw && lower.includes(kw)) {
        // Longer keyword matches score higher (more specific)
        score += kw.length;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestAgent = agent;
    }
  }

  return bestScore > 0 ? bestAgent : null;
}

/**
 * Resolve the path to an agent's .md definition file.
 * Checks user overlay (USER_DATA_DIR) first, then PROJECT_ROOT.
 * Returns null if the file does not exist in either location.
 */
function resolveAgentMdPath(agentId: string): string | null {
  const registry = loadRegistry();
  const agent = registry.find((a) => a.id === agentId);
  if (!agent) return null;

  // User overlay takes priority
  const userPath = path.join(USER_DATA_DIR, 'agents', agent.lane, `${agentId}.md`);
  if (fs.existsSync(userPath)) return userPath;

  const mdPath = path.join(PROJECT_ROOT, 'agents', agent.lane, `${agentId}.md`);
  return fs.existsSync(mdPath) ? mdPath : null;
}

/**
 * Read the full .md file content (including YAML front-matter).
 * Used for editing and updating agent definitions.
 */
export function getAgentFullContent(agentId: string): string {
  const mdPath = resolveAgentMdPath(agentId);
  if (!mdPath) return '';
  return fs.readFileSync(mdPath, 'utf-8');
}

/**
 * Read the agent's .md file and return everything after the YAML front-matter
 * block as the system prompt.  Returns an empty string if the file doesn't exist
 * or has no body after the front-matter.
 */
export function getAgentSystemPrompt(agentId: string): string {
  const mdPath = resolveAgentMdPath(agentId);
  if (!mdPath) {
    logger.warn({ agentId }, 'No .md file found for custom agent — using empty system prompt');
    return '';
  }

  const content = fs.readFileSync(mdPath, 'utf-8');

  // Strip YAML front-matter (--- ... ---)
  const fmMatch = content.match(/^---[\s\S]*?---\n?([\s\S]*)$/);
  const body = fmMatch ? fmMatch[1].trim() : content.trim();

  return body;
}
