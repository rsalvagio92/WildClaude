/**
 * Data importer for WildClaude.
 *
 * Imports data from previous AI assistants for smooth transition:
 * - OpenClaw / NanoClaw (SQLite DB, conversation logs, memories)
 * - ClaudeClaw (SQLite DB, CLAUDE.md, memories, conversations)
 * - bOS (state/ markdown files: tasks, projects, notes, goals)
 * - Claude Code (CLAUDE.md, ~/.claude/ memory files)
 * - Generic markdown (any .md files as memories)
 * - Generic JSON (conversation exports, memory dumps)
 * - Generic SQLite (any DB with conversation/memory tables)
 *
 * Also accessible from the dashboard UI for drag-and-drop import.
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { Bot, Context } from 'grammy';

import { saveStructuredMemory, initDatabase } from './db.js';
import { writeMemoryToFile } from './memory-files.js';
import { lifePath, USER_DATA_DIR } from './paths.js';
import { ALLOWED_CHAT_ID, PROJECT_ROOT } from './config.js';
import { logger } from './logger.js';

export interface ImportResult {
  source: string;
  memoriesImported: number;
  conversationsImported: number;
  filesImported: number;
  errors: string[];
}

// ── Source detection ──────────────────────────────────────────────────

interface DetectedSource {
  type: 'openclaw' | 'claudeclaw' | 'bos' | 'claude-code' | 'claude-mem' | 'markdown' | 'json' | 'sqlite';
  path: string;
  description: string;
  size: string;
}

/**
 * Scan common locations for importable data sources.
 */
export function detectSources(): DetectedSource[] {
  const sources: DetectedSource[] = [];
  const home = process.env.HOME || process.env.USERPROFILE || '';

  // OpenClaw locations
  for (const dir of ['openclaw', 'OpenClaw', 'open-claw', '.openclaw', 'nanoclaw', 'NanoClaw']) {
    const p = path.join(home, dir);
    if (fs.existsSync(p)) {
      const dbFiles = findFiles(p, '.db');
      const mdFiles = findFiles(p, '.md');
      sources.push({
        type: 'openclaw',
        path: p,
        description: `OpenClaw data: ${dbFiles.length} databases, ${mdFiles.length} markdown files`,
        size: dirSize(p),
      });
    }
  }

  // ClaudeClaw
  const ccDir = path.join(home, '.claudeclaw');
  if (fs.existsSync(ccDir)) {
    sources.push({
      type: 'claudeclaw',
      path: ccDir,
      description: 'Previous WildClaude/ClaudeClaw config and CLAUDE.md',
      size: dirSize(ccDir),
    });
  }

  // ClaudeClaw store (project-local)
  const ccStore = path.join(PROJECT_ROOT, 'store', 'claudeclaw.db');
  if (fs.existsSync(ccStore)) {
    const stat = fs.statSync(ccStore);
    sources.push({
      type: 'claudeclaw',
      path: ccStore,
      description: 'Previous WildClaude/ClaudeClaw database (memories, conversations, tokens)',
      size: formatBytes(stat.size),
    });
  }

  // bOS state files
  for (const dir of ['bOS', 'bos', '.bos']) {
    const p = path.join(home, dir);
    if (fs.existsSync(p)) {
      const stateDir = path.join(p, 'state');
      if (fs.existsSync(stateDir)) {
        sources.push({
          type: 'bos',
          path: stateDir,
          description: 'bOS state files (tasks, projects, notes, goals)',
          size: dirSize(stateDir),
        });
      }
    }
  }

  // claude-mem (community memory system — highest value, 1500+ observations)
  const claudeMemDb = path.join(home, '.claude-mem', 'claude-mem.db');
  if (fs.existsSync(claudeMemDb)) {
    const stat = fs.statSync(claudeMemDb);
    sources.push({
      type: 'claude-mem' as DetectedSource['type'],
      path: claudeMemDb,
      description: `claude-mem database (observations, summaries, prompts — ${formatBytes(stat.size)})`,
      size: formatBytes(stat.size),
    });
  }

  // Claude Code memories + history
  const claudeDir = path.join(home, '.claude');
  if (fs.existsSync(claudeDir)) {
    const historyFile = path.join(claudeDir, 'history.jsonl');
    if (fs.existsSync(historyFile)) {
      sources.push({
        type: 'claude-code',
        path: historyFile,
        description: 'Claude Code command history (JSONL)',
        size: formatBytes(fs.statSync(historyFile).size),
      });
    }
    const memoryDir = path.join(claudeDir, 'memory');
    const claudeMd = path.join(claudeDir, 'CLAUDE.md');
    if (fs.existsSync(memoryDir) || fs.existsSync(claudeMd)) {
      sources.push({
        type: 'claude-code',
        path: claudeDir,
        description: 'Claude Code memories and settings',
        size: dirSize(claudeDir),
      });
    }
  }

  // Existing WildClaude data (for re-import after reinstall)
  const wcpDir = path.join(home, '.wild-claude-pi');
  if (fs.existsSync(path.join(wcpDir, 'memories'))) {
    sources.push({
      type: 'markdown',
      path: path.join(wcpDir, 'memories'),
      description: 'Previous WildClaude memory files',
      size: dirSize(path.join(wcpDir, 'memories')),
    });
  }

  return sources;
}

