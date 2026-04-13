# WildClaude Command Reference

## Core Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message (triggers Telegram onboarding if profile not set) |
| `/help` | List all commands and skills |
| `/chatid` | Get your Telegram chat ID |
| `/newchat` | Clear session, save handoff, start fresh |
| `/respin` | After `/newchat`, inject the previous session's conversation as read-only context |
| `/stop` | Cancel the currently running agent query |
| `/status` | Health check: bot, services, memory count |

### Session continuity flow

```
/newchat → handoff saved → new session starts
/respin  → handoff injected as context prefix → pick up naturally
```

Use this pair when your context window fills up or you want a clean slate while keeping context.

## Model Control

| Command | Description |
|---------|-------------|
| `/model` | Show current model |
| `/model opus` | Force Opus for this chat |
| `/model sonnet` | Force Sonnet for this chat |
| `/model haiku` | Force Haiku for this chat |

Without a manual override, the router classifies each message:
- **SIMPLE** (greetings, status, yes/no) → Haiku 4.5
- **MEDIUM** (code tasks, standard questions) → Sonnet 4.6
- **COMPLEX** (architecture, planning, creative) → Opus 4.6

If `ANTHROPIC_API_KEY` is set, Haiku is called for classification (~$0.001, ~200ms). Without it, pattern matching is used (works with subscription via Claude CLI).

## Personality

| Command | Description |
|---------|-------------|
| `/personality` | Show current personality settings (tone, humor, emoji, language, etc.) |
| `/personality <preset>` | Switch to a preset: `default`, `professional`, `casual`, `coach`, `debug`, `creative` |

The personality system controls how the assistant communicates. Settings include: tone, response length, humor level (0–10), emoji usage, language, pushback style, and a custom system prompt suffix.

Presets are built-in starting points — you can fine-tune any setting from the dashboard (Settings > Personality). Clicking a preset in the dashboard immediately applies it and clears the active session; the new personality is injected on the next message you send. No restart needed.

User-defined presets are saved to `~/.wild-claude-pi/personalities/` and persist across updates.

## Secrets Management

| Command | Description |
|---------|-------------|
| `/secrets` | Show status of all secrets (set / missing / optional upgrades) |
| `/set_secret <KEY>` | Set a secret — bot prompts for value, stores encrypted, deletes your message |
| `/delete_secret <KEY>` | Remove a secret from the encrypted store |

Secrets are stored AES-256-GCM encrypted in `~/.wild-claude-pi/secrets.enc.json`. Resolution order: encrypted store → `.env` → environment variable.

Known secrets: `TELEGRAM_BOT_TOKEN`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `GROQ_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `DASHBOARD_TOKEN`, `DB_ENCRYPTION_KEY`, `SLACK_USER_TOKEN`.

## MCP Servers

| Command | Description |
|---------|-------------|
| `/mcp` | List installed and available MCP servers |
| `/mcp_install <name>` | Install an MCP server from the registry (31 available) |
| `/mcp_remove <name>` | Remove an installed MCP server |

When installing, any missing API keys are shown with links to obtain them. Set them with `/set_secret <KEY>` then restart. Config is written to `.mcp.json` in the project root.

Available MCP categories: Productivity (Notion, Google Drive, Calendar, Gmail, Todoist), Dev (GitHub, GitLab, Linear, Jira, Sentry), Communication (Slack, Discord, Telegram), Search (Brave, Exa, Tavily, Fetch, Puppeteer), Data (Filesystem, SQLite, PostgreSQL, Supabase, Redis), Cloud (AWS, Cloudflare, Vercel), AI/Analytics (OpenAI, Stripe, Google Analytics), Utilities (Memory, Sequential Thinking).

## Import

| Command | Description |
|---------|-------------|
| `/import` or `/import scan` | Scan for importable data sources |
| `/import all` | Import everything found automatically |
| `/import <number>` | Import a specific source by number from the scan list |
| `/import file <path>` | Import a specific file (`.db`, `.json`, `.md`, or directory) |

Supported sources: OpenClaw/NanoClaw, ClaudeClaw, claude-mem, bOS, Claude Code (`~/.claude/`), and any markdown/JSON/SQLite file.

## Agent Delegation

| Command | Description |
|---------|-------------|
| `/agents` | List all 17 agents grouped by lane |
| `/delegate <agent> <prompt>` | Explicitly route to an agent |
| `@architect <prompt>` | Delegate to architect (shorthand) |
| `@coder <prompt>` | Delegate to coder |
| `@debugger <prompt>` | Delegate to debugger |
| ... | Any agent ID works with @ prefix |

### Available Agents

**Build Lane:** `@architect` (Opus), `@coder` (Sonnet), `@debugger` (Sonnet), `@tester` (Sonnet)

**Review Lane:** `@code-reviewer` (Opus), `@security-reviewer` (Sonnet)

**Domain Lane:** `@researcher` (Sonnet), `@writer` (Sonnet), `@data-analyst` (Sonnet)

**Coordination Lane:** `@orchestrator` (Opus), `@critic` (Opus), `@dashboard-builder` (Sonnet)

**Life Lane:** `@coach` (Opus), `@organizer` (Sonnet), `@finance` (Sonnet), `@health` (Haiku), `@learner` (Sonnet)

## Life Management

| Command | Description |
|---------|-------------|
| `/morning` | Daily briefing: goals status, priorities, energy check |
| `/evening` | Evening review: accomplishments, energy, reflection (multi-step, 3 questions) |
| `/goals` | List current goals |
| `/goals add <description>` | Add a new goal |
| `/goals done <number>` | Mark goal as complete |
| `/focus` | Start a 25-min focus session (pulls first next-action from goals) |
| `/focus <task>` | Focus on a specific task |
| `/journal` | Quick reflection: one rotating question, captures answer to log |
| `/review` | Weekly review: goals scorecard, wins, lessons, next-week priorities (LLM-generated) |

### Life Context Files

Your life data lives in `~/.wild-claude-pi/life/` as plain markdown:

```
~/.wild-claude-pi/life/
  me/_kernel/key.md          # Identity, preferences, values
  me/_kernel/log.md          # Decision/activity log (prepend-only)
  goals/_kernel/key.md       # Active goals with metrics
  health/_kernel/key.md      # Health profile, routines
  finance/_kernel/key.md     # Budget, accounts, targets
  learning/_kernel/key.md    # Learning goals, courses
