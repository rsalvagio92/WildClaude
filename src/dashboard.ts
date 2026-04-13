import { Api, RawApi } from 'grammy';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { serve } from '@hono/node-server';

import fs from 'fs';
import os from 'os';
import path from 'path';
import { AGENT_ID, ALLOWED_CHAT_ID, DASHBOARD_PORT, DASHBOARD_TOKEN, DASHBOARD_HOST, PROJECT_ROOT, STORE_DIR, WHATSAPP_ENABLED, SLACK_USER_TOKEN, CONTEXT_LIMIT, agentDefaultModel } from './config.js';
import crypto from 'crypto';
import {
  getAllScheduledTasks,
  deleteScheduledTask,
  pauseScheduledTask,
  resumeScheduledTask,
  getConversationPage,
  getDashboardMemoryStats,
  getDashboardPinnedMemories,
  getDashboardLowSalienceMemories,
  getDashboardTopAccessedMemories,
  getDashboardMemoryTimeline,
  getDashboardConsolidations,
  getDashboardMemoriesList,
  getMemoryTopics,
  getDashboardTokenStats,
  getDashboardCostTimeline,
  getDashboardRecentTokenUsage,
  getSession,
  getSessionTokenUsage,
  getHiveMindEntries,
  getAgentTokenStats,
  getAgentRecentConversation,
  getMissionTasks,
  getMissionTask,
  createMissionTask,
  cancelMissionTask,
  deleteMissionTask,
  reassignMissionTask,
  assignMissionTask,
  getUnassignedMissionTasks,
  getMissionTaskHistory,
  getAuditLog,
  getAuditLogCount,
  getRecentBlockedActions,
  pinMemory,
  unpinMemory,
  searchMemories,
  clearSession,
} from './db.js';
// Gemini removed — all processing is local
import { getSecurityStatus } from './security.js';
import { getActivityFeed, getSessionActivities, getAgentRecentActivities, getAgentErrorRate, getSessionDuration, getAgentActivitySummary } from './activity-log.js';
import { listAgentIds, loadAgentConfig, setAgentModel } from './agent-config.js';
import {
  listTemplates,
  validateAgentId,
  validateBotToken,
  createAgent,
  activateAgent,
  deactivateAgent,
  deleteAgent,
  suggestBotNames,
  isAgentRunning,
} from './agent-create.js';
import { processMessageFromDashboard } from './bot.js';
import {
  loadPersonalityConfig,
  generatePersonalityPrompt,
  listPresets,
  savePreset,
  deletePreset,
  type PersonalityConfig,
} from './personality.js';
import { getDashboardHtml } from './dashboard-html.js';
import { logger } from './logger.js';
import { USER_DATA_DIR } from './paths.js';
import { loadUserConfig, saveUserConfig, writeOverlayFile } from './overlay.js';
import { DEFAULT_AUTOMATIONS, syncAutomations } from './automations.js';
import { registerExternalDashboardRoutes } from './external-dashboards.js';
import { getTelegramConnected, getBotInfo, chatEvents, getIsProcessing, abortActiveQuery, ChatEvent } from './state.js';

async function classifyTaskAgent(_prompt: string): Promise<string | null> {
  // Simple keyword-based classification (fully local, no Gemini)
  try {
    return 'main'; // Default to main agent
  } catch (err) {
    logger.error({ err }, 'Auto-assign classification failed');
    return null;
  }
}

