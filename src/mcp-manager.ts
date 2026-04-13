/**
 * MCP Server Manager for WildClaude.
 *
 * Handles automatic installation, configuration, and secret registration
 * for MCP servers. When a user says "install Notion MCP", this module:
 * 1. Writes the .mcp.json config
 * 2. Auto-registers any needed secrets (e.g., NOTION_API_KEY)
 * 3. Prompts the user via Telegram for missing keys
 *
 * Known MCP servers are in the registry. Unknown ones can be added manually.
 */

import fs from 'fs';
import path from 'path';
import { Bot, Context } from 'grammy';

import { PROJECT_ROOT, ALLOWED_CHAT_ID } from './config.js';
import { registerSecret, getSecret, setSecret } from './secrets.js';
import { logger } from './logger.js';

// ── MCP Registry ─────────────────────────────────────────────────────
// Known MCP servers with their npm packages, config, and required secrets.

interface McpServerDef {
  id: string;
  name: string;
  description: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  secrets: Array<{
    key: string;
    name: string;
    description: string;
    obtainUrl?: string;
    pattern?: RegExp;
    /** Template for the env value — use ${KEY} for secret substitution */
    envTemplate?: string;
  }>;
}

const MCP_REGISTRY: McpServerDef[] = [
  // ── Productivity & Docs ────────────────────────────────────────────
  {
    id: 'notion',
    name: 'Notion',
    description: 'Read/write Notion pages, databases, and blocks',
    command: 'npx',
    args: ['-y', '@notionhq/notion-mcp-server'],
    env: { OPENAPI_MCP_HEADERS: '{"Authorization": "Bearer ${NOTION_API_KEY}", "Notion-Version": "2022-06-28"}' },
    secrets: [{ key: 'NOTION_API_KEY', name: 'Notion API Key', description: 'Integration token from notion.so/my-integrations', obtainUrl: 'https://www.notion.so/my-integrations', pattern: /^(secret_|ntn_)/ }],
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    description: 'Search and read files from Google Drive',
    command: 'npx',
    args: ['-y', '@anthropics/mcp-server-gdrive'],
    secrets: [{ key: 'GOOGLE_DRIVE_CREDENTIALS', name: 'Google Drive Credentials JSON', description: 'Service account JSON from Google Cloud Console', obtainUrl: 'https://console.cloud.google.com/iam-admin/serviceaccounts' }],
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    description: 'Read/create calendar events, check availability',
    command: 'npx',
    args: ['-y', '@anthropics/mcp-server-google-calendar'],
    env: { GOOGLE_CALENDAR_CREDENTIALS: '${GOOGLE_CALENDAR_CREDENTIALS}' },
    secrets: [{ key: 'GOOGLE_CALENDAR_CREDENTIALS', name: 'Google Calendar Credentials', description: 'OAuth credentials JSON for Google Calendar API', obtainUrl: 'https://console.cloud.google.com/apis/credentials' }],
  },
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Read, send, and search emails via Gmail API',
    command: 'npx',
    args: ['-y', '@anthropics/mcp-server-gmail'],
    env: { GMAIL_CREDENTIALS: '${GMAIL_CREDENTIALS}' },
    secrets: [{ key: 'GMAIL_CREDENTIALS', name: 'Gmail Credentials', description: 'OAuth credentials JSON for Gmail API', obtainUrl: 'https://console.cloud.google.com/apis/credentials' }],
  },
  {
    id: 'todoist',
    name: 'Todoist',
    description: 'Manage tasks, projects, and labels in Todoist',
    command: 'npx',
    args: ['-y', '@anthropics/mcp-server-todoist'],
    env: { TODOIST_API_TOKEN: '${TODOIST_API_TOKEN}' },
    secrets: [{ key: 'TODOIST_API_TOKEN', name: 'Todoist API Token', description: 'API token from todoist.com/app/settings/integrations/developer', obtainUrl: 'https://todoist.com/app/settings/integrations/developer' }],
  },

  // ── Dev Tools ──────────────────────────────────────────────────────
  {
    id: 'github',
    name: 'GitHub',
    description: 'Manage repos, issues, PRs, and code on GitHub',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: '${GITHUB_TOKEN}' },
    secrets: [{ key: 'GITHUB_TOKEN', name: 'GitHub PAT', description: 'Personal access token with repo scope', obtainUrl: 'https://github.com/settings/tokens', pattern: /^(ghp_|github_pat_)/ }],
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    description: 'Manage GitLab repos, issues, merge requests',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-gitlab'],
    env: { GITLAB_PERSONAL_ACCESS_TOKEN: '${GITLAB_TOKEN}', GITLAB_API_URL: 'https://gitlab.com/api/v4' },
    secrets: [{ key: 'GITLAB_TOKEN', name: 'GitLab PAT', description: 'Personal access token from gitlab.com/-/user_settings/personal_access_tokens', obtainUrl: 'https://gitlab.com/-/user_settings/personal_access_tokens', pattern: /^glpat-/ }],
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Manage Linear issues, projects, and cycles',
    command: 'npx',
    args: ['-y', '@anthropics/mcp-server-linear'],
    env: { LINEAR_API_KEY: '${LINEAR_API_KEY}' },
    secrets: [{ key: 'LINEAR_API_KEY', name: 'Linear API Key', description: 'API key from linear.app/settings/api', obtainUrl: 'https://linear.app/settings/api', pattern: /^lin_api_/ }],
  },
  {
    id: 'jira',
    name: 'Jira',
    description: 'Manage Jira issues, sprints, and boards',
    command: 'npx',
    args: ['-y', '@anthropics/mcp-server-jira'],
    env: { JIRA_URL: '${JIRA_URL}', JIRA_EMAIL: '${JIRA_EMAIL}', JIRA_API_TOKEN: '${JIRA_API_TOKEN}' },
    secrets: [
      { key: 'JIRA_URL', name: 'Jira URL', description: 'Your Jira instance URL (e.g., https://yourorg.atlassian.net)' },
      { key: 'JIRA_EMAIL', name: 'Jira Email', description: 'Email associated with your Jira account' },
      { key: 'JIRA_API_TOKEN', name: 'Jira API Token', description: 'API token from id.atlassian.com/manage-profile/security/api-tokens', obtainUrl: 'https://id.atlassian.com/manage-profile/security/api-tokens' },
    ],
  },
  {
    id: 'sentry',
    name: 'Sentry',
    description: 'Query error tracking data, issues, and events from Sentry',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sentry'],
    env: { SENTRY_AUTH_TOKEN: '${SENTRY_AUTH_TOKEN}' },
    secrets: [{ key: 'SENTRY_AUTH_TOKEN', name: 'Sentry Auth Token', description: 'Auth token from sentry.io/settings/account/api/auth-tokens', obtainUrl: 'https://sentry.io/settings/account/api/auth-tokens/' }],
  },

  // ── Communication ──────────────────────────────────────────────────
  {
    id: 'slack',
    name: 'Slack',
    description: 'Read/send Slack messages, manage channels',
    command: 'npx',
    args: ['-y', '@anthropics/mcp-server-slack'],
    env: { SLACK_BOT_TOKEN: '${SLACK_BOT_TOKEN}' },
    secrets: [{ key: 'SLACK_BOT_TOKEN', name: 'Slack Bot Token', description: 'Bot token from api.slack.com/apps', obtainUrl: 'https://api.slack.com/apps', pattern: /^xoxb-/ }],
  },
  {
    id: 'discord',
    name: 'Discord',
    description: 'Read/send Discord messages, manage servers',
    command: 'npx',
    args: ['-y', '@anthropics/mcp-server-discord'],
    env: { DISCORD_BOT_TOKEN: '${DISCORD_BOT_TOKEN}' },
    secrets: [{ key: 'DISCORD_BOT_TOKEN', name: 'Discord Bot Token', description: 'Bot token from discord.com/developers/applications', obtainUrl: 'https://discord.com/developers/applications' }],
  },
  {
    id: 'telegram-mcp',
    name: 'Telegram MCP',
    description: 'Send Telegram messages and manage chats via MCP',
    command: 'npx',
    args: ['-y', '@anthropics/mcp-server-telegram'],
    env: { TELEGRAM_MCP_TOKEN: '${TELEGRAM_MCP_TOKEN}' },
    secrets: [{ key: 'TELEGRAM_MCP_TOKEN', name: 'Telegram Bot Token (MCP)', description: 'Separate bot token for MCP Telegram access (can be same as main bot)', obtainUrl: 'https://t.me/BotFather' }],
  },

  // ── Search & Web ───────────────────────────────────────────────────
  {
    id: 'brave-search',
    name: 'Brave Search',
    description: 'Web search via Brave Search API',
    command: 'npx',
    args: ['-y', '@anthropics/mcp-server-brave-search'],
    env: { BRAVE_API_KEY: '${BRAVE_API_KEY}' },
    secrets: [{ key: 'BRAVE_API_KEY', name: 'Brave Search API Key', description: 'API key from brave.com/search/api', obtainUrl: 'https://brave.com/search/api/' }],
  },
  {
    id: 'exa',
    name: 'Exa',
    description: 'Neural search engine — semantic web search with content extraction',
    command: 'npx',
    args: ['-y', '@anthropics/mcp-server-exa'],
    env: { EXA_API_KEY: '${EXA_API_KEY}' },
    secrets: [{ key: 'EXA_API_KEY', name: 'Exa API Key', description: 'API key from exa.ai', obtainUrl: 'https://dashboard.exa.ai/api-keys' }],
  },
  {
    id: 'tavily',
    name: 'Tavily',
    description: 'AI-optimized search API for LLMs',
    command: 'npx',
    args: ['-y', '@anthropics/mcp-server-tavily'],
    env: { TAVILY_API_KEY: '${TAVILY_API_KEY}' },
    secrets: [{ key: 'TAVILY_API_KEY', name: 'Tavily API Key', description: 'API key from tavily.com', obtainUrl: 'https://app.tavily.com/home' }],
  },
  {
    id: 'fetch',
    name: 'Fetch',
    description: 'Fetch and extract content from any URL (web scraping)',
    command: 'npx',
    args: ['-y', '@anthropics/mcp-server-fetch'],
    secrets: [],
  },
  {
    id: 'puppeteer',
    name: 'Puppeteer',
    description: 'Browser automation — navigate, screenshot, click, fill forms',
    command: 'npx',
    args: ['-y', '@anthropics/mcp-server-puppeteer'],
    secrets: [],
  },

  // ── Data & Storage ─────────────────────────────────────────────────
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Read/write files in specified directories',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/home'],
    secrets: [],
  },
  {
    id: 'sqlite',
    name: 'SQLite',
    description: 'Query and manage SQLite databases',
    command: 'npx',
    args: ['-y', '@anthropics/mcp-server-sqlite'],
    secrets: [],
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    description: 'Query and manage PostgreSQL databases',
    command: 'npx',
    args: ['-y', '@anthropics/mcp-server-postgres'],
    env: { POSTGRES_CONNECTION_STRING: '${POSTGRES_URL}' },
    secrets: [{ key: 'POSTGRES_URL', name: 'PostgreSQL Connection URL', description: 'Connection string (e.g., postgresql://user:pass@host:5432/db)' }],
  },
  {
    id: 'supabase',
    name: 'Supabase',
    description: 'Manage Supabase projects, databases, and edge functions',
    command: 'npx',
    args: ['-y', '@supabase/mcp-server-supabase'],
    env: { SUPABASE_ACCESS_TOKEN: '${SUPABASE_ACCESS_TOKEN}' },
    secrets: [{ key: 'SUPABASE_ACCESS_TOKEN', name: 'Supabase Access Token', description: 'Access token from supabase.com/dashboard/account/tokens', obtainUrl: 'https://supabase.com/dashboard/account/tokens' }],
  },
  {
    id: 'redis',
    name: 'Redis',
    description: 'Read/write Redis keys, run commands',
    command: 'npx',
    args: ['-y', '@anthropics/mcp-server-redis'],
    env: { REDIS_URL: '${REDIS_URL}' },
    secrets: [{ key: 'REDIS_URL', name: 'Redis URL', description: 'Connection URL (e.g., redis://localhost:6379)' }],
  },

  // ── Cloud & Infra ──────────────────────────────────────────────────
  {
    id: 'aws',
    name: 'AWS',
    description: 'Manage AWS resources — S3, Lambda, EC2, CloudWatch',
    command: 'npx',
    args: ['-y', '@anthropics/mcp-server-aws'],
    env: { AWS_ACCESS_KEY_ID: '${AWS_ACCESS_KEY_ID}', AWS_SECRET_ACCESS_KEY: '${AWS_SECRET_ACCESS_KEY}', AWS_REGION: '${AWS_REGION}' },
    secrets: [
      { key: 'AWS_ACCESS_KEY_ID', name: 'AWS Access Key', description: 'IAM access key from AWS Console', obtainUrl: 'https://console.aws.amazon.com/iam/' },
      { key: 'AWS_SECRET_ACCESS_KEY', name: 'AWS Secret Key', description: 'IAM secret key (shown once at creation)' },
      { key: 'AWS_REGION', name: 'AWS Region', description: 'Default region (e.g., us-east-1, eu-west-1)' },
    ],
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    description: 'Manage Cloudflare Workers, DNS, R2 storage',
    command: 'npx',
    args: ['-y', '@anthropics/mcp-server-cloudflare'],
    env: { CLOUDFLARE_API_TOKEN: '${CLOUDFLARE_API_TOKEN}' },
    secrets: [{ key: 'CLOUDFLARE_API_TOKEN', name: 'Cloudflare API Token', description: 'API token from dash.cloudflare.com/profile/api-tokens', obtainUrl: 'https://dash.cloudflare.com/profile/api-tokens' }],
  },
  {
    id: 'vercel',
    name: 'Vercel',
    description: 'Manage Vercel deployments, projects, and domains',
    command: 'npx',
    args: ['-y', '@anthropics/mcp-server-vercel'],
    env: { VERCEL_TOKEN: '${VERCEL_TOKEN}' },
    secrets: [{ key: 'VERCEL_TOKEN', name: 'Vercel Token', description: 'Token from vercel.com/account/tokens', obtainUrl: 'https://vercel.com/account/tokens' }],
  },

  // ── AI & Analytics ─────────────────────────────────────────────────
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'Use OpenAI models (GPT, DALL-E, Whisper) via MCP',
    command: 'npx',
    args: ['-y', '@anthropics/mcp-server-openai'],
    env: { OPENAI_API_KEY: '${OPENAI_API_KEY}' },
    secrets: [{ key: 'OPENAI_API_KEY', name: 'OpenAI API Key', description: 'API key from platform.openai.com/api-keys', obtainUrl: 'https://platform.openai.com/api-keys', pattern: /^sk-/ }],
  },
  {
    id: 'stripe',
    name: 'Stripe',
    description: 'Manage payments, subscriptions, and customers in Stripe',
    command: 'npx',
    args: ['-y', '@anthropics/mcp-server-stripe'],
    env: { STRIPE_SECRET_KEY: '${STRIPE_SECRET_KEY}' },
    secrets: [{ key: 'STRIPE_SECRET_KEY', name: 'Stripe Secret Key', description: 'Secret key from dashboard.stripe.com/apikeys', obtainUrl: 'https://dashboard.stripe.com/apikeys', pattern: /^sk_(test_|live_)/ }],
  },
  {
    id: 'google-analytics',
    name: 'Google Analytics',
    description: 'Query Google Analytics data and reports',
    command: 'npx',
    args: ['-y', '@anthropics/mcp-server-google-analytics'],
    env: { GA_CREDENTIALS: '${GA_CREDENTIALS}', GA_PROPERTY_ID: '${GA_PROPERTY_ID}' },
    secrets: [
      { key: 'GA_CREDENTIALS', name: 'GA Credentials JSON', description: 'Service account JSON for Google Analytics', obtainUrl: 'https://console.cloud.google.com/apis/credentials' },
      { key: 'GA_PROPERTY_ID', name: 'GA Property ID', description: 'Analytics property ID (e.g., 123456789)' },
    ],
  },

  // ── Utilities ──────────────────────────────────────────────────────
  {
    id: 'memory',
    name: 'Memory',
    description: 'Persistent key-value memory for Claude (simple knowledge base)',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    secrets: [],
  },
  {
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    description: 'Step-by-step reasoning with branching and revision',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    secrets: [],
  },
];