// ── Importers ────────────────────────────────────────────────────────

/**
 * Full OpenClaw import — agents, cron, MCP, secrets, memory, workspace.
 * Returns a detailed result including what was imported per category.
 */
export async function importFromOpenClaw(openclawDir: string, chatId: string): Promise<ImportResult> {
  const result: ImportResult = { source: openclawDir, memoriesImported: 0, conversationsImported: 0, filesImported: 0, errors: [] };

  try {
    // ── 1. Secrets (API keys from openclaw.json) ─────────────────
    const configFile = path.join(openclawDir, 'openclaw.json');
    if (fs.existsSync(configFile)) {
      try {
        const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
        const envVars = config?.env?.vars;
        if (envVars && typeof envVars === 'object') {
          const { setSecret } = await import('./secrets.js');
          for (const [key, value] of Object.entries(envVars)) {
            if (typeof value === 'string' && value.length > 5) {
              setSecret(key, value);
              result.filesImported++;
              logger.info({ key }, 'Imported OpenClaw secret');
            }
          }
        }
      } catch (err) {
        result.errors.push(`openclaw.json secrets: ${err}`);
      }
    }

    // ── 2. MCP servers (from workspace/config/mcporter.json) ─────
    const mcpFile = path.join(openclawDir, 'workspace', 'config', 'mcporter.json');
    if (fs.existsSync(mcpFile)) {
      try {
        const mcpConfig = JSON.parse(fs.readFileSync(mcpFile, 'utf-8'));
        if (mcpConfig?.mcpServers) {
          // Write to project .mcp.json, merging with existing
          const projectMcp = path.join(PROJECT_ROOT, '.mcp.json');
          let existing: Record<string, unknown> = { mcpServers: {} };
          try {
            if (fs.existsSync(projectMcp)) existing = JSON.parse(fs.readFileSync(projectMcp, 'utf-8'));
          } catch { /* empty */ }
          const merged = { ...existing, mcpServers: { ...(existing as { mcpServers: Record<string, unknown> }).mcpServers, ...mcpConfig.mcpServers } };
          fs.writeFileSync(projectMcp, JSON.stringify(merged, null, 2));
          result.filesImported++;
          logger.info({ servers: Object.keys(mcpConfig.mcpServers) }, 'Imported OpenClaw MCP servers');
        }
      } catch (err) {
        result.errors.push(`MCP config: ${err}`);
      }
    }

    // ── 3. Cron jobs (from cron/jobs.json) ───────────────────────
    const cronFile = path.join(openclawDir, 'cron', 'jobs.json');
    if (fs.existsSync(cronFile)) {
      try {
        const cronConfig = JSON.parse(fs.readFileSync(cronFile, 'utf-8'));
        const jobs = cronConfig?.jobs;
        if (Array.isArray(jobs)) {
          // Save each enabled cron job as a memory + log to kernel
          for (const job of jobs) {
            if (!job.name) continue;
            const status = job.enabled ? 'enabled' : 'disabled';
            const schedule = job.schedule?.everyMs
              ? `every ${Math.round(job.schedule.everyMs / 60000)}min`
              : (job.schedule?.cron || 'unknown');
            const prompt = job.payload?.message || '';
            const summary = `[OpenClaw cron] ${job.name} (${status}): ${schedule} — ${prompt.slice(0, 150)}`;

            saveStructuredMemory(chatId, prompt || summary, summary, [job.name], ['automation', 'cron'], 0.6, 'import-openclaw', 'main');
            result.memoriesImported++;
          }
          logger.info({ count: jobs.length }, 'Imported OpenClaw cron jobs');
        }
      } catch (err) {
        result.errors.push(`Cron jobs: ${err}`);
      }
    }

    // ── 4. Agents (from agents/ directories) ─────────────────────
    const agentsDir = path.join(openclawDir, 'agents');
    if (fs.existsSync(agentsDir)) {
      try {
        for (const agentId of fs.readdirSync(agentsDir)) {
          const agentDir = path.join(agentsDir, agentId);
          if (!fs.statSync(agentDir).isDirectory()) continue;

          // Read agent sessions for context
          const sessionsFile = path.join(agentDir, 'sessions', 'sessions.json');
          if (fs.existsSync(sessionsFile)) {
            try {
              const sessions = JSON.parse(fs.readFileSync(sessionsFile, 'utf-8'));
              const sessionCount = Object.keys(sessions?.sessions || sessions || {}).length;
              if (sessionCount > 0) {
                saveStructuredMemory(chatId, `OpenClaw agent "${agentId}" had ${sessionCount} sessions`, `[OpenClaw agent] ${agentId}: ${sessionCount} sessions`, [agentId], ['agents'], 0.5, 'import-openclaw', 'main');
                result.memoriesImported++;
              }
            } catch { /* skip */ }
          }
        }
        logger.info('Imported OpenClaw agent metadata');
      } catch (err) {
        result.errors.push(`Agents: ${err}`);
      }
    }

    // ── 5. Workspace memory (.md files) ──────────────────────────
    const workspaceMemory = path.join(openclawDir, 'workspace', 'memory');
    if (fs.existsSync(workspaceMemory)) {
      const mdResult = importFromMarkdown(workspaceMemory, chatId);
      result.memoriesImported += mdResult.memoriesImported;
      result.filesImported += mdResult.filesImported;
      result.errors.push(...mdResult.errors);
    }

    // ── 6. SQLite memory databases ───────────────────────────────
    const memoryDir = path.join(openclawDir, 'memory');
    if (fs.existsSync(memoryDir)) {
      for (const file of fs.readdirSync(memoryDir)) {
        if (file.endsWith('.sqlite')) {
          const dbResult = importFromSqlite(path.join(memoryDir, file), chatId);
          result.memoriesImported += dbResult.memoriesImported;
          result.conversationsImported += dbResult.conversationsImported;
          result.errors.push(...dbResult.errors);
        }
      }
    }

    // ── 7. Services config (project context) ─────────────────────
    const servicesFile = path.join(openclawDir, 'workspace', 'config', 'services.json');
    if (fs.existsSync(servicesFile)) {
      try {
        const services = fs.readFileSync(servicesFile, 'utf-8');
        saveStructuredMemory(chatId, services.slice(0, 2000), '[OpenClaw services config] Project configurations and service endpoints', ['services', 'config'], ['development', 'architecture'], 0.7, 'import-openclaw', 'main');
        result.memoriesImported++;
      } catch { /* skip */ }
    }

    logger.info(result, 'OpenClaw full import complete');
  } catch (err) {
    result.errors.push(`OpenClaw import failed: ${err}`);
    logger.error({ err }, 'OpenClaw import failed');
  }

  return result;
}

