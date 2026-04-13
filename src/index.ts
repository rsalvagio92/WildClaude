import fs from 'fs';
import path from 'path';

import { loadAgentConfig, resolveAgentDir, resolveAgentClaudeMd } from './agent-config.js';
import { createBot } from './bot.js';
import { checkPendingMigrations } from './migrations.js';
import { ALLOWED_CHAT_ID, activeBotToken, STORE_DIR, PROJECT_ROOT, CLAUDECLAW_CONFIG, setAgentOverrides, SECURITY_PIN_HASH, IDLE_LOCK_MINUTES, EMERGENCY_KILL_PHRASE } from './config.js';
import { ensureUserDataDirs, seedKernelTemplates, USER_DATA_DIR } from './paths.js';
import { ensureEncryptionKey } from './secrets.js';
import { needsCliOnboarding, runCliOnboarding } from './cli-onboarding.js';
import { startDashboard } from './dashboard.js';
import { initDatabase, cleanupOldMissionTasks, insertAuditLog } from './db.js';
import { initSecurity, setAuditCallback } from './security.js';
import { logger } from './logger.js';
import { cleanupOldUploads } from './media.js';
import { runConsolidation } from './memory-consolidate.js';
import { runDecaySweep } from './memory.js';
import { startDailyMemoryScheduler } from './memory-daily.js';
import { initOrchestrator } from './orchestrator.js';
import { initScheduler } from './scheduler.js';
import { syncAutomations } from './automations.js';
import { setTelegramConnected, setBotInfo } from './state.js';

// Parse --agent flag
const agentFlagIndex = process.argv.indexOf('--agent');
const AGENT_ID = agentFlagIndex !== -1 ? process.argv[agentFlagIndex + 1] : 'main';

// Export AGENT_ID to env so child processes (schedule-cli, etc.) inherit it
process.env.CLAUDECLAW_AGENT_ID = AGENT_ID;

if (AGENT_ID !== 'main') {
  const agentConfig = loadAgentConfig(AGENT_ID);
  const agentDir = resolveAgentDir(AGENT_ID);
  const claudeMdPath = resolveAgentClaudeMd(AGENT_ID);
  let systemPrompt: string | undefined;
  if (claudeMdPath) {
    try {
      systemPrompt = fs.readFileSync(claudeMdPath, 'utf-8');
    } catch { /* no CLAUDE.md */ }
  }
  setAgentOverrides({
    agentId: AGENT_ID,
    botToken: agentConfig.botToken,
    cwd: agentDir,
    model: agentConfig.model,
    obsidian: agentConfig.obsidian,
    systemPrompt,
  });
  logger.info({ agentId: AGENT_ID, name: agentConfig.name }, 'Running as agent');
} else {
  // For main bot: read CLAUDE.md from CLAUDECLAW_CONFIG and inject it as
  // systemPrompt — the same pattern used by sub-agents. Never copy the file
  // into the repo; that defeats the purpose of CLAUDECLAW_CONFIG and risks
  // accidentally committing personal config.
  const externalClaudeMd = path.join(CLAUDECLAW_CONFIG, 'CLAUDE.md');
  if (fs.existsSync(externalClaudeMd)) {
    let systemPrompt: string | undefined;
    try {
      systemPrompt = fs.readFileSync(externalClaudeMd, 'utf-8');
    } catch { /* unreadable */ }
    if (systemPrompt) {
      setAgentOverrides({
        agentId: 'main',
        botToken: activeBotToken,
        cwd: PROJECT_ROOT,
        systemPrompt,
      });
      logger.info({ source: externalClaudeMd }, 'Loaded CLAUDE.md from CLAUDECLAW_CONFIG');
    }
  } else if (!fs.existsSync(path.join(PROJECT_ROOT, 'CLAUDE.md'))) {
    logger.warn(
      'No CLAUDE.md found. Copy CLAUDE.md.example to %s/CLAUDE.md and customize it.',
      CLAUDECLAW_CONFIG,
    );
  }
}

const PID_FILE = path.join(STORE_DIR, `${AGENT_ID === 'main' ? 'claudeclaw' : `agent-${AGENT_ID}`}.pid`);

function showBanner(): void {
  const bannerPath = path.join(PROJECT_ROOT, 'banner.txt');
  try {
    const banner = fs.readFileSync(bannerPath, 'utf-8');
    console.log('\n' + banner);
  } catch {
    console.log('\n  WildClaude\n');
  }
}

function acquireLock(): void {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  try {
    if (fs.existsSync(PID_FILE)) {
      const old = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
      if (!isNaN(old) && old !== process.pid) {
        try {
          process.kill(old, 'SIGTERM');
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
        } catch { /* already dead */ }
      }
    }
  } catch { /* ignore */ }
  fs.writeFileSync(PID_FILE, String(process.pid), { mode: 0o600 });
}

function releaseLock(): void {
  try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
}