// ── .mcp.json Management ─────────────────────────────────────────────

const MCP_JSON_PATH = path.join(PROJECT_ROOT, '.mcp.json');

interface McpConfig {
  mcpServers: Record<string, {
    command: string;
    args: string[];
    env?: Record<string, string>;
  }>;
}

function loadMcpConfig(): McpConfig {
  try {
    if (fs.existsSync(MCP_JSON_PATH)) {
      return JSON.parse(fs.readFileSync(MCP_JSON_PATH, 'utf-8'));
    }
  } catch { /* corrupt file */ }
  return { mcpServers: {} };
}

function saveMcpConfig(config: McpConfig): void {
  fs.writeFileSync(MCP_JSON_PATH, JSON.stringify(config, null, 2));
}

/**
 * Install an MCP server by ID.
 * Returns list of missing secrets that need to be configured.
 */
export function installMcp(id: string): { installed: boolean; name: string; missingSecrets: string[] } {
  const def = MCP_REGISTRY.find(m => m.id === id);
  if (!def) {
    return { installed: false, name: id, missingSecrets: [] };
  }

  // Register secrets
  for (const secret of def.secrets) {
    registerSecret({
      key: secret.key,
      name: secret.name,
      description: secret.description,
      feature: `mcp-${def.id}`,
      required: false,
      obtainUrl: secret.obtainUrl,
      pattern: secret.pattern,
    });
  }

  // Build env with secret substitution
  const env: Record<string, string> = {};
  const missingSecrets: string[] = [];

  if (def.env) {
    for (const [envKey, template] of Object.entries(def.env)) {
      const match = template.match(/\$\{(\w+)\}/);
      if (match) {
        const secretKey = match[1]!;
        const secretValue = getSecret(secretKey);
        if (secretValue) {
          env[envKey] = template.replace(`\${${secretKey}}`, secretValue);
        } else {
          missingSecrets.push(secretKey);
          env[envKey] = template; // Keep template, will be resolved later
        }
      } else {
        env[envKey] = template;
      }
    }
  }

  // Write to .mcp.json
  const config = loadMcpConfig();
  config.mcpServers[def.id] = {
    command: def.command,
    args: def.args,
    ...(Object.keys(env).length > 0 ? { env } : {}),
  };
  saveMcpConfig(config);

  logger.info({ id: def.id, missingSecrets }, 'MCP server installed');
  return { installed: true, name: def.name, missingSecrets };
}