/**
 * Import from a ClaudeClaw/OpenClaw SQLite database.
 */
export function importFromSqlite(dbPath: string, chatId: string): ImportResult {
  const result: ImportResult = { source: dbPath, memoriesImported: 0, conversationsImported: 0, filesImported: 0, errors: [] };

  try {
    const sourceDb = new Database(dbPath, { readonly: true });

    // Import memories
    try {
      const memories = sourceDb.prepare(
        'SELECT summary, raw_text, entities, topics, importance, created_at FROM memories ORDER BY created_at DESC LIMIT 500'
      ).all() as Array<{ summary: string; raw_text: string; entities: string; topics: string; importance: number; created_at: number }>;

      for (const mem of memories) {
        try {
          let entities: string[] = [];
          let topics: string[] = [];
          try { entities = JSON.parse(mem.entities); } catch { /* empty */ }
          try { topics = JSON.parse(mem.topics); } catch { /* empty */ }

          saveStructuredMemory(
            chatId,
            mem.raw_text || mem.summary,
            mem.summary,
            entities,
            topics,
            mem.importance || 0.5,
            'import',
            'main',
          );
          writeMemoryToFile(mem.summary, topics, mem.importance || 0.5, 'import');
          result.memoriesImported++;
        } catch (err) {
          result.errors.push(`Memory import error: ${err}`);
        }
      }
    } catch {
      // No memories table — try other formats
    }

    // Import conversation history
    try {
      const convos = sourceDb.prepare(
        'SELECT role, content, created_at FROM conversation_log ORDER BY created_at DESC LIMIT 200'
      ).all() as Array<{ role: string; content: string; created_at: number }>;
      result.conversationsImported = convos.length;
    } catch {
      // No conversation_log table
    }

    // Import consolidations as memories
    try {
      const consolidations = sourceDb.prepare(
        'SELECT summary, insight FROM consolidations ORDER BY created_at DESC LIMIT 100'
      ).all() as Array<{ summary: string; insight: string }>;

      for (const c of consolidations) {
        saveStructuredMemory(chatId, c.insight, `[Insight] ${c.insight}`, [], ['consolidation'], 0.6, 'import', 'main');
        result.memoriesImported++;
      }
    } catch {
      // No consolidations table
    }

    sourceDb.close();
    logger.info(result, 'SQLite import complete');
  } catch (err) {
    result.errors.push(`Database open failed: ${err}`);
    logger.error({ err, dbPath }, 'SQLite import failed');
  }

  return result;
}

/**
 * Import from claude-mem SQLite database (~/.claude-mem/claude-mem.db).
 * This is the richest source: observations with title, narrative, type, concepts.
 */