```

Log entries from `/evening` and `/journal` are prepended to `life/me/_kernel/log.md` (newest first).

## Memory

| Command | Description |
|---------|-------------|
| `/memory <query>` | Search memories by keyword (FTS5) |
| `/remember <text>` | Manually save a high-importance memory (importance 0.9, tagged 'manual') |
| `/reflect` | List 10 recent memories with importance scores, option to delete by number |
| `/pin <id>` | Pin a memory (prevent decay) |
| `/unpin <id>` | Unpin a memory |
| `/forget` | Delete all memories for this chat |

### How Memory Works

1. **Auto-extraction** — After every response, a local importance scorer analyzes the conversation and extracts lasting knowledge (preferences, decisions, relationships). No external API required. Duplicate detection (80%+ word overlap) prevents storing the same fact multiple times.
2. **File persistence** — Each memory is written to `~/.wild-claude-pi/memories/YYYY-MM/YYYY-MM-DD-<topic>.md` with full raw text (in collapsible `<details>` block) for complete backup and git-trackability.
3. **Weighted decay** — Unused memories lose salience over time. Rate depends on importance and recency of access. Pinned memories are exempt. Decayed memories are **soft-deleted** (recoverable for 30 days), then **archived permanently** before hard deletion. No information is ever permanently lost.
4. **Weighted context injection** — Before each message, relevant memories are retrieved and ranked by `importance × salience`. FTS5 keyword search is used for memories and for consolidation insights. Agent-specific filtering prevents one agent's memories from polluting another's context.
5. **Zero-loss architecture** — Daily SQLite backup (`~/.wild-claude-pi/store/backups/`), integrity check on every decay sweep, conversation log archived before pruning, `/reflect` delete is soft-delete (recoverable). Messaging data retained 30 days (up from 3).

## Mission Control (Background Tasks)

| Command | Description |
|---------|-------------|
| `/mission <prompt>` | Queue a background task (auto-assigns agent via keyword matching) |
| `/mission @agent <prompt>` | Queue a task assigned to a specific agent |
| `/mission templates` | List built-in mission templates |
| `/mission <template>` | Run a predefined template (e.g. `deploy-check`, `qa-run`, `dependency-audit`, `weekly-review`) |
| `/missions` | View running, queued, and recent missions |
| `/missions cancel <id>` | Cancel a queued or running mission |

**Auto-queue shorthand:** Prefix any message with `bg:`, `queue:`, or `background:` to automatically create a mission instead of processing inline.

```
bg: audit all npm dependencies for vulnerabilities
queue: @researcher find alternatives to our current auth library
```

**Built-in templates:**

| Template | Agent | Description |
|----------|-------|-------------|
| `deploy-check` | coder | Check deployment status and recent logs |
| `qa-run` | tester | Look for TS errors, bugs, failing tests |
| `dependency-audit` | security-reviewer | Outdated/vulnerable/unused packages |
| `weekly-review` | orchestrator | Summarize git history, suggest next priorities |

**Mission chaining:** Missions support a `next_mission_id` field — when one completes, the next activates automatically. Use the dashboard API to create chains.

Ralph runs are automatically tracked as missions (priority 8, agent `orchestrator`) and appear in the mission queue.

## Ralph (Autonomous Development)

| Command | Description |
|---------|-------------|
| `/ralph <goal>` | Start autonomous dev loop with a goal |
| `/ralph status` | Check current Ralph status |
| `/ralph stop` | Stop the Ralph loop |

Ralph decomposes your goal into a task checklist, iterates through them autonomously, and reports progress via Telegram. Each Ralph run is automatically registered in Mission Control. Safety features:
- Circuit breaker: stops after 3 iterations with no progress
- Rate limiting: configurable max calls per hour (default 30/hour)
- Session continuity: maintains context across iterations
- Max 20 iterations per run

## Evolution (Self-Modification)

| Command | Description |
|---------|-------------|
| `/create_skill <name> <description>` | Create a new skill in `~/.wild-claude-pi/skills/` |
| `/create_agent <id> <lane> <description>` | Create a new agent in `~/.wild-claude-pi/agents/` |
| `/evolution` | View evolution log (last 10 mutations) |
| `/learnlesson` | Capture a lesson or error immediately after it occurs — saved permanently |
| `/upgrade` | Self-update WildClaude (git pull + npm install + build + restart, runs in background) |
| `/upgrade_log` | Show last 30 lines of the upgrade log |

Valid lanes for `/create_agent`: `build`, `review`, `domain`, `coordination`, `life`.

All mutations are git-tracked. Created skills auto-activate when their description matches your messages. User agents override project defaults.

### Activity Log

WildClaude keeps an append-only cross-session log at `~/.wild-claude-pi/log.md`. Every significant action (coding tasks, deploys, Ralph runs, upgrades) is recorded:

```
[YYYY-MM-DD HH:MM] [SESSION|CRON|AGENT] [project] action
```

The log is read at session start to give continuity across sessions. It is shared between all agents and the cron self-review system.

## Scheduling

Scheduled tasks are managed from the dashboard (Workflow Engine module). There is no `/schedule` Telegram command -- use the dashboard UI to create, pause, resume, or delete tasks.

### Pre-configured Automations

| Schedule | Task |
|----------|------|
| 08:00 daily | Morning briefing |
| 20:00 daily | Evening review prompt |
| Sunday 18:00 | Weekly review |

## Voice

| Command | Description |
|---------|-------------|
| `/voice` | Toggle voice responses on/off |
| Send voice note | Automatically transcribed and processed |

Requires: `GROQ_API_KEY` (STT via Whisper) and `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID` (TTS). Set via `/set_secret` or `.env`.

## Dashboard

| Command | Description |
|---------|-------------|
| `/dashboard` | Get web dashboard link |

Dashboard URL: `http://<host>:3141`

The page loads a login screen. No token needed in the URL. Set `DASHBOARD_TOKEN` to enable auth.

### Dashboard Modules

1. **Command Center** — Chat interface with model indicators
2. **Memory Palace** — Search, browse, pin/unpin memories
3. **Mission Control** — Goals, projects, task management
4. **Agent Hub** — Agent status, lanes, model badges
5. **Workflow Engine** — Scheduled tasks, cron management
6. **Skills & MCP** — MCP server management, skill browser
7. **System Vitals** — CPU, RAM, disk, API costs
8. **Daily Journal** — Auto-generated entries from reviews
9. **External Dashboards** — Vercel, GitHub, Neon, Supabase, Stripe, Cloudflare, Sentry status panels
10. **Live Activity** — Real-time event stream
11. **Settings** — Configuration, status, links; first card is **Personality** (editor, preview, presets)

## WhatsApp & Slack

| Command | Description |
|---------|-------------|
| `/wa` | WhatsApp control (list chats, read, send) |
| `/slack` | Slack control (list conversations, read, send) |

Requires: `WHATSAPP_ENABLED=true` or `SLACK_USER_TOKEN` in `.env` (or via `/set_secret`).