async function main(): Promise<void> {

  // Initialize user data directory structure (silent)
  ensureUserDataDirs();
  seedKernelTemplates();
  ensureEncryptionKey();

  // Refresh config values that may have been auto-generated
  const { refreshDashboardToken } = await import('./config.js');
  refreshDashboardToken();

  if (AGENT_ID === 'main') {
    // CLI onboarding BEFORE anything else — clean terminal, no log noise
    if (needsCliOnboarding()) {
      if (process.stdin.isTTY) {
        await runCliOnboarding();
      } else {
        console.log('\n  First run detected. Run in an interactive terminal for onboarding:');
        console.log('    npm run dev\n');
      }
    }
    showBanner();
  }

  logger.info({ dataDir: USER_DATA_DIR }, 'User data directory ready');
  checkPendingMigrations(PROJECT_ROOT);

  if (!activeBotToken) {
    if (AGENT_ID !== 'main') {
      logger.error({ agentId: AGENT_ID }, `Agent "${AGENT_ID}" has no bot token. Check .env.`);
      process.exit(1);
    }
    // Dashboard-only mode: no Telegram, just the web UI
    logger.info('No Telegram bot token — running in dashboard-only mode.');
    console.log('\n  No Telegram bot token set. Running dashboard-only mode.');
    console.log('  Set TELEGRAM_BOT_TOKEN in .env to enable Telegram.\n');
  }

  acquireLock();

  initDatabase();
  logger.info('Database ready');

  // Initialize security (PIN lock, kill phrase, destructive confirmation, audit)
  initSecurity({
    pinHash: SECURITY_PIN_HASH || undefined,
    idleLockMinutes: IDLE_LOCK_MINUTES,
    killPhrase: EMERGENCY_KILL_PHRASE || undefined,
  });
  setAuditCallback((entry) => {
    insertAuditLog(entry.agentId, entry.chatId, entry.action, entry.detail, entry.blocked);
  });

  initOrchestrator();

  // Decay and consolidation run ONLY in the main process to prevent
  // multi-process over-decay (5x decay on simultaneous restart) and
  // duplicate consolidation records from overlapping memory batches.
  if (AGENT_ID === 'main') {
    runDecaySweep();
    cleanupOldMissionTasks(7);
    setInterval(() => { runDecaySweep(); cleanupOldMissionTasks(7); }, 24 * 60 * 60 * 1000);

    startDailyMemoryScheduler();

    // Memory consolidation: find patterns across recent memories every 30 minutes
    // Consolidation is fully local — no external API needed
    if (ALLOWED_CHAT_ID) {
      // Delay first consolidation 2 minutes after startup to let things settle
      setTimeout(() => {
        void runConsolidation(ALLOWED_CHAT_ID).catch((err) =>
          logger.error({ err }, 'Initial consolidation failed'),
        );
      }, 2 * 60 * 1000);
      setInterval(() => {
        void runConsolidation(ALLOWED_CHAT_ID).catch((err) =>
          logger.error({ err }, 'Periodic consolidation failed'),
        );
      }, 30 * 60 * 1000);
      logger.info('Memory consolidation enabled (every 30 min)');
    }
  } else {
    logger.info({ agentId: AGENT_ID }, 'Skipping decay/consolidation (main process owns these)');
  }

  cleanupOldUploads();

  // Create bot only if token is available (skip for dashboard-only mode)
  const bot = activeBotToken ? createBot() : null;

  // Dashboard only runs in the main bot process
  if (AGENT_ID === 'main') {
    startDashboard(bot?.api);
  }

  if (ALLOWED_CHAT_ID) {
    initScheduler(
      async (text) => {
        // Split long messages to respect Telegram's 4096 char limit.
        // The scheduler's splitMessage handles chunking, but the sender
        // callback is also called directly for status messages which may exceed the limit.
        const { splitMessage } = await import('./bot.js');
        for (const chunk of splitMessage(text)) {
          await bot?.api.sendMessage(ALLOWED_CHAT_ID, chunk, { parse_mode: 'HTML' }).catch((err) =>
            logger.error({ err }, 'Scheduler failed to send message'),
          );
        }
      },
      AGENT_ID,
    );
  } else {
    logger.warn('ALLOWED_CHAT_ID not set — scheduler disabled (no destination for results)');
  }

  // Sync default + user-configured automations into the scheduled_tasks DB.
  // Safe to call every startup — never creates duplicates.
  syncAutomations(AGENT_ID);

  const shutdown = async () => {
    logger.info('Shutting down...');
    setTelegramConnected(false);
    releaseLock();
    if (bot) await bot.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection');
  });

  logger.info({ agentId: AGENT_ID }, 'Starting WildClaude...');

  if (!activeBotToken) {
    // Dashboard-only: keep process alive without Telegram polling
    console.log('  Dashboard running at http://localhost:' + (process.env.DASHBOARD_PORT || '3141'));
    console.log('  Dashboard is accessible from your local network.');
    console.log('  Use Tailscale (https://tailscale.com) to access from anywhere.\n');
    console.log('  Press Ctrl+C to stop.\n');
    // Keep alive
    await new Promise(() => {});
  }

  await bot!.start({
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
    onStart: (botInfo) => {
      setTelegramConnected(true);
      setBotInfo(botInfo.username ?? '', botInfo.first_name ?? 'WildClaude');
      logger.info({ username: botInfo.username }, 'WildClaude is running');
      if (AGENT_ID === 'main') {
        console.log(`\n  WildClaude online: @${botInfo.username}`);
        if (!ALLOWED_CHAT_ID) {
          console.log(`  Send /chatid to get your chat ID for ALLOWED_CHAT_ID`);
        }
        console.log();
      } else {
        console.log(`\n  WildClaude agent [${AGENT_ID}] online: @${botInfo.username}\n`);
      }
    },
  });
}

main().catch((err: unknown) => {
  logger.error({ err }, 'Fatal error');
  releaseLock();
  process.exit(1);
});