export function importFromClaudeMem(dbPath: string, chatId: string): ImportResult {
  const result: ImportResult = { source: dbPath, memoriesImported: 0, conversationsImported: 0, filesImported: 0, errors: [] };

  try {
    const sourceDb = new Database(dbPath, { readonly: true });

    // Import observations (the main value — 1500+ structured records)
    try {
      // Detect available columns (schema varies between claude-mem versions)
      const cols = sourceDb.prepare("PRAGMA table_info(observations)").all() as Array<{ name: string }>;
      const colNames = new Set(cols.map(c => c.name));
      const selectCols = ['id', 'type', 'title', 'narrative', 'created_at']
        .filter(c => colNames.has(c));
      if (colNames.has('concept')) selectCols.push('concept');
      if (colNames.has('source_files')) selectCols.push('source_files');
      if (colNames.has('text')) selectCols.push('text');

      const observations = sourceDb.prepare(
        `SELECT ${selectCols.join(', ')} FROM observations ORDER BY created_at DESC LIMIT 1000`
      ).all() as Array<Record<string, string | number>>;

      for (const obs of observations) {
        try {
          const title = String(obs.title || '');
          const narrative = String(obs.narrative || obs.text || '');
          const obsType = String(obs.type || 'general');
          const concept = String(obs.concept || '');
          const sourceFiles = String(obs.source_files || '');

          const summary = title
            ? `[${obsType}] ${title}: ${narrative.slice(0, 200)}`
            : `[${obsType}] ${narrative.slice(0, 250)}`;

          const topics: string[] = [obsType];
          if (concept) topics.push(concept);

          const entities: string[] = [];
          if (sourceFiles) {
            const files = sourceFiles.split(',').map(f => f.trim().split('/').pop() || '').filter(Boolean);
            entities.push(...files.slice(0, 3));
          }

          const importanceMap: Record<string, number> = {
            decision: 0.85, bugfix: 0.6, feature: 0.65,
            refactor: 0.55, discovery: 0.7, change: 0.5,
          };

          saveStructuredMemory(
            chatId,
            narrative || title,
            summary,
            entities,
            topics,
            importanceMap[obsType] || 0.6,
            'import-claude-mem',
            'main',
          );
          writeMemoryToFile(summary, topics, importanceMap[obsType] || 0.6, 'import-claude-mem');
          result.memoriesImported++;
        } catch (err) {
          result.errors.push(`Observation ${obs.id}: ${err}`);
        }
      }
    } catch (err) {
      result.errors.push(`Observations table: ${err}`);
    }

    // Import session summaries
    try {
      const summaries = sourceDb.prepare(
        `SELECT request, learned, completed, next_steps
         FROM session_summaries
         ORDER BY id DESC LIMIT 100`
      ).all() as Array<{
        request: string; learned: string; completed: string; next_steps: string;
      }>;

      for (const s of summaries) {
        if (!s.learned && !s.completed) continue;
        const summary = [
          s.request ? `Request: ${s.request}` : '',
          s.learned ? `Learned: ${s.learned}` : '',
          s.completed ? `Completed: ${s.completed}` : '',
        ].filter(Boolean).join('. ').slice(0, 300);

        saveStructuredMemory(chatId, summary, `[Session] ${summary}`, [], ['session-summary'], 0.55, 'import-claude-mem', 'main');
        result.memoriesImported++;
      }
    } catch {
      // No session_summaries table
    }

    // Import user prompts as conversation context
    try {
      const prompts = sourceDb.prepare(
        'SELECT COUNT(*) as cnt FROM user_prompts'
      ).get() as { cnt: number };
      result.conversationsImported = prompts?.cnt || 0;
    } catch {
      // No user_prompts table
    }

    sourceDb.close();
    logger.info(result, 'claude-mem import complete');
  } catch (err) {
    result.errors.push(`Database open failed: ${err}`);
    logger.error({ err, dbPath }, 'claude-mem import failed');
  }

  return result;
}

/**
 * Import from Claude Code history.jsonl.
 */
export function importFromHistory(filePath: string, chatId: string): ImportResult {
  const result: ImportResult = { source: filePath, memoriesImported: 0, conversationsImported: 0, filesImported: 1, errors: [] };

  try {
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as { display?: string; timestamp?: number; project?: string };
        if (!entry.display || entry.display.length < 20) continue;
        result.conversationsImported++;
      } catch { /* skip malformed lines */ }
    }
    logger.info(result, 'History import complete');
  } catch (err) {
    result.errors.push(`History parse failed: ${err}`);
  }

  return result;
}

/**
 * Import from markdown files (bOS state, CLAUDE.md, notes, etc).
 */