/**
 * Uninstall an MCP server by ID.
 */
export function uninstallMcp(id: string): boolean {
  const config = loadMcpConfig();
  if (config.mcpServers[id]) {
    delete config.mcpServers[id];
    saveMcpConfig(config);
    return true;
  }
  return false;
}

/**
 * List installed MCP servers.
 */
export function listInstalledMcps(): Array<{ id: string; command: string }> {
  const config = loadMcpConfig();
  return Object.entries(config.mcpServers).map(([id, cfg]) => ({
    id,
    command: cfg.args?.length ? `${cfg.command} ${cfg.args.join(' ')}` : cfg.command,
  }));
}

/**
 * List available (not yet installed) MCP servers from the registry.
 */
export function listAvailableMcps(): McpServerDef[] {
  const config = loadMcpConfig();
  return MCP_REGISTRY.filter(m => !config.mcpServers[m.id]);
}

/**
 * Find MCP server by name/keyword (fuzzy match for Telegram commands).
 */
export function findMcp(query: string): McpServerDef | undefined {
  const q = query.toLowerCase().trim();
  return MCP_REGISTRY.find(m =>
    m.id === q ||
    m.name.toLowerCase() === q ||
    m.name.toLowerCase().includes(q) ||
    m.description.toLowerCase().includes(q)
  );
}