export function startDashboard(botApi?: Api<RawApi>): void {
  if (!DASHBOARD_TOKEN) {
    logger.info('DASHBOARD_TOKEN not set, dashboard disabled');
    return;
  }

  const app = new Hono();

  // CORS headers for cross-origin access (Cloudflare tunnel, mobile browsers)
  app.use('*', async (c, next) => {
    // Allow same-origin and explicit origin from request
    const origin = c.req.header('Origin');
    if (origin) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Vary', 'Origin');
    }
    c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    c.header('Access-Control-Allow-Credentials', 'true');
    if (c.req.method === 'OPTIONS') return c.body(null, 204);
    await next();
  });

  // Global error handler — prevents unhandled throws from killing the server
  app.onError((err, c) => {
    logger.error({ err: err.message }, 'Dashboard request error');
    return c.json({ error: 'Internal server error' }, 500);
  });

  // Serve dashboard HTML (no auth — the page has its own login screen)
  app.get('/', (c) => {
    return c.html(getDashboardHtml());
  });
  app.get('/dashboard', (c) => {
    return c.html(getDashboardHtml());
  });

  // Token auth middleware (applies to /api/* only)
  app.use('/api/*', async (c, next) => {
    // Accept token from Authorization header (preferred) or query param (fallback)
    const authHeader = c.req.header('Authorization');
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : c.req.query('token');
    if (!DASHBOARD_TOKEN || !token) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    // Timing-safe comparison to prevent timing attacks
    const a = Buffer.from(token);
    const b = Buffer.from(DASHBOARD_TOKEN);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    await next();
  });

  // Scheduled tasks
  app.get('/api/tasks', (c) => {
    const tasks = getAllScheduledTasks();
    return c.json({ tasks });
  });

  // Delete a scheduled task
  app.delete('/api/tasks/:id', (c) => {
    const id = c.req.param('id');
    deleteScheduledTask(id);
    return c.json({ ok: true });
  });

  // Pause a scheduled task
  app.post('/api/tasks/:id/pause', (c) => {
    const id = c.req.param('id');
    pauseScheduledTask(id);
    return c.json({ ok: true });
  });

  // Resume a scheduled task
  app.post('/api/tasks/:id/resume', (c) => {
    const id = c.req.param('id');
    resumeScheduledTask(id);
    return c.json({ ok: true });
  });

  // ── Automations endpoints ────────────────────────────────────────────

  // GET /api/automations — list all automations (defaults + user) with live status from DB
  app.get('/api/automations', (c) => {
    const agentId = c.req.query('agent') || AGENT_ID;
    const userConfig = loadUserConfig();
    const userAutomations = userConfig.automations || [];
    const userById = new Map(userAutomations.map((a: { id: string }) => [a.id, a]));

    const dbTasks = getAllScheduledTasks(agentId);
    const dbById = new Map(dbTasks.map((t) => [t.id, t]));

    type AutomationEntry = {
      id: string; name: string; description: string; prompt: string; cron: string;
      enabled: boolean; source: 'default' | 'user';
      status: string; last_run: number | null; last_status: string | null;
      last_result: string | null; next_run: number | null;
    };

    // Merge defaults with user overrides and live DB state
    const result: AutomationEntry[] = DEFAULT_AUTOMATIONS.map((def) => {
      const userOverride = userById.get(def.id) as { enabled?: boolean; cron?: string; name?: string; prompt?: string } | undefined;
      const dbTask = dbById.get(def.id);
      return {
        id: def.id,
        name: userOverride?.name || def.name,
        description: def.description,
        prompt: userOverride?.prompt || def.prompt,
        cron: userOverride?.cron || def.cron,
        enabled: userOverride?.enabled !== false,
        source: 'default',
        // Live DB state
        status: dbTask?.status || (userOverride?.enabled === false ? 'disabled' : 'not-installed'),
        last_run: dbTask?.last_run || null,
        last_status: dbTask?.last_status || null,
        last_result: dbTask?.last_result ? dbTask.last_result.slice(0, 200) : null,
        next_run: dbTask?.next_run || null,
      };
    });

    // Also include pure user-defined automations (not in defaults)
    for (const ua of userAutomations) {
      if (DEFAULT_AUTOMATIONS.some((d) => d.id === ua.id)) continue;
      const dbTask = dbById.get(ua.id);
      result.push({
        id: ua.id,
        name: ua.name,
        description: '',
        prompt: ua.prompt,
        cron: ua.cron,
        enabled: ua.enabled !== false,
        source: 'user',
        status: dbTask?.status || (ua.enabled === false ? 'disabled' : 'not-installed'),
        last_run: dbTask?.last_run || null,
        last_status: dbTask?.last_status || null,
        last_result: dbTask?.last_result ? dbTask.last_result.slice(0, 200) : null,
        next_run: dbTask?.next_run || null,
      });
    }

    return c.json({ automations: result });
  });

  // PUT /api/automations/:id — enable/disable or change cron schedule
  app.put('/api/automations/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<{ enabled?: boolean; cron?: string; name?: string; prompt?: string }>();

    const config = loadUserConfig();
    const automations = config.automations || [];
    const existing = automations.find((a) => a.id === id);

    if (existing) {
      // Update existing entry
      if (body.enabled !== undefined) existing.enabled = body.enabled;
      if (body.cron) existing.cron = body.cron;
      if (body.name) existing.name = body.name;
      if (body.prompt) existing.prompt = body.prompt;
    } else {
      // Create override entry from default if applicable
      const def = DEFAULT_AUTOMATIONS.find((d) => d.id === id);
      const base = def || { id, name: id, prompt: '', cron: '0 9 * * *' };
      automations.push({
        id,
        name: body.name || base.name,
        prompt: body.prompt || base.prompt,
        cron: body.cron || base.cron,
        enabled: body.enabled !== undefined ? body.enabled : true,
      });
    }

    saveUserConfig({ ...config, automations });

    // Re-sync: will install newly enabled automations and skip disabled ones
    syncAutomations(AGENT_ID);

    return c.json({ ok: true });
  });

  // POST /api/automations — create a custom automation
  app.post('/api/automations', async (c) => {
    const body = await c.req.json<{ id?: string; name?: string; prompt?: string; cron?: string }>();
    const name = body?.name?.trim();
    const prompt = body?.prompt?.trim();
    const cron = body?.cron?.trim();

    if (!name || name.length > 100) return c.json({ error: 'name required (max 100 chars)' }, 400);
    if (!prompt || prompt.length > 5000) return c.json({ error: 'prompt required (max 5000 chars)' }, 400);
    if (!cron) return c.json({ error: 'cron expression required' }, 400);

    const id = body?.id?.trim() || name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40);

    const config = loadUserConfig();
    const automations = config.automations || [];

    if (automations.some((a) => a.id === id)) {
      return c.json({ error: `Automation with id "${id}" already exists` }, 409);
    }

    automations.push({ id, name, prompt, cron, enabled: true });
    saveUserConfig({ ...config, automations });

    // Sync to install the new task
    syncAutomations(AGENT_ID);

    return c.json({ ok: true, id }, 201);
  });

  // ── Mission Control endpoints ────────────────────────────────────────

  app.get('/api/mission/tasks', (c) => {
    const agentId = c.req.query('agent') || undefined;
    const status = c.req.query('status') || undefined;
    const tasks = getMissionTasks(agentId, status);
    return c.json({ tasks });
  });

  app.get('/api/mission/tasks/:id', (c) => {
    const id = c.req.param('id');
    const task = getMissionTask(id);
    if (!task) return c.json({ error: 'Not found' }, 404);
    return c.json({ task });
  });

  app.post('/api/mission/tasks', async (c) => {
    const body = await c.req.json<{
      title?: string;
      prompt?: string;
      assigned_agent?: string;
      priority?: number;
    }>();

    const title = body?.title?.trim();
    const prompt = body?.prompt?.trim();
    const assignedAgent = body?.assigned_agent?.trim() || null;
    const priority = Math.max(0, Math.min(10, body?.priority ?? 0));

    if (!title || title.length > 200) return c.json({ error: 'title required (max 200 chars)' }, 400);
    if (!prompt || prompt.length > 10000) return c.json({ error: 'prompt required (max 10000 chars)' }, 400);

    // Validate agent if provided
    if (assignedAgent) {
      const validAgents = ['main', ...listAgentIds()];
      if (!validAgents.includes(assignedAgent)) {
        return c.json({ error: `Unknown agent: ${assignedAgent}. Valid: ${validAgents.join(', ')}` }, 400);
      }
    }

    const id = crypto.randomBytes(4).toString('hex');
    createMissionTask(id, title, prompt, assignedAgent, 'dashboard', priority);

    const task = getMissionTask(id);
    return c.json({ task }, 201);
  });

  app.post('/api/mission/tasks/:id/cancel', (c) => {
    const id = c.req.param('id');
    const ok = cancelMissionTask(id);
    return c.json({ ok });
  });

  // Auto-assign a single task via Gemini classification
  app.post('/api/mission/tasks/:id/auto-assign', async (c) => {
    const id = c.req.param('id');
    const task = getMissionTask(id);
    if (!task) return c.json({ error: 'Not found' }, 404);
    if (task.assigned_agent) return c.json({ error: 'Already assigned' }, 400);

    const agent = await classifyTaskAgent(task.prompt);
    if (!agent) return c.json({ error: 'Classification failed' }, 500);

    assignMissionTask(id, agent);
    return c.json({ ok: true, assigned_agent: agent });
  });

  // Auto-assign all unassigned tasks
  app.post('/api/mission/tasks/auto-assign-all', async (c) => {
    const tasks = getUnassignedMissionTasks();
    if (tasks.length === 0) return c.json({ assigned: 0 });

    const results: Array<{ id: string; agent: string }> = [];
    for (const task of tasks) {
      const agent = await classifyTaskAgent(task.prompt);
      if (agent && assignMissionTask(task.id, agent)) {
        results.push({ id: task.id, agent });
      }
    }
    return c.json({ assigned: results.length, results });
  });

  app.patch('/api/mission/tasks/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<{ assigned_agent?: string }>();
    const newAgent = body?.assigned_agent?.trim();
    if (!newAgent) return c.json({ error: 'assigned_agent required' }, 400);
    const validAgents = ['main', ...listAgentIds()];
    if (!validAgents.includes(newAgent)) return c.json({ error: 'Unknown agent' }, 400);
    const ok = reassignMissionTask(id, newAgent);
    return c.json({ ok });
  });

  app.delete('/api/mission/tasks/:id', (c) => {
    const id = c.req.param('id');
    const ok = deleteMissionTask(id);
    return c.json({ ok });
  });

  app.get('/api/mission/history', (c) => {
    const limit = parseInt(c.req.query('limit') || '30', 10);
    const offset = parseInt(c.req.query('offset') || '0', 10);
    return c.json(getMissionTaskHistory(limit, offset));
  });

  // Activity log (multi-agent coordination and audit trail)
  app.get('/api/activity', (c) => {
    const limit = parseInt(c.req.query('limit') || '100', 10);
    const feed = getActivityFeed(Math.min(limit, 500));
    return c.json({ activities: feed });
  });

  app.get('/api/activity/session/:sessionId', (c) => {
    const sessionId = c.req.param('sessionId');
    const limit = parseInt(c.req.query('limit') || '50', 10);
    const activities = getSessionActivities(sessionId, Math.min(limit, 500));
    return c.json({ activities });
  });

  app.get('/api/activity/agent/:agentId', (c) => {
    const agentId = c.req.param('agentId');
    const hoursBack = parseInt(c.req.query('hours') || '24', 10);
    const limit = parseInt(c.req.query('limit') || '100', 10);
    const activities = getAgentRecentActivities(agentId, hoursBack, Math.min(limit, 500));
    const errorRate = getAgentErrorRate(agentId, hoursBack);
    const summary = getAgentActivitySummary(agentId, 6);
    return c.json({ activities, errorRate, summary });
  });

  // Memory stats
  app.get('/api/memories', (c) => {
    const chatId = c.req.query('chatId') || ALLOWED_CHAT_ID || '';
    const stats = getDashboardMemoryStats(chatId);
    const fading = getDashboardLowSalienceMemories(chatId, 10);
    const topAccessed = getDashboardTopAccessedMemories(chatId, 5);
    const timeline = getDashboardMemoryTimeline(chatId, 30);
    const consolidations = getDashboardConsolidations(chatId, 5);
    return c.json({ stats, fading, topAccessed, timeline, consolidations });
  });

  // Memory list (for drill-down drawer)
  app.get('/api/memories/pinned', (c) => {
    const chatId = c.req.query('chatId') || ALLOWED_CHAT_ID || '';
    const memories = getDashboardPinnedMemories(chatId);
    return c.json({ memories });
  });

  app.get('/api/memories/topics', (c) => {
    const chatId = c.req.query('chatId') || ALLOWED_CHAT_ID || '';
    return c.json({ topics: getMemoryTopics(chatId) });
  });

  app.get('/api/memories/list', (c) => {
    const chatId = c.req.query('chatId') || ALLOWED_CHAT_ID || '';
    const limit = parseInt(c.req.query('limit') || '50', 10);
    const offset = parseInt(c.req.query('offset') || '0', 10);
    const sortBy = (c.req.query('sort') || 'importance') as 'importance' | 'salience' | 'recent';
    const q = c.req.query('q')?.trim();
    if (q) {
      const searched = searchMemories(chatId, q, limit);
      return c.json({ memories: searched, total: searched.length });
    }
    const filters: import('./db.js').MemoryListFilters = {};
    const topic = c.req.query('topic')?.trim();
    if (topic) filters.topic = topic;
    if (c.req.query('pinned') === '1') filters.pinnedOnly = true;
    const impMin = c.req.query('importanceMin');
    if (impMin) filters.importanceMin = parseFloat(impMin);
    const impMax = c.req.query('importanceMax');
    if (impMax) filters.importanceMax = parseFloat(impMax);
    const dateFrom = c.req.query('dateFrom');
    if (dateFrom) filters.dateFrom = Math.floor(new Date(dateFrom).getTime() / 1000);
    const dateTo = c.req.query('dateTo');
    if (dateTo) filters.dateTo = Math.floor(new Date(dateTo).getTime() / 1000) + 86400;
    const source = c.req.query('source')?.trim();
    if (source) filters.source = source;
    const result = getDashboardMemoriesList(chatId, limit, offset, sortBy, filters);
    return c.json(result);
  });

  // Pin/unpin memories
  app.post('/api/memories/:id/pin', (c) => {
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);
    pinMemory(id);
    return c.json({ ok: true });
  });

  app.post('/api/memories/:id/unpin', (c) => {
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);
    unpinMemory(id);
    return c.json({ ok: true });
  });

  // System health
  app.get('/api/health', (c) => {
    const chatId = c.req.query('chatId') || ALLOWED_CHAT_ID || '';
    const sessionId = getSession(chatId);
    let contextPct = 0;
    let turns = 0;
    let compactions = 0;
    let sessionAge = '-';

    if (sessionId) {
      const summary = getSessionTokenUsage(sessionId);
      if (summary) {
        turns = summary.turns;
        compactions = summary.compactions;
        const contextTokens = (summary.lastContextTokens || 0) + (summary.lastCacheRead || 0);
        contextPct = contextTokens > 0 ? Math.round((contextTokens / CONTEXT_LIMIT) * 100) : 0;
        const ageSec = Math.floor(Date.now() / 1000) - summary.firstTurnAt;
        if (ageSec < 3600) sessionAge = Math.floor(ageSec / 60) + 'm';
        else if (ageSec < 86400) sessionAge = Math.floor(ageSec / 3600) + 'h';
        else sessionAge = Math.floor(ageSec / 86400) + 'd';
      }
    }

    return c.json({
      contextPct,
      turns,
      compactions,
      sessionAge,
      model: agentDefaultModel || 'sonnet-4-6',
      telegramConnected: getTelegramConnected(),
      waConnected: WHATSAPP_ENABLED,
      slackConnected: !!SLACK_USER_TOKEN,
    });
  });

  // Token / cost stats
  app.get('/api/tokens', (c) => {
    const chatId = c.req.query('chatId') || ALLOWED_CHAT_ID || '';
    const stats = getDashboardTokenStats(chatId);
    const costTimeline = getDashboardCostTimeline(chatId, 30);
    const recentUsage = getDashboardRecentTokenUsage(chatId, 20);
    return c.json({ stats, costTimeline, recentUsage });
  });

  // Bot info (name, PID, chatId) — reads dynamically from state
  app.get('/api/info', async (c) => {
    const info = getBotInfo();
    const { getBotIdentity } = await import('./overlay.js');
    const identity = getBotIdentity();
    return c.json({
      botName: identity.name || info.name || 'WildClaude',
      botEmoji: identity.emoji || '🐺',
      botTagline: identity.tagline || 'Personal AI Operating System',
      botTheme: identity.theme || 'purple',
      botUsername: info.username || '',
      pid: process.pid,
      chatId: ALLOWED_CHAT_ID || null,
      agentId: AGENT_ID,
    });
  });

  // System vitals (CPU, RAM, disk — critical for Pi monitoring)
  app.get('/api/vitals', async (c) => {
    const mem = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const uptime = process.uptime();
    const sysUptime = os.uptime();
    const loadAvg = os.loadavg();
    const cpus = os.cpus();
    const hostname = os.hostname();
    const nodeVersion = process.version;

    // CPU usage per core
    const cpuInfo = cpus.map((cpu, i) => {
      const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
      const idle = cpu.times.idle;
      return { core: i, model: cpu.model, speedMHz: cpu.speed, usagePct: Math.round(((total - idle) / total) * 100) };
    });

    // Disk usage and temperature (using child_process)
    let diskInfo = null;
    let temperature = null;
    try {
      const cp = await import('child_process');
      try {
        const df = cp.execSync('df -h / | tail -1', { timeout: 2000 }).toString().trim().split(/\s+/);
        diskInfo = { total: df[1], used: df[2], free: df[3], usedPct: df[4] };
      } catch { /* df not available */ }
      try {
        const temp = cp.execSync('cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null', { timeout: 1000 }).toString().trim();
        if (temp) temperature = (parseInt(temp, 10) / 1000).toFixed(1) + '°C';
      } catch { /* not Pi */ }
    } catch { /* child_process not available */ }

    // Network interfaces
    const nets = os.networkInterfaces();
    const networkInfo = Object.entries(nets).flatMap(([name, addrs]) =>
      (addrs || []).filter(a => !a.internal && a.family === 'IPv4').map(a => ({ interface: name, ip: a.address }))
    );

    return c.json({
      process: {
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
        rssMB: Math.round(mem.rss / 1024 / 1024),
        externalMB: Math.round((mem.external || 0) / 1024 / 1024),
        uptimeMin: Math.round(uptime / 60),
        nodeVersion,
        pid: process.pid,
      },
      system: {
        hostname,
        totalMemMB: Math.round(totalMem / 1024 / 1024),
        freeMemMB: Math.round(freeMem / 1024 / 1024),
        usedMemPct: Math.round(((totalMem - freeMem) / totalMem) * 100),
        loadAvg1m: loadAvg[0]?.toFixed(2) ?? '0',
        loadAvg5m: loadAvg[1]?.toFixed(2) ?? '0',
        loadAvg15m: loadAvg[2]?.toFixed(2) ?? '0',
        sysUptimeHours: Math.round(sysUptime / 3600),
        cpuCount: cpus.length,
        platform: os.platform(),
        arch: os.arch(),
        temperature,
        disk: diskInfo,
        network: networkInfo,
        cpuCores: cpuInfo,
      },
    });
  });

  // ── Agent endpoints ──────────────────────────────────────────────────

  // List all configured agents with status
  app.get('/api/agents', async (c) => {
    const agentIds = listAgentIds();
    const agents = agentIds.map((id) => {
      try {
        const config = loadAgentConfig(id);
        // Check if agent process is alive via PID file
        const pidFile = path.join(STORE_DIR, `agent-${id}.pid`);
        let running = false;
        if (fs.existsSync(pidFile)) {
          try {
            const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
            process.kill(pid, 0); // signal 0 = check if alive
            running = true;
          } catch { /* process not running */ }
        }
        const stats = getAgentTokenStats(id);
        return {
          id,
          name: config.name,
          description: config.description,
          model: config.model ?? 'claude-opus-4-6',
          running,
          todayTurns: stats.todayTurns,
          todayCost: stats.todayCost,
        };
      } catch {
        return { id, name: id, description: '', model: 'unknown', running: false, todayTurns: 0, todayCost: 0 };
      }
    });

    // Include main bot too
    const mainPidFile = path.join(STORE_DIR, 'claudeclaw.pid');
    let mainRunning = false;
    if (fs.existsSync(mainPidFile)) {
      try {
        const pid = parseInt(fs.readFileSync(mainPidFile, 'utf-8').trim(), 10);
        process.kill(pid, 0);
        mainRunning = true;
      } catch { /* not running */ }
    }
    const mainStats = getAgentTokenStats('main');
    // Include registry agents (our 16 custom agents)
    let registryAgents: Array<{ id: string; name: string; description: string; model: string; lane: string; running: boolean; todayTurns: number; todayCost: number }> = [];
    try {
      const { getRegisteredAgents } = await import('./agent-registry.js');
      const registered = getRegisteredAgents();
      const existingIds = new Set(agents.map(a => a.id));
      registryAgents = registered
        .filter(r => !existingIds.has(r.id))
        .map(r => ({
          ...r,
          running: false, // registry agents don't run as separate processes
          todayTurns: 0,
          todayCost: 0,
        }));
    } catch { /* registry not available */ }

    const allAgents = [
      { id: 'main', name: 'Main', description: 'Primary WildClaude bot', model: 'claude-opus-4-6', lane: 'coordination', running: mainRunning, todayTurns: mainStats.todayTurns, todayCost: mainStats.todayCost },
      ...agents.map(a => ({ ...a, lane: '' })),
      ...registryAgents,
    ];

    return c.json({ agents: allAgents });
  });

  // Agent-specific recent conversation
  // Read a registry agent's full content (including frontmatter for editing)
  app.get('/api/agents/:id/prompt', async (c) => {
    const id = c.req.param('id');
    try {
      const { getRegisteredAgents, getAgentFullContent, getAgentSystemPrompt } = await import('./agent-registry.js');
      const agent = getRegisteredAgents().find((a: { id: string }) => a.id === id);
      if (!agent) return c.json({ error: 'Agent not found' }, 404);
      const fullContent = getAgentFullContent(id);
      const prompt = getAgentSystemPrompt(id) || '';
      return c.json({ ...agent, id, systemPrompt: prompt, fullContent });
    } catch { return c.json({ error: 'Agent registry not available' }, 500); }
  });

  // Update a registry agent's system prompt (and optionally model/lane)
  app.put('/api/agents/:id/prompt', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<{ content: string; model?: string; lane?: string }>();
    if (!body?.content) return c.json({ error: 'content required' }, 400);
    try {
      const { getRegisteredAgents, reloadRegistry } = await import('./agent-registry.js');
      const agent = getRegisteredAgents().find((a: { id: string; lane: string }) => a.id === id);
      if (!agent) return c.json({ error: 'Agent not found' }, 404);

      const targetLane = body.lane || agent.lane;

      // If model changed, update frontmatter in content
      let content = body.content;
      if (body.model && content.startsWith('---')) {
        content = content.replace(/^(model:\s*).+$/m, `$1${body.model}`);
      }
      if (body.lane && content.startsWith('---')) {
        content = content.replace(/^(lane:\s*).+$/m, `$1${body.lane}`);
      }

      // Write to user overlay (not PROJECT_ROOT) per overlay system rules
      writeOverlayFile(`agents/${targetLane}`, `${id}.md`, content);

      // Reload registry to pick up changes
      reloadRegistry();

      return c.json({ ok: true });
    } catch (err) { return c.json({ error: String(err) }, 500); }
  });

  // Create a new registry agent
  app.post('/api/agents/registry', async (c) => {
    const body = await c.req.json<{ id: string; name: string; description: string; model: string; lane: string; systemPrompt?: string }>();
    if (!body?.id || !body?.lane) return c.json({ error: 'id and lane required' }, 400);
    try {
      const { createAgent } = await import('./evolution.js');
      const agentPath = createAgent(body.id, body.name || body.id, body.description || '', body.model || 'claude-sonnet-4-6', body.lane, body.systemPrompt || `# ${body.name || body.id}\n\nYou are a ${body.id} agent.\n`);
      return c.json({ ok: true, path: agentPath });
    } catch (err) { return c.json({ error: String(err) }, 500); }
  });

  app.get('/api/agents/:id/conversation', (c) => {
    const agentId = c.req.param('id');
    const chatId = c.req.query('chatId') || ALLOWED_CHAT_ID || '';
    const limit = parseInt(c.req.query('limit') || '4', 10);
    const turns = getAgentRecentConversation(agentId, chatId, limit);
    return c.json({ turns });
  });

  // Agent-specific tasks
  app.get('/api/agents/:id/tasks', (c) => {
    const agentId = c.req.param('id');
    const tasks = getAllScheduledTasks(agentId);
    return c.json({ tasks });
  });

  // Agent-specific token stats
  app.get('/api/agents/:id/tokens', (c) => {
    const agentId = c.req.param('id');
    const stats = getAgentTokenStats(agentId);
    return c.json(stats);
  });

  // Update agent model (supports both classic and registry agents)
  app.patch('/api/agents/:id/model', async (c) => {
    const agentId = c.req.param('id');
    const body = await c.req.json<{ model?: string }>();
    const model = body?.model?.trim();
    if (!model) return c.json({ error: 'model required' }, 400);

    const validModels = ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5'];
    if (!validModels.includes(model)) return c.json({ error: `Invalid model. Valid: ${validModels.join(', ')}` }, 400);

    try {
      if (agentId === 'main') {
        const { setMainModelOverride } = await import('./bot.js');
        setMainModelOverride(model);
      } else {
        // Try classic agent first (agent.yaml), fall back to registry agent (.md frontmatter)
        try {
          setAgentModel(agentId, model);
        } catch {
          // Registry agent: update model in .md frontmatter via overlay
          const { getRegisteredAgents, getAgentFullContent, reloadRegistry } = await import('./agent-registry.js');
          const agent = getRegisteredAgents().find((a: { id: string }) => a.id === agentId);
          if (!agent) return c.json({ error: 'Agent not found' }, 404);
          let content = getAgentFullContent(agentId);
          if (!content) return c.json({ error: 'Agent file not found' }, 404);
          if (content.startsWith('---')) {
            content = content.replace(/^(model:\s*).+$/m, `$1${model}`);
          }
          writeOverlayFile(`agents/${agent.lane}`, `${agentId}.md`, content);
          reloadRegistry();
        }
      }
      return c.json({ ok: true, agent: agentId, model });
    } catch (err) {
      return c.json({ error: 'Failed to update model' }, 500);
    }
  });

  // Update ALL agent models at once
  app.patch('/api/agents/model', async (c) => {
    const body = await c.req.json<{ model?: string }>();
    const model = body?.model?.trim();
    if (!model) return c.json({ error: 'model required' }, 400);

    const validModels = ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5'];
    if (!validModels.includes(model)) return c.json({ error: `Invalid model` }, 400);

    const agentIds = listAgentIds();
    const updated: string[] = [];
    for (const id of agentIds) {
      try { setAgentModel(id, model); updated.push(id); } catch {}
    }
    return c.json({ ok: true, model, updated });
  });

  // ── Agent Creation & Management ──────────────────────────────────────

  // List available agent templates
  app.get('/api/agents/templates', (c) => {
    return c.json({ templates: listTemplates() });
  });

  // Validate an agent ID (before creation)
  app.get('/api/agents/validate-id', (c) => {
    const id = c.req.query('id') || '';
    const result = validateAgentId(id);
    const suggestions = id ? suggestBotNames(id) : null;
    return c.json({ ...result, suggestions });
  });

  // Validate a bot token
  app.post('/api/agents/validate-token', async (c) => {
    const body = await c.req.json<{ token?: string }>();
    const token = body?.token?.trim();
    if (!token) return c.json({ ok: false, error: 'token required' }, 400);
    const result = await validateBotToken(token);
    return c.json(result);
  });

  // Create a new agent
  app.post('/api/agents/create', async (c) => {
    const body = await c.req.json<{
      id?: string;
      name?: string;
      description?: string;
      model?: string;
      template?: string;
      botToken?: string;
    }>();

    const id = body?.id?.trim();
    const name = body?.name?.trim();
    const description = body?.description?.trim();
    const botToken = body?.botToken?.trim();

    if (!id) return c.json({ error: 'id required' }, 400);
    if (!name) return c.json({ error: 'name required' }, 400);
    if (!description) return c.json({ error: 'description required' }, 400);
    if (!botToken) return c.json({ error: 'botToken required' }, 400);

    try {
      const result = await createAgent({
        id,
        name,
        description,
        model: body?.model?.trim() || undefined,
        template: body?.template?.trim() || undefined,
        botToken,
      });
      return c.json({ ok: true, ...result }, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 400);
    }
  });

  // Activate an agent (install service + start)
  app.post('/api/agents/:id/activate', (c) => {
    const agentId = c.req.param('id');
    if (agentId === 'main') return c.json({ error: 'Cannot activate main via this endpoint' }, 400);
    const result = activateAgent(agentId);
    return c.json(result);
  });

  // Deactivate an agent (stop + uninstall service)
  app.post('/api/agents/:id/deactivate', (c) => {
    const agentId = c.req.param('id');
    if (agentId === 'main') return c.json({ error: 'Cannot deactivate main via this endpoint' }, 400);
    const result = deactivateAgent(agentId);
    return c.json(result);
  });

  // Delete an agent entirely
  app.delete('/api/agents/:id/full', (c) => {
    const agentId = c.req.param('id');
    if (agentId === 'main') return c.json({ error: 'Cannot delete main' }, 400);
    const result = deleteAgent(agentId);
    if (result.ok) {
      return c.json({ ok: true });
    }
    return c.json({ error: result.error }, 500);
  });

  // Check if a specific agent is running
  app.get('/api/agents/:id/status', (c) => {
    const agentId = c.req.param('id');
    return c.json({ running: isAgentRunning(agentId) });
  });

  // ── Skills endpoint ────────────────────────────────────────────────

  app.get('/api/skills', (c) => {
    const skills: Array<{ name: string; description: string; source: string }> = [];

    // Scan project skills
    const projectSkillsDir = path.join(PROJECT_ROOT, 'skills');
    if (fs.existsSync(projectSkillsDir)) {
      for (const name of fs.readdirSync(projectSkillsDir)) {
        const skillFile = path.join(projectSkillsDir, name, 'SKILL.md');
        if (fs.existsSync(skillFile)) {
          const content = fs.readFileSync(skillFile, 'utf-8');
          const descMatch = content.match(/description:\s*(.+)/);
          skills.push({
            name,
            description: descMatch?.[1]?.trim() || '',
            source: 'built-in',
          });
        }
      }
    }

    // Scan user skills
    try {
      const userSkillsDir = path.join(USER_DATA_DIR, 'skills');
      if (fs.existsSync(userSkillsDir)) {
        for (const name of fs.readdirSync(userSkillsDir)) {
          const skillFile = path.join(userSkillsDir, name, 'SKILL.md');
          if (fs.existsSync(skillFile)) {
            // User skill overrides built-in with same name
            const existing = skills.findIndex(s => s.name === name);
            if (existing >= 0) skills.splice(existing, 1);
            const content = fs.readFileSync(skillFile, 'utf-8');
            const descMatch = content.match(/description:\s*(.+)/);
            skills.push({
              name,
              description: descMatch?.[1]?.trim() || '',
              source: 'user',
            });
          }
        }
      }
    } catch { /* paths module not loaded */ }

    return c.json({ skills });
  });

  // Read a skill's content — user overlay takes priority over built-in
  app.get('/api/skills/:name', (c) => {
    const name = c.req.param('name');
    const userFile = path.join(USER_DATA_DIR, 'skills', name, 'SKILL.md');
    const projectFile = path.join(PROJECT_ROOT, 'skills', name, 'SKILL.md');
    const skillFile = fs.existsSync(userFile) ? userFile : projectFile;
    if (!fs.existsSync(skillFile)) return c.json({ error: 'Skill not found' }, 404);
    return c.json({ name, content: fs.readFileSync(skillFile, 'utf-8') });
  });

  // Update a skill's content — always write to user data dir (overlay)
  app.put('/api/skills/:name', async (c) => {
    const name = c.req.param('name');
    const body = await c.req.json<{ content: string }>();
    if (!body?.content) return c.json({ error: 'content required' }, 400);
    const skillDir = path.join(USER_DATA_DIR, 'skills', name);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), body.content);
    return c.json({ ok: true });
  });

  // Create a new skill — always write to user data dir
  app.post('/api/skills', async (c) => {
    const body = await c.req.json<{ name: string; description: string; content?: string }>();
    if (!body?.name) return c.json({ error: 'name required' }, 400);
    const safeName = body.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const skillDir = path.join(USER_DATA_DIR, 'skills', safeName);
    fs.mkdirSync(skillDir, { recursive: true });
    const content = body.content || `---\nname: ${safeName}\ndescription: ${body.description || ''}\n---\n\n# ${body.name}\n\n## When to Use\n${body.description || 'Describe when this skill activates'}\n\n## Instructions\n1. Step one\n2. Step two\n`;
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content);
    return c.json({ ok: true, name: safeName });
  });

  // Delete a skill — only delete user overrides, never built-in skills
  app.delete('/api/skills/:name', (c) => {
    const name = c.req.param('name');
    const userSkillDir = path.join(USER_DATA_DIR, 'skills', name);
    if (fs.existsSync(userSkillDir)) {
      fs.rmSync(userSkillDir, { recursive: true });
      return c.json({ ok: true });
    }
    // Built-in skills can't be deleted via API (only user overrides can)
    const builtInFile = path.join(PROJECT_ROOT, 'skills', name, 'SKILL.md');
    if (fs.existsSync(builtInFile)) return c.json({ error: 'Cannot delete built-in skill' }, 403);
    return c.json({ error: 'Skill not found' }, 404);
  });

  // ── Secrets management endpoints ──────────────────────────────────

  app.get('/api/secrets', async (c) => {
    const { getSecretsStatus, getAvailableUpgrades } = await import('./secrets.js');
    return c.json({ secrets: getSecretsStatus(), upgrades: getAvailableUpgrades() });
  });

  app.post('/api/secrets/:key', async (c) => {
    const key = c.req.param('key');
    const body = await c.req.json<{ value: string }>();
    if (!body?.value) return c.json({ error: 'value required' }, 400);
    const { setSecret } = await import('./secrets.js');
    setSecret(key, body.value);
    return c.json({ ok: true });
  });

  app.delete('/api/secrets/:key', async (c) => {
    const key = c.req.param('key');
    const { deleteSecret } = await import('./secrets.js');
    const deleted = deleteSecret(key);
    return c.json({ ok: deleted });
  });

  // ── MCP management endpoints ──────────────────────────────────────

  app.get('/api/mcp', async (c) => {
    const { listInstalledMcps, listAvailableMcps } = await import('./mcp-manager.js');
    return c.json({ installed: listInstalledMcps(), available: listAvailableMcps() });
  });

  app.post('/api/mcp/:id/install', async (c) => {
    const id = c.req.param('id');
    const { installMcp } = await import('./mcp-manager.js');
    const result = installMcp(id);
    return c.json(result);
  });

  app.delete('/api/mcp/:id', async (c) => {
    const id = c.req.param('id');
    const { uninstallMcp } = await import('./mcp-manager.js');
    const removed = uninstallMcp(id);
    return c.json({ ok: removed });
  });

  // ── Memory management endpoints ───────────────────────────────────

  app.delete('/api/memories/:id', async (c) => {
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);
    const { deleteMemory } = await import('./db.js');
    deleteMemory(id);
    return c.json({ ok: true });
  });

  // ── Profile endpoints ──────────────────────────────────────────────

  app.get('/api/profile', (c) => {
    const domains = ['me', 'goals', 'health', 'finance', 'learning'];
    const profile: Record<string, string> = {};
    for (const domain of domains) {
      const keyFile = path.join(USER_DATA_DIR, 'life', domain, '_kernel', 'key.md');
      try {
        if (fs.existsSync(keyFile)) profile[domain] = fs.readFileSync(keyFile, 'utf-8');
      } catch { /* skip */ }
    }
    return c.json({ profile });
  });

  app.put('/api/profile/:domain', async (c) => {
    const domain = c.req.param('domain');
    const valid = ['me', 'goals', 'health', 'finance', 'learning'];
    if (!valid.includes(domain)) return c.json({ error: 'Invalid domain' }, 400);
    const body = await c.req.json<{ content: string }>();
    if (!body?.content) return c.json({ error: 'content required' }, 400);
    const keyFile = path.join(USER_DATA_DIR, 'life', domain, '_kernel', 'key.md');
    fs.mkdirSync(path.dirname(keyFile), { recursive: true });
    fs.writeFileSync(keyFile, body.content);
    return c.json({ ok: true });
  });

  // ── Personality endpoints ──────────────────────────────────────────

  app.get('/api/personality', (c) => {
    return c.json(loadPersonalityConfig());
  });

  app.put('/api/personality', async (c) => {
    const body = await c.req.json<PersonalityConfig>();
    if (!body) return c.json({ error: 'body required' }, 400);
    const config = loadUserConfig();
    saveUserConfig({ ...config, personality: body });
    // No session clear needed — personality is injected via --append-system-prompt
    // on every message, so changes take effect immediately without losing context.
    return c.json({ ok: true });
  });

  app.get('/api/personality/presets', (c) => {
    return c.json({ presets: listPresets() });
  });

  app.post('/api/personality/presets', async (c) => {
    const body = await c.req.json<{ id: string; name: string; description: string; config: PersonalityConfig }>();
    if (!body?.id || !body.name || !body.config) return c.json({ error: 'id, name, and config required' }, 400);
    savePreset(body.id, body.name, body.description || '', body.config);
    return c.json({ ok: true });
  });

  app.delete('/api/personality/presets/:id', (c) => {
    const id = c.req.param('id');
    const deleted = deletePreset(id);
    if (!deleted) return c.json({ error: 'Preset not found or is built-in' }, 404);
    return c.json({ ok: true });
  });

  app.post('/api/personality/preview', async (c) => {
    const body = await c.req.json<PersonalityConfig>();
    if (!body) return c.json({ error: 'body required' }, 400);
    const text = generatePersonalityPrompt(body);
    return c.json({ text });
  });

  app.post('/api/personality/apply', async (c) => {
    const body = await c.req.json<PersonalityConfig>();
    if (!body) return c.json({ error: 'body required' }, 400);
    const config = loadUserConfig();
    saveUserConfig({ ...config, personality: body });
    // No session clear needed — personality is injected via --append-system-prompt
    // on every message, so changes take effect immediately without losing context.
    return c.json({ ok: true });
  });

  // ── Verbosity endpoints ────────────────────────────────────────────

  app.get('/api/verbosity', async (c) => {
    const { getVerbosity } = await import('./overlay.js');
    return c.json(getVerbosity());
  });

  app.put('/api/verbosity', async (c) => {
    const body = await c.req.json();
    if (!body) return c.json({ error: 'body required' }, 400);
    const { loadUserConfig, saveUserConfig } = await import('./overlay.js');
    const config = loadUserConfig();
    config.verbosity = { ...(config.verbosity || {}), ...body };
    saveUserConfig(config);
    return c.json({ ok: true });
  });

  // ── Import endpoints ───────────────────────────────────────────────

  app.get('/api/import/sources', async (c) => {
    const { detectSources } = await import('./importer.js');
    return c.json({ sources: detectSources() });
  });

  app.post('/api/import/auto', async (c) => {
    const chatId = ALLOWED_CHAT_ID || '';
    const { autoImport } = await import('./importer.js');
    const results = await autoImport(chatId);
    const totalMem = results.reduce((s, r) => s + r.memoriesImported, 0);
    const totalFiles = results.reduce((s, r) => s + r.filesImported, 0);
    return c.json({ results, totalMemories: totalMem, totalFiles });
  });

  app.post('/api/import/file', async (c) => {
    const chatId = ALLOWED_CHAT_ID || '';
    const body = await c.req.json<{ path: string; type?: string }>();
    if (!body?.path) return c.json({ error: 'path required' }, 400);

    const { importFromSqlite, importFromJson, importFromMarkdown } = await import('./importer.js');
    const p = body.path;
    let result;
    if (p.endsWith('.db')) result = importFromSqlite(p, chatId);
    else if (p.endsWith('.json')) result = importFromJson(p, chatId);
    else result = importFromMarkdown(p, chatId);
    return c.json(result);
  });

  // ── Security & Audit ─────────────────────────────────────────────────

  app.get('/api/security/status', (c) => {
    return c.json(getSecurityStatus());
  });

  app.get('/api/audit', (c) => {
    const limit = parseInt(c.req.query('limit') || '50', 10);
    const offset = parseInt(c.req.query('offset') || '0', 10);
    const agentId = c.req.query('agent') || undefined;
    const entries = getAuditLog(limit, offset, agentId);
    const total = getAuditLogCount(agentId);
    return c.json({ entries, total });
  });

  app.get('/api/audit/blocked', (c) => {
    const limit = parseInt(c.req.query('limit') || '10', 10);
    return c.json({ entries: getRecentBlockedActions(limit) });
  });

  // Hive mind feed
  app.get('/api/hive-mind', (c) => {
    const agentId = c.req.query('agent');
    const limit = parseInt(c.req.query('limit') || '20', 10);
    const entries = getHiveMindEntries(limit, agentId || undefined);
    return c.json({ entries });
  });

  // ── Chat endpoints ─────────────────────────────────────────────────

  // SSE stream for real-time chat updates
  app.get('/api/chat/stream', (c) => {
    return streamSSE(c, async (stream) => {
      // Send initial processing state
      const state = getIsProcessing();
      await stream.writeSSE({
        event: 'processing',
        data: JSON.stringify({ processing: state.processing, chatId: state.chatId }),
      });

      // Forward chat events to SSE client
      const handler = async (event: ChatEvent) => {
        try {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event),
          });
        } catch {
          // Client disconnected
        }
      };

      chatEvents.on('chat', handler);

      // Keepalive ping every 30s
      const pingInterval = setInterval(async () => {
        try {
          await stream.writeSSE({ event: 'ping', data: '' });
        } catch {
          clearInterval(pingInterval);
        }
      }, 30_000);

      // Wait until the client disconnects
      try {
        await new Promise<void>((_, reject) => {
          stream.onAbort(() => reject(new Error('aborted')));
        });
      } catch {
        // Expected: client disconnected
      } finally {
        clearInterval(pingInterval);
        chatEvents.off('chat', handler);
      }
    });
  });

  // Chat history (paginated)
  app.get('/api/chat/history', (c) => {
    const chatId = c.req.query('chatId') || ALLOWED_CHAT_ID || '';
    if (!chatId) return c.json({ error: 'chatId required' }, 400);
    const limit = parseInt(c.req.query('limit') || '40', 10);
    const beforeId = c.req.query('beforeId');
    const turns = getConversationPage(chatId, limit, beforeId ? parseInt(beforeId, 10) : undefined);
    return c.json({ turns });
  });

  // Send message from dashboard
  app.post('/api/chat/send', async (c) => {
    if (!botApi) return c.json({ error: 'Bot API not available' }, 503);
    const body = await c.req.json<{ message?: string }>();
    const message = body?.message?.trim();
    if (!message) return c.json({ error: 'message required' }, 400);

    // Fire-and-forget: response comes via SSE
    void processMessageFromDashboard(botApi, message);
    return c.json({ ok: true });
  });

  // Abort current processing
  app.post('/api/chat/abort', (c) => {
    const { chatId } = getIsProcessing();
    if (!chatId) return c.json({ ok: false, reason: 'not_processing' });
    const aborted = abortActiveQuery(chatId);
    return c.json({ ok: aborted });
  });

  // ── File Explorer ──────────────────────────────────────────────────

  const FILE_ROOTS: Record<string, string> = {
    project: PROJECT_ROOT,
    data: USER_DATA_DIR,
  };

  function resolveFileRoot(rootKey: string, base?: string): string | null {
    if (rootKey === 'system') {
      if (!base || !base.startsWith('/')) return null;
      const resolved = path.resolve(base);
      // Block sensitive system paths
      const blocked = ['/proc', '/sys', '/dev', '/run', '/boot'];
      if (blocked.some(b => resolved === b || resolved.startsWith(b + '/'))) return null;
      return resolved;
    }
    return FILE_ROOTS[rootKey] || null;
  }

  app.get('/api/files', (c) => {
    const rootKey = c.req.query('root') || 'data';
    const base = c.req.query('base') || '';
    const sub = c.req.query('path') || '';
    const rootDir = resolveFileRoot(rootKey, base);
    if (!rootDir) return c.json({ error: 'Invalid root' }, 400);

    const resolved = path.resolve(rootDir, sub);
    if (!resolved.startsWith(rootDir)) return c.json({ error: 'Access denied' }, 403);

    try {
      const entries = fs.readdirSync(resolved, { withFileTypes: true });
      const files = entries
        .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== 'dist')
        .map(e => {
          const full = path.join(resolved, e.name);
          try {
            const stat = fs.statSync(full);
            return { name: e.name, isDir: e.isDirectory(), size: stat.size, modified: stat.mtime.getTime() };
          } catch {
            return { name: e.name, isDir: e.isDirectory(), size: 0, modified: 0 };
          }
        })
        .sort((a, b) => (b.isDir ? 1 : 0) - (a.isDir ? 1 : 0) || a.name.localeCompare(b.name));
      return c.json({ root: rootKey, path: sub, base: rootKey === 'system' ? rootDir : undefined, files });
    } catch (err: unknown) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.get('/api/files/read', (c) => {
    const rootKey = c.req.query('root') || 'data';
    const base = c.req.query('base') || '';
    const filePath = c.req.query('path') || '';
    const rootDir = resolveFileRoot(rootKey, base);
    if (!rootDir) return c.json({ error: 'Invalid root' }, 400);

    const resolved = path.resolve(rootDir, filePath);
    if (!resolved.startsWith(rootDir)) return c.json({ error: 'Access denied' }, 403);

    try {
      if (!fs.existsSync(resolved)) return c.json({ error: 'Not found' }, 404);
      const stat = fs.statSync(resolved);
      if (stat.size > 512_000) return c.json({ error: 'File too large (>500KB)' }, 413);
      const content = fs.readFileSync(resolved, 'utf-8');
      return c.json({ path: filePath, content, size: stat.size, modified: stat.mtime.getTime() });
    } catch (err: unknown) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.get('/api/files/download', (c) => {
    const rootKey = c.req.query('root') || 'data';
    const base = c.req.query('base') || '';
    const filePath = c.req.query('path') || '';
    const rootDir = resolveFileRoot(rootKey, base);
    if (!rootDir) return c.json({ error: 'Invalid root' }, 400);

    const resolved = path.resolve(rootDir, filePath);
    if (!resolved.startsWith(rootDir)) return c.json({ error: 'Access denied' }, 403);

    try {
      if (!fs.existsSync(resolved)) return c.json({ error: 'Not found' }, 404);
      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) return c.json({ error: 'Cannot download a directory' }, 400);
      const filename = path.basename(resolved);
      const buffer = fs.readFileSync(resolved);
      c.header('Content-Disposition', `attachment; filename="${filename}"`);
      c.header('Content-Type', 'application/octet-stream');
      c.header('Content-Length', String(stat.size));
      return c.body(buffer as unknown as string);
    } catch (err: unknown) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  // ── System Upgrade / Downgrade ────────────────────────────────────
  const UPGRADE_STATUS_FILE = '/tmp/wildclaude-upgrade-status.json';

  function writeUpgradeStatus(status: string, message: string) {
    try { fs.writeFileSync(UPGRADE_STATUS_FILE, JSON.stringify({ status, message, ts: Date.now() })); } catch { /* ignore */ }
  }

  app.get('/api/system/versions', async (c) => {
    const cp = await import('child_process');
    try {
      // Try to fetch from remote (non-fatal if offline)
      try { cp.execSync(`git -C "${PROJECT_ROOT}" fetch origin --quiet`, { timeout: 8000 }); } catch { /* offline or no remote */ }

      const currentHash = cp.execSync(`git -C "${PROJECT_ROOT}" rev-parse --short HEAD`, { timeout: 3000 }).toString().trim();
      const currentFull = cp.execSync(`git -C "${PROJECT_ROOT}" rev-parse HEAD`, { timeout: 3000 }).toString().trim();

      // Remote HEAD (origin/master or origin/main)
      let remoteHash = '';
      let remoteMessage = '';
      let remoteDate = '';
      let behindBy = 0;
      try {
        const remoteBranch = cp.execSync(`git -C "${PROJECT_ROOT}" rev-parse --abbrev-ref --symbolic-full-name @{u}`, { timeout: 3000 }).toString().trim();
        remoteHash = cp.execSync(`git -C "${PROJECT_ROOT}" rev-parse --short ${remoteBranch}`, { timeout: 3000 }).toString().trim();
        const remoteLog = cp.execSync(`git -C "${PROJECT_ROOT}" log --pretty=format:"%s|||%ar" -1 ${remoteBranch}`, { timeout: 3000 }).toString().trim();
        [remoteMessage, remoteDate] = remoteLog.split('|||');
        const behindStr = cp.execSync(`git -C "${PROJECT_ROOT}" rev-list --count HEAD..${remoteBranch}`, { timeout: 3000 }).toString().trim();
        behindBy = parseInt(behindStr, 10) || 0;
      } catch { /* no upstream configured */ }

      // Local commit history (for downgrade options)
      const log = cp.execSync(`git -C "${PROJECT_ROOT}" log --pretty=format:"%h|||%s|||%ar" -20`, { timeout: 3000 }).toString().trim();
      const commits = log.split('\n').map(line => {
        const [hash, message, date] = line.split('|||');
        return { hash: hash?.trim(), message: message?.trim(), date: date?.trim() };
      }).filter(c => c.hash);

      return c.json({
        current: currentHash,
        currentFull,
        remote: remoteHash || currentHash,
        remoteMessage: remoteMessage?.trim() || commits[0]?.message || '',
        remoteDate: remoteDate?.trim() || commits[0]?.date || '',
        behindBy,
        upToDate: behindBy === 0,
        commits,
      });
    } catch (err: unknown) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.get('/api/system/upgrade/status', (c) => {
    try {
      if (fs.existsSync(UPGRADE_STATUS_FILE)) {
        const data = JSON.parse(fs.readFileSync(UPGRADE_STATUS_FILE, 'utf-8'));
        return c.json(data);
      }
    } catch { /* ignore */ }
    return c.json({ status: 'idle', message: '', ts: 0 });
  });

  // Shared restart snippet: tries systemd first, falls back to direct node process
  const restartSnippet = (ts: number) => [
    `echo '{"status":"restarting","message":"Restarting service...","ts":${ts}}' > ${UPGRADE_STATUS_FILE}`,
    `sleep 1`,
    // Try systemd first; if it fails or isn't available, fall back to direct restart
    `if sudo systemctl is-active --quiet wildclaude.service 2>/dev/null; then`,
    `  sudo systemctl restart wildclaude.service`,
    `else`,
    `  pkill -f "node.*dist/index.js" 2>/dev/null || true`,
    `  sleep 1`,
    `  nohup node "${PROJECT_ROOT}/dist/index.js" > /tmp/wildclaude-restart.log 2>&1 &`,
    `  disown`,
    `fi`,
    `echo '{"status":"done","message":"Service restarted","ts":${ts}}' > ${UPGRADE_STATUS_FILE}`,
  ].join('\n');

  app.post('/api/system/upgrade', async (c) => {
    const { spawn } = await import('child_process');
    const ts = Date.now();
    writeUpgradeStatus('pulling', 'Pulling latest code...');
    const script = [
      `set -e`,
      `cd "${PROJECT_ROOT}"`,
      `echo '{"status":"pulling","message":"Pulling latest code...","ts":${ts}}' > ${UPGRADE_STATUS_FILE}`,
      `git pull --ff-only origin master >> /tmp/wildclaude-upgrade.log 2>&1 || git pull --rebase >> /tmp/wildclaude-upgrade.log 2>&1 || (echo '{"status":"error","message":"git pull failed — check /tmp/wildclaude-upgrade.log","ts":${ts}}' > ${UPGRADE_STATUS_FILE} && exit 1)`,
      `echo '{"status":"building","message":"Building TypeScript...","ts":${ts}}' > ${UPGRADE_STATUS_FILE}`,
      `npm run build >> /tmp/wildclaude-upgrade.log 2>&1 || (echo '{"status":"error","message":"Build failed — check /tmp/wildclaude-upgrade.log","ts":${ts}}' > ${UPGRADE_STATUS_FILE} && exit 1)`,
      restartSnippet(ts),
    ].join('\n');
    const child = spawn('bash', ['-c', script], { detached: true, stdio: 'ignore' });
    child.unref();
    return c.json({ ok: true });
  });

  app.post('/api/system/downgrade', async (c) => {
    const body = await c.req.json<{ commit: string }>();
    if (!body?.commit || !/^[0-9a-f]{4,40}$/i.test(body.commit)) {
      return c.json({ error: 'Invalid commit hash' }, 400);
    }
    const commit = body.commit.replace(/[^0-9a-f]/gi, '');
    const { spawn } = await import('child_process');
    const ts = Date.now();
    writeUpgradeStatus('checking-out', `Checking out ${commit}...`);
    const script = [
      `set -e`,
      `cd "${PROJECT_ROOT}"`,
      `echo '{"status":"checking-out","message":"Checking out ${commit}...","ts":${ts}}' > ${UPGRADE_STATUS_FILE}`,
      `git checkout ${commit} >> /tmp/wildclaude-upgrade.log 2>&1 || (echo '{"status":"error","message":"git checkout failed","ts":${ts}}' > ${UPGRADE_STATUS_FILE} && exit 1)`,
      `echo '{"status":"building","message":"Building TypeScript...","ts":${ts}}' > ${UPGRADE_STATUS_FILE}`,
      `npm run build >> /tmp/wildclaude-upgrade.log 2>&1 || (echo '{"status":"error","message":"Build failed — check /tmp/wildclaude-upgrade.log","ts":${ts}}' > ${UPGRADE_STATUS_FILE} && exit 1)`,
      restartSnippet(ts),
    ].join('\n');
    const child = spawn('bash', ['-c', script], { detached: true, stdio: 'ignore' });
    child.unref();
    return c.json({ ok: true });
  });

  app.post('/api/system/restart', async (c) => {
    const { spawn } = await import('child_process');
    const ts = Date.now();
    writeUpgradeStatus('restarting', 'Restarting service...');
    const child = spawn('bash', ['-c', restartSnippet(ts)], { detached: true, stdio: 'ignore' });
    child.unref();
    return c.json({ ok: true });
  });

  app.post('/api/system/reboot', async (c) => {
    const { spawn } = await import('child_process');
    const child = spawn('bash', ['-c', 'sudo reboot'], { detached: true, stdio: 'ignore' });
    child.unref();
    return c.json({ ok: true });
  });

  // ── External service dashboards ────────────────────────────────────
  registerExternalDashboardRoutes(app);

  serve({ fetch: app.fetch, port: DASHBOARD_PORT, hostname: DASHBOARD_HOST }, () => {
    logger.info({ port: DASHBOARD_PORT, host: DASHBOARD_HOST }, 'Dashboard server running');
  });
}