export function importFromMarkdown(dirOrFile: string, chatId: string): ImportResult {
  const result: ImportResult = { source: dirOrFile, memoriesImported: 0, conversationsImported: 0, filesImported: 0, errors: [] };

  try {
    const files = fs.statSync(dirOrFile).isDirectory()
      ? findFiles(dirOrFile, '.md')
      : [dirOrFile];

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        if (content.trim().length < 20) continue;

        const fileName = path.basename(file, '.md');
        const sections = content.split(/^## /m).filter(s => s.trim().length > 10);

        if (sections.length > 1) {
          // Multi-section file: each section becomes a memory
          for (const section of sections) {
            const firstLine = section.split('\n')[0]?.trim() || fileName;
            const body = section.slice(firstLine.length).trim();
            if (body.length < 10) continue;

            saveStructuredMemory(
              chatId,
              body.slice(0, 500),
              `[${fileName}] ${firstLine}: ${body.slice(0, 200)}`,
              [fileName],
              [categorizeFile(fileName)],
              0.6,
              'import',
              'main',
            );
            result.memoriesImported++;
          }
        } else {
          // Single-section file: whole file is one memory
          saveStructuredMemory(
            chatId,
            content.slice(0, 500),
            `[${fileName}] ${content.slice(0, 200)}`,
            [fileName],
            [categorizeFile(fileName)],
            0.6,
            'import',
            'main',
          );
          result.memoriesImported++;
        }
        result.filesImported++;
      } catch (err) {
        result.errors.push(`File error (${file}): ${err}`);
      }
    }

    logger.info(result, 'Markdown import complete');
  } catch (err) {
    result.errors.push(`Import failed: ${err}`);
  }

  return result;
}

/**
 * Import from JSON export (conversation exports, memory dumps).
 */
export function importFromJson(filePath: string, chatId: string): ImportResult {
  const result: ImportResult = { source: filePath, memoriesImported: 0, conversationsImported: 0, filesImported: 0, errors: [] };

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);

    // Array of memories
    if (Array.isArray(data)) {
      for (const item of data) {
        const summary = item.summary || item.text || item.content || item.message || '';
        if (!summary || summary.length < 10) continue;

        saveStructuredMemory(
          chatId,
          item.raw_text || summary,
          summary.slice(0, 300),
          item.entities || [],
          item.topics || [],
          item.importance || 0.5,
          'import',
          'main',
        );
        result.memoriesImported++;
      }
    }
    // Object with memories array
    else if (data.memories && Array.isArray(data.memories)) {
      for (const mem of data.memories) {
        saveStructuredMemory(
          chatId,
          mem.raw_text || mem.summary || mem.text || '',
          (mem.summary || mem.text || '').slice(0, 300),
          mem.entities || [],
          mem.topics || [],
          mem.importance || 0.5,
          'import',
          'main',
        );
        result.memoriesImported++;
      }
    }
    // Object with conversations
    else if (data.conversations && Array.isArray(data.conversations)) {
      result.conversationsImported = data.conversations.length;
    }

    result.filesImported = 1;
    logger.info(result, 'JSON import complete');
  } catch (err) {
    result.errors.push(`JSON parse failed: ${err}`);
  }

  return result;
}

/**
 * Import from Claude Code ~/.claude/ directory.
 */
export function importFromClaudeCode(claudeDir: string, chatId: string): ImportResult {
  const result: ImportResult = { source: claudeDir, memoriesImported: 0, conversationsImported: 0, filesImported: 0, errors: [] };

  // Import CLAUDE.md as a preference memory
  const claudeMd = path.join(claudeDir, 'CLAUDE.md');
  if (fs.existsSync(claudeMd)) {
    const content = fs.readFileSync(claudeMd, 'utf-8');
    if (content.length > 20) {
      saveStructuredMemory(chatId, content.slice(0, 2000), '[Imported CLAUDE.md preferences]', ['CLAUDE.md'], ['preferences'], 0.8, 'import', 'main');
      result.memoriesImported++;
      result.filesImported++;
    }
  }

  // Import memory files
  const memoryDir = path.join(claudeDir, 'memory');
  if (fs.existsSync(memoryDir)) {
    const mdResult = importFromMarkdown(memoryDir, chatId);
    result.memoriesImported += mdResult.memoriesImported;
    result.filesImported += mdResult.filesImported;
    result.errors.push(...mdResult.errors);
  }

  // Import project memories
  const projectsDir = path.join(claudeDir, 'projects');
  if (fs.existsSync(projectsDir)) {
    for (const project of fs.readdirSync(projectsDir)) {
      const projectMemory = path.join(projectsDir, project, 'memory');
      if (fs.existsSync(projectMemory)) {
        const mdResult = importFromMarkdown(projectMemory, chatId);
        result.memoriesImported += mdResult.memoriesImported;
        result.filesImported += mdResult.filesImported;
      }
    }
  }

  logger.info(result, 'Claude Code import complete');
  return result;
}

/**
 * Auto-import: detect all sources and import everything.
 */