// ── Telegram commands ────────────────────────────────────────────────

export function registerMcpCommands(bot: Bot<Context>): void {

  // /mcp — list installed + available MCP servers
  bot.command('mcp', async (ctx) => {
    const installed = listInstalledMcps();
    const available = listAvailableMcps();

    let msg = 'MCP Servers\n\n';

    if (installed.length > 0) {
      msg += 'Installed:\n';
      msg += installed.map(m => `  ✅ ${m.id}`).join('\n');
      msg += '\n\n';
    }

    if (available.length > 0) {
      msg += 'Available:\n';
      msg += available.map(m => `  ⬜ ${m.id} — ${m.description}`).join('\n');
      msg += '\n\n';
    }

    msg += 'Install: /mcp_install <name>\nRemove: /mcp_remove <name>';
    await ctx.reply(msg);
  });

  // /mcp_install <name> — install an MCP server
  bot.command('mcp_install', async (ctx) => {
    const query = ctx.match?.trim();
    if (!query) {
      const available = listAvailableMcps();
      await ctx.reply(
        'Usage: /mcp_install <name>\n\nAvailable:\n' +
        available.map(m => `- ${m.id}: ${m.description}`).join('\n'),
      );
      return;
    }

    const def = findMcp(query);
    if (!def) {
      await ctx.reply(`Unknown MCP server: "${query}". Use /mcp to see available servers.`);
      return;
    }

    const result = installMcp(def.id);

    if (!result.installed) {
      await ctx.reply(`Failed to install ${query}.`);
      return;
    }

    let msg = `✅ ${result.name} MCP installed.\n\n`;

    if (result.missingSecrets.length > 0) {
      msg += 'Needs API keys:\n';
      for (const key of result.missingSecrets) {
        const secretDef = def.secrets.find(s => s.key === key);
        msg += `\n- ${key}: ${secretDef?.description || 'Required'}`;
        if (secretDef?.obtainUrl) {
          msg += `\n  Get it: ${secretDef.obtainUrl}`;
        }
        msg += `\n  Set with: /set_secret ${key}`;
      }
      msg += '\n\nAfter setting the key, MCP tools need a restart to load. Dashboards work immediately.';
    } else {
      msg += 'All keys configured. MCP tools need a restart to load. Dashboards work immediately.';
    }

    await ctx.reply(msg);
  });

  // /mcp_remove <name> — uninstall an MCP server
  bot.command('mcp_remove', async (ctx) => {
    const id = ctx.match?.trim().toLowerCase();
    if (!id) {
      await ctx.reply('Usage: /mcp_remove <name>');
      return;
    }
    if (uninstallMcp(id)) {
      await ctx.reply(`Removed: ${id}. MCP tools need a restart. Dashboards update immediately.`);
    } else {
      await ctx.reply(`${id} is not installed.`);
    }
  });
}
