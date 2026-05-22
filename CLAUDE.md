# WildClaude

> Lightweight Personal AI Operating System. Runs everywhere — PC, cloud server, or Raspberry Pi.
> Primary interface: Telegram. Secondary: Web Dashboard. Tertiary: CLI.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    USER INTERFACES                          │
│  Telegram (primary)  │  Web Dashboard  │  CLI onboarding    │
└──────────┬───────────┴────────┬────────┴───────┬────────────┘
           │                    │                │
┌──────────▼────────────────────▼────────────────▼────────────┐
│                      WILDCLAUDE CORE                         │
│                                                              │
│  ┌──────────────┐  ┌─────────────┐  ┌────────────────────┐ │
│  │ Haiku Router │  │  Agent Hub  │  │   Scheduler        │ │
│  │ (classifier) │  │ (5 lanes,   │  │ (cron + missions)  │ │
│  │              │  │  17 agents) │  │                    │ │
│  └──────┬───────┘  └──────┬──────┘  └────────┬───────────┘ │
│         │                 │                   │              │
│  ┌──────▼─────────────────▼───────────────────▼───────────┐ │
│  │         Claude CLI (claude -p --output-format           │ │
│  │         stream-json) → subscription auth               │ │
│  │  Opus 4.6 (complex) │ Sonnet 4.6 (routine) │ Haiku 4.5│ │
│  │  Falls back to SDK if ANTHROPIC_API_KEY is set         │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─────────────┐  ┌────────────┐  ┌────────────────────┐   │
│  │ Memory      │  │ Ralph Loop │  │ Life Context       │   │
│  │ (local,     │  │ (autonomous│  │ (ALIVE kernels in  │   │
│  │  .md files) │  │  dev loop) │  │ ~/.wild-claude-pi/)│   │
│  └─────────────┘  └────────────┘  └────────────────────┘   │
│                                                              │
│  ┌─────────────┐  ┌────────────┐  ┌────────────────────┐   │
│  │ Secrets     │  │ MCP Manager│  │ Import System      │   │
│  │ (encrypted) │  │ (31 servers│  │ (OpenClaw/claude-  │   │
│  │             │  │  registry) │  │  mem/bOS/Claude    │   │
│  └─────────────┘  └────────────┘  └────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Data Separation

Code and user data live in separate locations. This is critical — never mix them.

| Root | Default path | What lives there |
|------|-------------|-----------------|
| `PROJECT_ROOT` | repo checkout | Source code, agent/skill templates, MCP config (`.mcp.json`) |
| `USER_DATA_DIR` | `~/.wild-claude-pi/` | Life data, memories, custom agents/skills, secrets, SQLite DB (path preserved for backward compat) |

Override user data location with env var: `WILD_DATA_DIR=/custom/path`

```
~/.wild-claude-pi/
├── life/
│   ├── me/_kernel/key.md       # Identity, preferences (written by onboarding)
│   ├── me/_kernel/log.md       # Decision/activity log (prepend-only)
│   ├── goals/_kernel/key.md    # Active goals
│   ├── health/_kernel/key.md   # Health profile
│   ├── finance/_kernel/key.md  # Budget, accounts
│   └── learning/_kernel/key.md # Learning goals
├── memories/                   # Markdown memory files (YYYY-MM/YYYY-MM-DD-topic.md)
├── agents/                     # User-created agents (override project defaults by ID)
├── skills/                     # User-created skills (override project defaults by name)
├── store/                      # SQLite databases (wild-claude.db)
├── secrets.enc.json            # AES-256-GCM encrypted secrets store
├── evolution.log.json          # Self-evolution log
├── personalities/              # User-defined personality presets (JSON)
└── CLAUDE.md                   # User-specific system prompt (overrides project default)
```

## Tech Stack

- **Runtime:** Node.js 20+ / TypeScript
- **Telegram:** Grammy 1.34+
- **Database:** better-sqlite3 (SQLite with WAL mode, FTS5)
- **Web:** Hono (backend) + HTMX + Alpine.js + TailwindCSS (dashboard)
- **AI Models:** claude-opus-4-6 / claude-sonnet-4-6 / claude-haiku-4-5
- **Memory:** Fully local (no external APIs) + .md file persistence
- **Voice:** Groq Whisper (STT) + ElevenLabs (TTS)
- **Deployment:** `wildclaude` CLI + systemd service

## CLI Onboarding

On first run, if `~/.wild-claude-pi/life/me/_kernel/key.md` is missing or has `[FILL IN]` placeholders, an interactive terminal wizard runs before the bot starts:

1. Scans for previous assistant data (OpenClaw, claude-mem, bOS, Claude Code)
2. Offers import with a progress spinner
3. Asks profile questions (name, location, languages, work style, goals)
4. Writes kernel files to `~/.wild-claude-pi/life/`
5. Bot starts normally

Users can skip (`n`/`skip`) and configure later via Telegram `/start` or by editing files directly.

## Multi-Model Routing

Every message passes through a Haiku classifier before dispatching:

| Tier | Model | Use Cases | Cost |
|------|-------|-----------|------|
| SIMPLE | haiku-4-5 | Status, lookups, greetings, yes/no | ~$0.25/MTok |
| MEDIUM | sonnet-4-6 | Code tasks, searches, edits, standard Q&A | ~$3/MTok |
| COMPLEX | opus-4-6 | Architecture, creative, life planning, system design | ~$15/MTok |

Without `ANTHROPIC_API_KEY`, pattern matching is used (works with Claude subscription via CLI). With it, Haiku is called for classification (~$0.001, ~200ms).

**Overrides:** `/model opus` forces a specific model per-chat. Agent configs specify model per-agent.

## Concurrent Message Handling

Three tiers handle messages that arrive while the queue is busy:

- **Tier 1 — Smart routing:** SIMPLE messages are classified and sent directly to a parallel Haiku sidecar, bypassing the queue entirely.
- **Tier 2 — Fast-path sidecar:** A Haiku instance responds instantly while the main Opus/Sonnet session finishes. Controlled by `MAX_SIDECAR_SESSIONS` (default: 1) in `src/config.ts`.
- **Tier 3 — Buffer injection:** When all sidecars are occupied, the message is buffered. When the active task completes, buffered messages are prepended as context to the next query. Nothing is dropped.

Config keys in `src/config.ts`: `BATCH_WINDOW_MS` (flush window, default 200 ms), `MAX_SIDECAR_SESSIONS` (parallel Haiku instances, default 1).

## Secrets Manager

All secrets are stored encrypted in `~/.wild-claude-pi/secrets.enc.json` (AES-256-GCM, file mode 0600).

Resolution order: encrypted store → `.env` → environment variable.

`DB_ENCRYPTION_KEY` is auto-generated on first run if not found.

## Import System

Imports memories from previous assistants automatically during CLI onboarding or via Telegram:

- **OpenClaw / NanoClaw** — SQLite DB (memories, conversations, consolidations)
- **ClaudeClaw** — SQLite DB + markdown files
- **claude-mem** — observations, session summaries (handles 1500+ records)
- **bOS** — state markdown files mapped to ALIVE kernel domains
- **Claude Code** — `~/.claude/` CLAUDE.md + memory files + project memories
- **Generic** — `.md` files/directories, `.json` exports, `.db` SQLite

## Agent System

### 5 Lanes, 17 Agents

```
agents/
├── build/                    # Development
│   ├── architect.md          # (opus) System design, interfaces
│   ├── coder.md              # (sonnet) Implementation, refactoring
│   ├── debugger.md           # (sonnet) Root-cause analysis
│   └── tester.md             # (sonnet) Test writing, verification
├── review/                   # Quality
│   ├── code-reviewer.md      # (opus) Comprehensive code review
│   └── security-reviewer.md  # (sonnet) Vulnerability detection
├── domain/                   # Specialized
│   ├── researcher.md         # (sonnet) Web research, synthesis
│   ├── writer.md             # (sonnet) Documentation, content
│   └── data-analyst.md       # (sonnet) Data exploration
├── coordination/             # Meta
│   ├── orchestrator.md       # (opus) Multi-agent coordination
│   ├── critic.md             # (opus) Gap analysis, challenge
│   └── dashboard-builder.md  # (sonnet) External service dashboards
└── life/                     # Personal OS
    ├── coach.md              # (opus) Goals, decisions, planning
    ├── organizer.md          # (sonnet) Tasks, habits, scheduling
    ├── finance.md            # (sonnet) Budget, expenses, investments
    ├── health.md             # (haiku) Workout/nutrition logging
    └── learner.md            # (sonnet) Learning roadmaps, synthesis
```

User agents in `~/.wild-claude-pi/agents/<lane>/<id>.md` override project defaults by ID.

### Agent Definition Format

```markdown
---
name: agent-id
description: When to use this agent. Activation trigger keywords.
model: claude-sonnet-4-6
lane: build|review|domain|coordination|life
---

# Role
You are a [role] specializing in [domain].

# Success Criteria
- [measurable outcome]

# Constraints
- [boundaries]

# Execution Protocol
1. [steps]
```

## Memory System (Fully Local)

Memory extraction uses a local importance scorer — no external APIs required.

### How It Works

1. **Importance scoring** — Patterns detect identity statements, decisions, preferences, explicit rules (0.5–0.9 scale)
2. **Topic extraction** — Keyword map assigns topics (development, finance, health, goals, etc.)
3. **Entity extraction** — Capitalized words, @mentions, quoted strings
4. **Dual persistence** — SQLite (FTS5 search) + markdown files (`~/.wild-claude-pi/memories/YYYY-MM/YYYY-MM-DD-<topic>.md`)
5. **Decay** — `salience *= 0.95^(days_since_accessed)`, pinned memories exempt
6. **Context injection** — Relevant memories prepended to each message via FTS5 search

### Memory Commands

| Command | What it does |
|---------|-------------|
| `/memory <query>` | FTS5 search |
| `/remember <text>` | Manual save (importance 0.9, tagged 'manual') |
| `/reflect` | List recent memories, delete by number |
| `/pin <id>` / `/unpin <id>` | Prevent / allow decay |
| `/forget` | Delete all memories for this chat |

## Ralph Loop (Autonomous Development)

```
/ralph "Build the auth system"
    ↓
Creates PROJECT_ROOT/.ralph/
    ↓
Decomposes goal into fix_plan.md task checklist
    ↓
Loop (max 20 iterations):
    ├─ Pick first unchecked task [ ]
    ├─ Run via runAgent() — looks for "TASK COMPLETE"
    ├─ Mark [x] if complete, send Telegram update
    ├─ Circuit breaker: 3 no-progress → halt
    ├─ Rate limiting: max 30 calls/hour
    └─ Session continuity across iterations
```

## MCP Manager

31 known MCP servers in a registry (`src/mcp-manager.ts`). Install from Telegram:

```
/mcp               — list all
/mcp_install notion — writes to .mcp.json, prompts for missing secrets
/mcp_remove notion  — removes from .mcp.json
```

Categories: Productivity, Dev tools, Communication, Search/Web, Data/Storage, Cloud/Infra, AI/Analytics, Utilities.

## Life Management

```
~/.wild-claude-pi/life/
├── me/_kernel/key.md          # Identity, preferences, values
├── me/_kernel/log.md          # Decision log (prepend-only)
├── goals/_kernel/key.md       # Active goals with metrics
├── health/_kernel/key.md      # Health profile, routines
├── finance/_kernel/key.md     # Budget, accounts, targets
└── learning/_kernel/key.md    # Learning goals, resources
```

Life commands: `/morning`, `/evening`, `/goals`, `/focus`, `/journal`, `/review`

Automations: 08:00 daily briefing, 20:00 evening prompt, Sunday 18:00 weekly review.

## Personality Customization

`src/personality.ts` generates a dynamic system prompt snippet from per-user settings. The snippet is injected into CLAUDE.md between `PERSONALITY_START` / `PERSONALITY_END` markers on every reload.

**6 built-in presets:** `default`, `professional`, `casual`, `coach`, `debug`, `creative`.

**Settings:** `tone`, `responseLength`, `humor` (0–10), `emoji` (boolean), `language`, `pushback`, `customPrompt`.

- Hot-reload — changes to `~/.wild-claude-pi/config.json` take effect on the next message, no restart needed.
- User presets stored in `~/.wild-claude-pi/personalities/`.
- Telegram: `/personality` (show), `/personality <preset>` (switch).
- Dashboard: Settings > Personality — editor, preview, and preset selector (first card).
- API: `GET/PUT /api/personality`, `GET/POST/DELETE /api/personality/presets`, `POST /api/personality/preview`, `POST /api/personality/apply`.

## Overlay System

The overlay system (`src/overlay.ts`) is how user customization works. For any resource (agent, skill, dashboard service, config):

1. Check `~/.wild-claude-pi/<resource>` (user override, takes priority)
2. Fall back to `PROJECT_ROOT/<resource>` (built-in default)

What can be overlaid: agents, skills, dashboard services (`config.json` dashboards array), user preferences, custom automations.

Key functions: `listOverlayItems()`, `resolveOverlayFile()`, `writeOverlayFile()`, `loadUserConfig()`, `saveUserConfig()`.

**Rule:** New resources created via Telegram or dashboard are ALWAYS written to `USER_DATA_DIR`. Never write to `PROJECT_ROOT` at runtime.

## External Service Dashboards

`src/external-dashboards.ts` connects to external APIs (Vercel, Neon, Supabase, Stripe, Cloudflare, GitHub, Sentry) and user-defined services from `~/.wild-claude-pi/config.json`.

API routes: `GET /api/dashboards`, `GET /api/dashboards/:service/:endpoint`, `POST /api/dashboards` (create user service), `DELETE /api/dashboards/:service`.

User-defined services auto-register their secrets.

## Dashboard (Web UI)

**URL:** `http://<host>:3141`
**Stack:** Hono + HTMX + Alpine.js + TailwindCSS
**Auth:** Login screen on page load. `DASHBOARD_TOKEN` is optional (set via `/set_secret`).

17 modules: Command Center, Memory Palace, Mission Control, Agent Hub, Automation, Skills & MCP, System Vitals, Daily Journal, External Dashboards, File Explorer, Live Activity, Trace Inspector, Evals, Workflows, Reflection & Digest, Skill Marketplace, Hermes Lab, Settings.

## Hermes Stack (advanced layer)

A self-contained set of modules added in 2026-05 that move WildClaude from "personal AI OS" toward "definitive agentic tool". All gated by sensible defaults — nothing changes existing behaviour until you opt in.

### Safety & programmatic execution

- **Sandbox abstraction** ([src/sandbox/](src/sandbox/)) — three backends: `local`, `local-scratch` (filesystem-isolated, default), `docker` (full container, requires `dockerode` + image). Ralph runs inside a sandbox by default.
- **execute_code MCP** ([src/tools/execute-code-mcp.ts](src/tools/execute-code-mcp.ts)) — single tool that runs a JS snippet calling other tools through a `wc` global. Collapses multi-step plans into one inference. Path-traversal guarded; `process`/`require` not exposed.

### Memory & observability

- **Memory blocks** ([src/memory-blocks.ts](src/memory-blocks.ts)) — Mem0-style scoping (user/session/agent) + Letta-style editable blocks. Semantic search via Gemini text-embedding-004 (cosine ≥ 0.55) with keyword fallback. Multi-modal attachments (image/audio/file) with auto-captioning via Claude vision.
- **Trace Inspector** ([src/trace-inspector.ts](src/trace-inspector.ts)) — per-session timelines from `conversation_log` + `token_usage`, 30-day cost breakdown by agent. Timestamps normalised to ms at API boundary (legacy tables store seconds).
- **TokenJuice** ([src/token-juice.ts](src/token-juice.ts)) — output compression layer wired into browser-mcp + vision-mcp + gmail-mcp. HTML→Markdown, URL shortening, dedup, truncate. Tracks bytes-saved + dollar-saved stats.
- **Cost budget** ([src/cost-budget.ts](src/cost-budget.ts)) — `MONTHLY_BUDGET_USD` env. Alerts at 80% / 100%. `shouldDowngradeForBudget()` makes the router auto-downgrade to Haiku once the cap is hit.

### Workflows, debate, reflection

- **Workflows** ([src/workflows.ts](src/workflows.ts)) — YAML DAGs in `USER_DATA_DIR/workflows/` with cycle detection, topological execution, `{{step.output}}` interpolation, SQLite-checkpointed resumable runs.
- **Debate** ([src/debate.ts](src/debate.ts)) — N-round structured debate between two agents + Haiku synthesis.
- **Reflection** ([src/reflection.ts](src/reflection.ts)) — daily/weekly Haiku-drafted pattern surfacing from conversation_log + memories + tool_sequences + mission_tasks.
- **Digest** ([src/digest.ts](src/digest.ts)) — SQL rollup of new memories / tasks / runs / cost for a period.
- **Moods** ([src/moods.ts](src/moods.ts)) — time-aware personality modifiers (focus/work/evening/weekend) appended to `--append-system-prompt` in bot.ts alongside the personality preset.
- **Evals** ([src/evals.ts](src/evals.ts)) — declarative YAML test cases for agent behavior. Contains / not_contains / tools / length assertions. Runs persisted in `eval_runs`.

### Auto-cron

`automations.ts` ships six `__internal:` sentinel tasks routed through `scheduler.handleInternalSentinel` (no LLM call needed to dispatch unless the sentinel itself triggers one):
- 08:30 daily → reflection
- 09:00 daily → budget check
- 23:00 daily → digest
- Sunday 19:00 → weekly reflection
- Monday 04:00 → agent self-improvement scan
- Monday 03:30 → maintenance cleanup (sandboxes / proposals / uploads / exports)

### Auto-skill synthesis

[src/skill-synthesis.ts](src/skill-synthesis.ts) — canonical, PII-free tool-sequence hashing in `tool_sequences`. When the same sequence shows up 5× in 14 days, Haiku drafts a SKILL.md proposal to `~/.wild-claude-pi/skills/_proposals/` and pings Telegram. `/skill_accept <hash>` promotes; `/skill_reject <hash>` discards.

### Agent self-improvement

[src/agent-self-improvement.ts](src/agent-self-improvement.ts) — weekly cycle finds agents with failure rate ≥30% over 7 days, asks Opus for a conservative revision of the agent definition. Proposals land in `~/.wild-claude-pi/agents/_self-improvement-proposals/` for user approval via `/agent_improve accept`.

### Fine-tuning pipeline

[src/finetune.ts](src/finetune.ts) — trajectory selection + JSONL conversion + cost estimate. Submission gated by `FINETUNE_ENABLED=true` until Anthropic publishes the GA fine-tune spec; pipeline runs end-to-end except for the final API call.

### New MCP servers

- **Browser** ([src/tools/browser-mcp.ts](src/tools/browser-mcp.ts)) — Playwright wrapper. Host allowlist consent gate via `~/.wild-claude-pi/config.json → browser.allowedHosts` or `BROWSER_ALLOW_ALL=true`.
- **Vision** ([src/tools/vision-mcp.ts](src/tools/vision-mcp.ts)) — Claude vision (describe / extract_text / answer). Requires `ANTHROPIC_API_KEY`.
- **Home Assistant** ([src/integrations/home-assistant.ts](src/integrations/home-assistant.ts)) — HA REST API (list_entities / get_state / call_service / turn_on/off).
- **Gmail** ([src/integrations/gmail.ts](src/integrations/gmail.ts)) — REST API (list_unread / read / search / draft / send_draft). Uses [google-oauth.ts](src/integrations/google-oauth.ts) for token refresh; set `GMAIL_REFRESH_TOKEN` + `GOOGLE_OAUTH_CLIENT_ID`/`SECRET`. Falls back to raw `GMAIL_ACCESS_TOKEN` if refresh isn't configured.
- **Google Calendar** ([src/integrations/google-calendar.ts](src/integrations/google-calendar.ts)) — list/create/find_free_slot/update/delete. Same OAuth helper (`GCAL_REFRESH_TOKEN`).
- **Web Search** ([src/integrations/web-search.ts](src/integrations/web-search.ts)) — Brave or Tavily REST. Tools: `search`, `news`. Set `BRAVE_API_KEY` (preferred) or `TAVILY_API_KEY`. Much lighter than browser MCP for "what is X" queries.
- **Computer Use** ([src/tools/computer-use-mcp.ts](src/tools/computer-use-mcp.ts)) — screenshot / click / type / key / move. `COMPUTER_USE_ENABLED=false` by default. Honors `COMPUTER_USE_DRY_RUN=true`. Rate-limited; every action audited to `USER_DATA_DIR/computer-use.audit.jsonl`.

### Interop & ecosystem

- **ACP gateway** ([src/acp/](src/acp/)) — JSON-RPC 2.0 over stdio (Zed/Cursor subprocess) and over WebSocket (`ACP_WS_PORT=3142` + DASHBOARD_TOKEN, for remote IDE plugins). Same handlers, different wire.
- **Trajectory export** ([src/trajectory-export.ts](src/trajectory-export.ts)) — JSONL with PII scrubbing (emails / phones / API keys / IPs preserving localhost) + chat-id hashing. `--encrypt <pass>` produces AES-256-GCM ciphertext.
- **Skill import** ([src/skill-import.ts](src/skill-import.ts)) — `/skill_install <name-or-url>` with preview/confirm flow, scriptlet stripping, `source:` annotation.
- **Recommended skills** ([src/recommended-skills.ts](src/recommended-skills.ts)) — curated picks: book-to-skill, graphify, Skill_Seekers, claude-skills-313. Surfaced in dashboard Marketplace.
- **Plugin SDK** ([src/sdk/index.ts](src/sdk/index.ts)) — public type exports for third-party plugin authors.
- **Litestream sync** ([src/sync/litestream.ts](src/sync/litestream.ts)) — generates `litestream.yml` for S3-backed SQLite replication across devices.
- **Real-time voice streaming** ([src/voice-streaming.ts](src/voice-streaming.ts)) — ElevenLabs streaming TTS scaffold gated by `VOICE_STREAMING_ENABLED=true`. Sentence splitter + async-iterable bridge for `runAgent.onStreamText`.

### Chat efficiency

Three things bot.ts does to keep the token bill predictable:

1. **Early routing** — `classifyMessage` runs BEFORE `buildMemoryContext`. SIMPLE-tier messages (greetings, acks, slash commands, sub-20-char messages) skip the entire memory injection block, saving ~800 tokens per turn.
2. **Parallel memory queries** — `buildMemoryContext` runs FTS5 + recent-high-importance in `Promise.all`.
3. **Hermes memory_blocks** are injected via cheap `searchByText` (LIKE matching) in the chat path. Semantic search (cosine similarity over Gemini embeddings) is reserved for `/whatdoyouknow` and the dashboard where it's user-initiated — never on a hot path.

Soft-throttle: if the monthly budget is exceeded, the router downgrades all classification results to SIMPLE → Haiku for the rest of the month. See `src/cost-budget.ts → shouldDowngradeForBudget`.

### Inline keyboards

Skill-synthesis proposals get a follow-up Telegram message with `✅ Accept` / `❌ Reject` inline buttons next to the text message (mobile-friendly). Slash commands `/skill_accept <hash>` / `/skill_reject <hash>` still work too. The `callback_query` handler is in [bot.ts](src/bot.ts) right after `attachProposalNotifier`.

For activation flags and config keys, see [docs/HERMES.md](docs/HERMES.md).

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome + onboarding if first time |
| `/help` | List all commands + skills |
| `/newchat` | Clear session, start fresh |
| `/model <opus\|sonnet\|haiku>` | Switch model for this chat |
| `/personality` | Show or switch personality preset |
| `/voice` | Toggle voice responses |
| `/secrets` | Show secrets status |
| `/set_secret <KEY>` | Set a secret (encrypted) |
| `/delete_secret <KEY>` | Remove a secret |
| `/mcp` | List MCP servers |
| `/mcp_install <name>` | Install MCP server |
| `/mcp_remove <name>` | Remove MCP server |
| `/import` | Scan for importable data |
| `/import all` | Import everything found |
| `/import file <path>` | Import specific file |
| `/memory <query>` | Search memories |
| `/remember <text>` | Save high-importance memory |
| `/reflect` | Browse and delete memories |
| `/pin <id>` / `/unpin <id>` | Pin/unpin memory |
| `/forget` | Delete all memories |
| `/agents` | List all agents |
| `/delegate <agent> <prompt>` | Route to specific agent |
| `/ralph <goal>` | Start autonomous dev loop |
| `/ralph status` / `/ralph stop` | Ralph control |
| `/create_skill <name> <desc>` | Create new skill |
| `/create_agent <id> <lane> <desc>` | Create new agent |
| `/evolution` | View evolution log |
| `/morning` | Daily briefing |
| `/evening` | Evening review |
| `/goals` | Goal management |
| `/focus` | Deep work session |
| `/journal` | Quick reflection |
| `/review` | Weekly review |
| `/stop` | Cancel running agent |
| `/lock` | Lock session |
| `/status` | Health check |
| `/dashboard` | Get dashboard link |
| **Hermes** | |
| `/sandbox [prune\|docker\|test]` | Sandbox lifecycle + smoke test |
| `/skill_accept <hash>` / `/skill_reject <hash>` | Approve / discard auto-skill proposal |
| `/skill_install <ref>` / `/skill_confirm` / `/skill_cancel` | Import a skill from a URL or agentskills.io |
| `/whatdoyouknow about <topic>` | Knowledge introspection (semantic + keyword) |
| `/unlearn <topic>` | Targeted memory deletion |
| `/evals list\|run <name>\|recent` | Run declarative agent eval cases |
| `/workflow list\|run <name>\|recent` | Run declarative DAG workflows |
| `/debate <agentA> <agentB> <topic>` | N-round multi-agent debate |
| `/reflect today\|week\|recent` | Generate Haiku-drafted reflection |
| `/digest day\|week\|month` | Period rollup |
| `/mood [set <focus\|work\|evening\|weekend\|neutral>]` | Personality modulation |
| `/sync status\|init\|configure` | Cross-device sync via Litestream |
| `/export trajectories [--since YYYY-MM-DD] [--limit N] [--raw] [--encrypt <pass>]` | JSONL export with PII scrub |
| `/tokenjuice` | Output compression stats |
| `/recommended [tag]` | Curated third-party skills |
| `/budget` | Monthly cost status + threshold |
| `/agent_improve list\|run\|accept\|drop` | Closed-loop agent refinement |
| `/finetune estimate\|build\|submit` | Trajectory-based fine-tune pipeline |

## Deployment

### Quick Start
```bash
git clone https://github.com/rsalvagio92/WildClaude.git
cd WildClaude
bash scripts/bootstrap.sh
# First run: onboarding wizard runs before bot starts
```

### CLI Tool
```bash
./wildclaude setup            # Install CLI globally
wildclaude start              # Start
wildclaude service install    # Auto-start on boot (systemd)
wildclaude upgrade            # Pull latest, rebuild, restart
wildclaude status             # Show status
```

**Requirements:**
- Node.js 20+ (ARM64 on Pi, x64 elsewhere)
- SSD recommended for SQLite WAL performance
- Lightweight enough to run on a Raspberry Pi

**Resource Budget:**
```
OS + system:            ~500MB
WildClaude:             ~300MB
SQLite databases:       ~100MB
Available headroom:     ~7GB+ (API-based AI, no local models)
```

## Project Structure

```
wildclaude/
├── CLAUDE.md                 # This file
├── .env                      # Secrets (never committed)
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # Entry point, CLI onboarding check
│   ├── bot.ts                # Telegram handler (Grammy)
│   ├── agent.ts              # Claude Code integration
│   ├── router.ts             # Multi-model classifier
│   ├── db.ts                 # SQLite schema + queries
│   ├── paths.ts              # Data separation (PROJECT_ROOT vs USER_DATA_DIR)
│   ├── secrets.ts            # Encrypted secrets store
│   ├── mcp-manager.ts        # 31-server MCP registry
│   ├── importer.ts           # Import from previous assistants
│   ├── cli-onboarding.ts     # Terminal setup wizard (first run)
│   ├── onboarding.ts         # Telegram onboarding flow
│   ├── memory.ts             # Memory context builder
│   ├── memory-ingest.ts      # Local memory extraction (no external API)
│   ├── memory-files.ts       # .md file persistence (~/.wild-claude-pi/memories/)
│   ├── memory-consolidate.ts # Pattern extraction (every 30min)
│   ├── personality.ts        # Dynamic prompt generator, 6 presets, hot-reload
│   ├── evolution.ts          # Create skills/agents, git-tracked
│   ├── life-commands.ts      # /morning /evening /goals /focus /journal /review /remember /reflect
│   ├── automations.ts        # Pre-configured cron tasks
│   ├── ralph.ts              # Autonomous dev loop
│   ├── agent-registry.ts     # registry.yaml loader, keyword matching
│   ├── orchestrator.ts       # Agent delegation (@agent syntax)
│   ├── scheduler.ts          # Cron task execution
│   ├── security.ts           # PIN, kill phrase, audit log
│   ├── voice.ts              # STT/TTS
│   ├── overlay.ts            # Overlay resolution (user overrides project defaults)
│   ├── external-dashboards.ts # External service dashboard connections
│   ├── dashboard.ts          # Hono web server
│   ├── dashboard-html.ts     # Dark-mode SPA (11 modules)
│   ├── config.ts             # Environment config
│   ├── whatsapp.ts           # WhatsApp bridge
│   └── slack.ts              # Slack bridge
├── agents/                   # Project default agent definitions
│   ├── build/                # architect, coder, debugger, tester
│   ├── review/               # code-reviewer, security-reviewer
│   ├── domain/               # researcher, writer, data-analyst
│   ├── coordination/         # orchestrator, critic, dashboard-builder
│   ├── life/                 # coach, organizer, finance, health, learner
│   └── registry.yaml         # Agent registry
├── skills/                   # Project default skill definitions
├── life/                     # Kernel templates (copied to ~/.wild-claude-pi/life/ on first run)
├── scripts/
│   ├── bootstrap.sh          # One-command setup (Linux/macOS/Pi)
│   ├── bootstrap.ps1         # One-command setup (Windows)
│   ├── wildclaude.sh         # CLI implementation (bash)
│   └── wildclaude.ps1        # CLI implementation (PowerShell)
├── wildclaude                # CLI entry point (bash)
├── wildclaude.cmd            # CLI entry point (Windows CMD)
├── wildclaude.ps1            # CLI entry point (Windows PowerShell)
└── docs/
    ├── SETUP.md
    ├── COMMANDS.md
    ├── ARCHITECTURE.md
    ├── AGENTS.md
    └── SKILLS.md
```

## Documentation

| Document | Content |
|----------|---------|
| [docs/SETUP.md](docs/SETUP.md) | Installation, configuration, quick start |
| [docs/COMMANDS.md](docs/COMMANDS.md) | Complete command reference |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture, module map, data flow |
| [docs/AGENTS.md](docs/AGENTS.md) | All 17 agents with triggers, models, use cases |
| [docs/SKILLS.md](docs/SKILLS.md) | Skill system, installed skills, how to create |

## Direct CLI Mode

WildClaude calls `claude -p --output-format stream-json` (the Claude CLI) for all AI requests by default. This uses your Anthropic subscription — no API key required. Set `ANTHROPIC_API_KEY` to fall back to the SDK instead.

Session resume: every conversation has a `sessionId` stored in SQLite. CLI mode passes `--resume <sessionId>`, SDK mode passes `resume: sessionId`. `/respin` injects a saved handoff file as read-only context after `/newchat`.

## Session Continuity

- `/newchat` generates a handoff file in `~/.wild-claude-pi/session-handoffs/` and auto-commits a summary to the `hive_mind` table before clearing the session.
- `/respin` injects the last session's handoff as a context prefix (sandboxed — no instructions will be executed from it).
- Self-reflection: corrections logged to `~/.wild-claude-pi/reflections.jsonl`, injected into system prompt context automatically.

## Golden Rules

1. **Assemble, don't reinvent.** Extract proven patterns. Write only glue code.
2. **Code stays in repo, data stays in `~/.wild-claude-pi/`.** Never mix them.
3. **Memory extraction is fully local.** No external APIs for memory extraction or consolidation. Gemini is optional for video analysis and embedding-based semantic search (requires `GOOGLE_API_KEY`).
4. **Secrets are encrypted.** Use the secrets store, not plain text `.env` for sensitive keys.
5. **Dashboard is first-class.** Modern, dark-mode, responsive, real-time.
6. **Opus for thinking, Sonnet for doing, Haiku for routing.** Every message classified.
7. **Designed to be lightweight — runs on anything from a Pi to a cloud server.** SQLite, API-based AI only. No local LLMs.
8. **Git-track everything.** Agents, skills, life context, evolution — all versioned.
9. **CLI first, SDK as fallback.** Default to `claude -p` for subscription usage; SDK when `ANTHROPIC_API_KEY` is explicitly set.