export async function autoImport(chatId: string): Promise<ImportResult[]> {
  const results: ImportResult[] = [];
  const sources = detectSources();

  for (const source of sources) {
    switch (source.type) {
      case 'openclaw':
        // Full OpenClaw import (agents, cron, MCP, secrets, memory, workspace)
        results.push(await importFromOpenClaw(source.path, chatId));
        break;
      case 'claudeclaw': {
        const dbFiles = source.path.endsWith('.db') ? [source.path] : findFiles(source.path, '.db');
        for (const db of dbFiles) {
          results.push(importFromSqlite(db, chatId));
        }
        const mdFiles = findFiles(source.path.endsWith('.db') ? path.dirname(source.path) : source.path, '.md');
        if (mdFiles.length > 0) {
          results.push(importFromMarkdown(path.dirname(mdFiles[0]!), chatId));
        }
        break;
      }
      case 'claude-mem':
        results.push(importFromClaudeMem(source.path, chatId));
        break;
      case 'bos':
        results.push(importFromMarkdown(source.path, chatId));
        break;
      case 'claude-code':
        if (source.path.endsWith('.jsonl')) {
          results.push(importFromHistory(source.path, chatId));
        } else {
          results.push(importFromClaudeCode(source.path, chatId));
        }
        break;
      case 'markdown':
        results.push(importFromMarkdown(source.path, chatId));
        break;
    }
  }

  // After importing, compile findings into life kernel files
  const totalMem = results.reduce((s, r) => s + r.memoriesImported, 0);
  if (totalMem > 0) {
    compileKernelsFromMemories(chatId);
  }

  return results;
}

/**
 * Scan imported memories and compile findings into life kernel files.
 * Extracts identity, preferences, goals, and other structured data.
 */
export function compileKernelsFromMemories(chatId: string): void {
  try {
    // Get all memories for this chat, sorted by importance
    const db = new Database(
      path.join(
        process.env.WILD_DATA_DIR || path.join(process.env.HOME || process.env.USERPROFILE || '', '.wild-claude-pi'),
        'store', 'claudeclaw.db'
      ),
      { readonly: true },
    );

    let memories: Array<{ summary: string; topics: string; importance: number }> = [];
    try {
      memories = db.prepare(
        `SELECT summary, topics, importance FROM memories
         WHERE chat_id = ? AND importance >= 0.5
         ORDER BY importance DESC LIMIT 500`
      ).all(chatId) as typeof memories;
    } catch {
      // Try project-local DB as fallback
      try {
        const localDb = new Database(path.join(PROJECT_ROOT, 'store', 'claudeclaw.db'), { readonly: true });
        memories = localDb.prepare(
          `SELECT summary, topics, importance FROM memories
           WHERE chat_id = ? AND importance >= 0.5
           ORDER BY importance DESC LIMIT 500`
        ).all(chatId) as typeof memories;
        localDb.close();
      } catch { /* no DB */ }
    }
    db.close();

    if (memories.length === 0) return;

    // Categorize memories by topic
    const buckets: Record<string, string[]> = {
      identity: [],
      preferences: [],
      goals: [],
      health: [],
      finance: [],
      learning: [],
      work: [],
      other: [],
    };

    for (const mem of memories) {
      const summary = mem.summary || '';
      const lower = summary.toLowerCase();
      let topics: string[] = [];
      try { topics = JSON.parse(mem.topics || '[]'); } catch { /* empty */ }

      // Categorize by content + topics
      if (/\b(name|live|age|born|from|citizen|resident|nationality|italiano|italian)\b/i.test(lower) ||
          /\b(am|is|my name|years old|work at|job|career)\b/i.test(lower)) {
        buckets.identity.push(summary);
      } else if (/\b(prefer|like|hate|want|style|approach|always|never|don't)\b/i.test(lower) ||
                 topics.includes('preferences')) {
        buckets.preferences.push(summary);
      } else if (/\b(goal|plan|target|milestone|objective|achieve|exit|transition)\b/i.test(lower) ||
                 topics.includes('goals')) {
        buckets.goals.push(summary);
      } else if (/\b(health|workout|gym|sleep|energy|weight|diet)\b/i.test(lower) ||
                 topics.includes('health')) {
        buckets.health.push(summary);
      } else if (/\b(money|budget|salary|tax|expense|income|investment|bank|pension)\b/i.test(lower) ||
                 topics.includes('finance')) {
        buckets.finance.push(summary);
      } else if (/\b(learn|study|course|book|skill|tutorial|language)\b/i.test(lower) ||
                 topics.includes('learning')) {
        buckets.learning.push(summary);
      } else if (/\b(code|project|deploy|build|feature|bug|architecture)\b/i.test(lower) ||
                 topics.includes('development') || topics.includes('work')) {
        buckets.work.push(summary);
      } else {
        buckets.other.push(summary);
      }
    }

    // Write kernel files only if we have meaningful data AND file is empty/template
    const writeIfEmpty = (domain: string, content: string) => {
      const keyFile = lifePath(domain, '_kernel', 'key.md');
      let existing = '';
      try { existing = fs.readFileSync(keyFile, 'utf-8'); } catch { /* doesn't exist */ }
      if (existing.includes('[FILL IN]') || existing.length < 50) {
        fs.mkdirSync(path.dirname(keyFile), { recursive: true });
        fs.writeFileSync(keyFile, content);
        logger.info({ domain, entries: content.split('\n').length }, 'Kernel compiled from imported memories');
      }
    };

    // Compile me/key.md
    if (buckets.identity.length > 0 || buckets.preferences.length > 0) {
      const lines = [
        '# me -- identity kernel',
        '',
        '## Who I Am (compiled from imported data)',
        ...buckets.identity.slice(0, 10).map(s => `- ${s.slice(0, 200)}`),
        '',
        '## Preferences',
        ...buckets.preferences.slice(0, 10).map(s => `- ${s.slice(0, 200)}`),
        '',
        '## Work & Projects',
        ...buckets.work.slice(0, 8).map(s => `- ${s.slice(0, 200)}`),
        '',
        '## Notes for Agents',
        'This profile was auto-compiled from imported memories. Update it anytime.',
        '',
      ];
      writeIfEmpty('me', lines.join('\n'));
    }

    // Compile goals/key.md
    if (buckets.goals.length > 0) {
      const lines = [
        '# goals -- active goals (compiled from imported data)',
        '',
        ...buckets.goals.slice(0, 10).map((g, i) => `## Goal ${i + 1}\n${g.slice(0, 300)}\n- Status: Review needed\n`),
      ];
      writeIfEmpty('goals', lines.join('\n'));
    }

    // Compile health/key.md
    if (buckets.health.length > 0) {
      const lines = [
        '# health -- health profile (compiled from imported data)',
        '',
        ...buckets.health.slice(0, 8).map(s => `- ${s.slice(0, 200)}`),
        '',
      ];
      writeIfEmpty('health', lines.join('\n'));
    }

    // Compile finance/key.md
    if (buckets.finance.length > 0) {
      const lines = [
        '# finance -- financial context (compiled from imported data)',
        '',
        ...buckets.finance.slice(0, 8).map(s => `- ${s.slice(0, 200)}`),
        '',
      ];
      writeIfEmpty('finance', lines.join('\n'));
    }

    // Compile learning/key.md
    if (buckets.learning.length > 0) {
      const lines = [
        '# learning -- learning goals (compiled from imported data)',
        '',
        ...buckets.learning.slice(0, 8).map(s => `- ${s.slice(0, 200)}`),
        '',
      ];
      writeIfEmpty('learning', lines.join('\n'));
    }

    logger.info({
      identity: buckets.identity.length,
      preferences: buckets.preferences.length,
      goals: buckets.goals.length,
      health: buckets.health.length,
      finance: buckets.finance.length,
      learning: buckets.learning.length,
    }, 'Kernel compilation from memories complete');
  } catch (err) {
    logger.warn({ err }, 'Kernel compilation failed (non-fatal)');
  }
}

// ── Life context import ──────────────────────────────────────────────

/**
 * Import life context from bOS-style state files into ALIVE kernel structure.
 */
export function importLifeContext(stateDir: string): number {
  let imported = 0;

  const mapping: Record<string, string> = {
    'tasks.md': 'me',
    'projects.md': 'goals',
    'goals.md': 'goals',
    'notes.md': 'me',
    'habits.md': 'health',
    'finances.md': 'finance',
    'budget.md': 'finance',
    'learning.md': 'learning',
    'health.md': 'health',
  };

  for (const [filename, domain] of Object.entries(mapping)) {
    const srcFile = path.join(stateDir, filename);
    if (!fs.existsSync(srcFile)) continue;

    const content = fs.readFileSync(srcFile, 'utf-8');
    if (content.trim().length < 10) continue;

    const logFile = lifePath(domain, '_kernel', 'log.md');
    fs.mkdirSync(path.dirname(logFile), { recursive: true });

    // Append to log (don't overwrite key.md)
    const entry = `\n## Imported from ${filename} (${new Date().toISOString().slice(0, 10)})\n\n${content}\n\n---\n`;

    if (fs.existsSync(logFile)) {
      const existing = fs.readFileSync(logFile, 'utf-8');
      fs.writeFileSync(logFile, existing + entry);
    } else {
      fs.writeFileSync(logFile, `# ${domain} log\n\n` + entry);
    }
    imported++;
  }

  return imported;
}

// ── Telegram commands ────────────────────────────────────────────────

export function registerImportCommands(bot: Bot<Context>): void {
  bot.command('import', async (ctx) => {
    const chatId = ctx.chat!.id.toString();
    const arg = ctx.match?.trim().toLowerCase();

    if (!arg || arg === 'scan') {
      // Scan for importable sources
      const sources = detectSources();
      if (sources.length === 0) {
        await ctx.reply('No importable data sources found.\n\nSupported:\n- OpenClaw/NanoClaw\n- Previous WildClaude/ClaudeClaw installs\n- bOS\n- Claude Code (~/.claude/)\n\nOr: /import file <path> to import a specific file.');
        return;
      }

      const lines = sources.map((s, i) => `${i + 1}. [${s.type}] ${s.description}\n   ${s.path} (${s.size})`);
      await ctx.reply(
        `Found ${sources.length} importable source(s):\n\n${lines.join('\n\n')}\n\n` +
        `Use /import all to import everything, or /import <number> to import a specific source.`,
      );
      return;
    }

    if (arg === 'all') {
      await ctx.reply('Importing all detected sources...');
      const results = await autoImport(chatId);
      const totalMem = results.reduce((s, r) => s + r.memoriesImported, 0);
      const totalFiles = results.reduce((s, r) => s + r.filesImported, 0);
      const totalErrors = results.reduce((s, r) => s + r.errors.length, 0);
      await ctx.reply(
        `Import complete!\n\n` +
        `Memories: ${totalMem}\n` +
        `Files processed: ${totalFiles}\n` +
        `Errors: ${totalErrors}\n\n` +
        `Check /memory or the Memory Palace dashboard to see imported data.`,
      );
      return;
    }

    // Import by index
    const idx = parseInt(arg, 10);
    if (!isNaN(idx)) {
      const sources = detectSources();
      if (idx < 1 || idx > sources.length) {
        await ctx.reply(`Invalid source number. Use /import scan to see available sources.`);
        return;
      }
      const source = sources[idx - 1]!;
      await ctx.reply(`Importing from ${source.type}: ${source.path}...`);

      let result: ImportResult;
      switch (source.type) {
        case 'openclaw':
          result = await importFromOpenClaw(source.path, chatId);
          break;
        case 'claudeclaw':
          result = source.path.endsWith('.db')
            ? importFromSqlite(source.path, chatId)
            : importFromSqlite(findFiles(source.path, '.db')[0] || '', chatId);
          break;
        case 'claude-mem':
          result = importFromClaudeMem(source.path, chatId);
          break;
        case 'bos':
        case 'markdown':
          result = importFromMarkdown(source.path, chatId);
          break;
        case 'claude-code':
          result = source.path.endsWith('.jsonl')
            ? importFromHistory(source.path, chatId)
            : importFromClaudeCode(source.path, chatId);
          break;
        default:
          result = { source: source.path, memoriesImported: 0, conversationsImported: 0, filesImported: 0, errors: ['Unknown source type'] };
      }

      await ctx.reply(
        `Import from ${source.type} complete!\n\n` +
        `Memories: ${result.memoriesImported}\n` +
        `Files: ${result.filesImported}\n` +
        (result.errors.length > 0 ? `Errors: ${result.errors.length}` : ''),
      );
      return;
    }

    // Import specific file path
    if (arg.startsWith('file ')) {
      const filePath = ctx.match!.slice(5).trim();
      // Validate path is within allowed directories (prevent path traversal)
      const resolved = path.resolve(filePath);
      const homeDir = process.env.HOME || '/home';
      const allowedPrefixes = [
        path.resolve(USER_DATA_DIR),
        path.resolve(homeDir),
      ];
      const isAllowed = allowedPrefixes.some(p => resolved.startsWith(p + path.sep) || resolved === p);
      if (!isAllowed) {
        await ctx.reply('Import path must be within your home directory or user data directory.');
        return;
      }
      if (!fs.existsSync(filePath)) {
        await ctx.reply(`File not found: ${filePath}`);
        return;
      }

      let result: ImportResult;
      if (filePath.endsWith('.db')) {
        result = importFromSqlite(filePath, chatId);
      } else if (filePath.endsWith('.json')) {
        result = importFromJson(filePath, chatId);
      } else if (filePath.endsWith('.md') || fs.statSync(filePath).isDirectory()) {
        result = importFromMarkdown(filePath, chatId);
      } else {
        await ctx.reply('Unsupported format. Supported: .db, .json, .md, or a directory of .md files.');
        return;
      }

      await ctx.reply(
        `Import complete!\n\n` +
        `Memories: ${result.memoriesImported}\n` +
        `Files: ${result.filesImported}\n` +
        (result.errors.length > 0 ? `Errors: ${result.errors.join('\n')}` : ''),
      );
      return;
    }

    await ctx.reply('Usage:\n/import scan — detect sources\n/import all — import everything\n/import <number> — import specific source\n/import file <path> — import a file');
  });
}

// ── Helpers ──────────────────────────────────────────────────────────

function findFiles(dir: string, ext: string): string[] {
  const files: string[] = [];
  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return files;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.endsWith(ext)) {
        files.push(fullPath);
      } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
        files.push(...findFiles(fullPath, ext));
      }
    }
  } catch { /* permission error */ }
  return files;
}

function dirSize(dir: string): string {
  let total = 0;
  try {
    for (const file of findFiles(dir, '')) {
      try { total += fs.statSync(file).size; } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return formatBytes(total);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function categorizeFile(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('task') || n.includes('todo')) return 'goals';
  if (n.includes('project')) return 'development';
  if (n.includes('note')) return 'general';
  if (n.includes('goal')) return 'goals';
  if (n.includes('habit') || n.includes('health')) return 'health';
  if (n.includes('finance') || n.includes('budget')) return 'finance';
  if (n.includes('learn')) return 'learning';
  return 'general';
}
