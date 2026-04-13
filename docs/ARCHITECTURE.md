# WildClaude Architecture

## System Overview

WildClaude is a lightweight personal AI operating system. It runs as a Node.js service providing AI capabilities via Telegram (primary), web dashboard (secondary), and CLI (tertiary).

```
┌─────────────────────────────────────────────────────────────┐
│                    USER INTERFACES                          │
│                                                              │
│  Telegram (Grammy)  │  Dashboard (Hono)  │  CLI onboarding  │
│  - Text, voice      │  - 11 modules      │  - first-run     │
│  - Images, files    │  - SSE real-time    │  - import wizard │
│  - Commands         │  - login screen     │                  │
└──────────┬───────────┴────────┬────────────┴───────┬────────┘
           │                    │                    │
┌──────────▼────────────────────▼────────────────────▼────────┐
│                    CORE SERVICES                             │
│                                                              │
│  ┌──────────────┐  ┌─────────────┐  ┌────────────────────┐ │
│  │ Router       │  │  Orchestrator│  │   Scheduler        │ │
│  │ (pattern +  │  │ (17 agents, │  │ (cron + automations│ │
│  │  opt. Haiku) │  │  5 lanes)   │  │                   )│ │
│  └──────┬───────┘  └──────┬──────┘  └────────┬───────────┘ │
│         │                 │                   │              │
│  ┌──────▼─────────────────▼───────────────────▼───────────┐ │
│  │            Claude Agent SDK                             │ │
│  │  Spawns `claude` CLI → Uses subscription auth           │ │
│  │  Models: Opus 4.6 │ Sonnet 4.6 │ Haiku 4.5            │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐ │
│  │ Memory   │ │ Ralph    │ │ Evolution│ │ Security      │ │
│  │ (local)  │ │ Auto-loop│ │ Self-mod │ │ PIN+audit     │ │
│  └──────────┘ └──────────┘ └──────────┘ └───────────────┘ │
└─────────────────────────────────────────────────────────────┘
           │
┌──────────▼──────────────────────────────────────────────────┐
│                    STORAGE                                    │
│                                                              │
│  PROJECT_ROOT (repo)         USER_DATA_DIR (~/.wild-claude-pi)│
│  - agents/*.md               - life/*/_kernel/*.md            │
│  - skills/*/SKILL.md         - memories/YYYY-MM/*.md          │
│  - life/ (templates)         - store/wild-claude.db           │
│  - .mcp.json (config)        - agents/ (user overrides)        │
│  - .mcp.json                 - skills/ (user overrides)       │
│  - src/                      - secrets.enc.json               │
│                              - evolution.log.json             │
│                              - log.md (cross-session activity) │
│                              - reflections.jsonl (lesson log) │
│                              - CLAUDE.md (user system prompt) │
└─────────────────────────────────────────────────────────────┘
```

## Data Separation

WildClaude cleanly separates code from user data.

| Root | Set by | Contains |
|------|--------|---------|
| `PROJECT_ROOT` | repo checkout directory | Source code, agent/skill templates, MCP config |
| `USER_DATA_DIR` | `~/.wild-claude-pi/` (or `WILD_DATA_DIR` env var) | Life data, memories, custom agents/skills, secrets, SQLite DB |

Path helpers in `src/paths.ts`:
- `lifePath(...segments)` — resolves inside `USER_DATA_DIR/life/`
- `storePath(filename)` — resolves inside `USER_DATA_DIR/store/`
- `resolveAgentPath(lane, id)` — user override first, then project default
- `resolveSkillPath(name)` — user override first, then project default

## Module Map

### Core (src/)

| File | Purpose |
|------|---------|
| `index.ts` | Entry point, process lifecycle, CLI onboarding check |
| `bot.ts` | Telegram handler, message pipeline, all commands |
| `agent.ts` | Claude Agent SDK wrapper, token tracking |
| `router.ts` | Multi-model classifier (pattern + optional Haiku API) |
| `config.ts` | Environment config, constants |
| `db.ts` | SQLite schema, queries, AES-256-GCM encryption |
| `paths.ts` | Data directory management, code vs user-data separation |

### Onboarding & Setup (src/)

| File | Purpose |
|------|---------|
| `cli-onboarding.ts` | Terminal setup wizard on first run (import detection + profile questions) |
| `onboarding.ts` | Telegram onboarding flow (profile questions in-chat via /start) |

### Secrets & Configuration (src/)

| File | Purpose |
|------|---------|
| `secrets.ts` | Encrypted secrets store (`~/.wild-claude-pi/secrets.enc.json`), Telegram `/secrets` commands |

### Memory (src/)

| File | Purpose |
|------|---------|
| `memory.ts` | Context builder (keyword search + importance ranking) |
| `memory-ingest.ts` | Fully local memory extraction (importance scoring, topic extraction, entity detection) |
| `memory-files.ts` | Markdown file persistence (`~/.wild-claude-pi/memories/`) |
| `memory-consolidate.ts` | Pattern extraction across recent memories (every 30 min) |

### Import (src/)

| File | Purpose |
|------|---------|
| `importer.ts` | Import from OpenClaw, ClaudeClaw, claude-mem, bOS, Claude Code, generic markdown/JSON/SQLite |

### MCP (src/)

| File | Purpose |
|------|---------|
| `mcp-manager.ts` | 31-server registry, install/remove MCP servers, write `.mcp.json`, auto-register secrets |

### Agents (src/)

| File | Purpose |
|------|---------|
| `agent-registry.ts` | Loads `registry.yaml`, keyword matching, system prompt extraction |
| `orchestrator.ts` | Delegation routing (@agent syntax), hive_mind logging |

### Life Management (src/)

| File | Purpose |
|------|---------|
| `life-commands.ts` | 8 Telegram commands: morning, evening, goals, focus, journal, review, remember, reflect |
| `automations.ts` | Pre-configured cron tasks (morning 8am, evening 8pm, weekly Sunday 6pm) |

### Autonomous Development (src/)

| File | Purpose |
|------|---------|
| `ralph.ts` | Ralph loop: goal decomposition, iterative execution, circuit breaker, rate limiting |

### Self-Evolution (src/)

| File | Purpose |
|------|---------|
| `evolution.ts` | Create skills/agents via conversation, git-tracked mutations, evolution log in `USER_DATA_DIR` |

### Personality (src/)

| File | Purpose |
|------|---------|
| `personality.ts` | Dynamic prompt generator; 6 built-in presets; hot-reload from `config.json`; user presets in `~/.wild-claude-pi/personalities/` |

### Overlay & Customization (src/)

| File | Purpose |
|------|---------|
| `overlay.ts` | Generic overlay resolution: user (`~/.wild-claude-pi/`) overrides project defaults for agents, skills, dashboards, hooks, config |
| `external-dashboards.ts` | External service dashboard connections (Vercel, GitHub, Neon, Supabase, Stripe, Cloudflare, Sentry) + user-defined services from `config.json` |

### Infrastructure (src/)

| File | Purpose |
|------|---------|
| `dashboard.ts` | Hono web server, API endpoints, SSE events |
| `dashboard-html.ts` | Dark-mode SPA (11 modules), login screen |
| `scheduler.ts` | Cron task execution |
| `security.ts` | PIN lock, kill phrase, audit logging |
| `voice.ts` | STT (Groq Whisper), TTS (ElevenLabs) |
| `whatsapp.ts` | WhatsApp Web bridge |
| `slack.ts` | Slack API integration |
| `session-continuity.ts` | Session handoff file generation before /newchat |
| `self-reflection.ts` | Correction detection, lesson logging to reflections.jsonl |
| `message-queue.ts` | Concurrent message handling: FIFO queue + sidecar dispatch |

## Direct CLI Mode

WildClaude invokes Claude via the official Claude CLI (`claude -p --output-format stream-json`) rather than the Anthropic REST API. This is the default mode and requires the Claude CLI to be installed and logged in.

### Why CLI mode?

| Aspect | CLI mode (default) | SDK mode (fallback) |
|--------|--------------------|---------------------|
| Auth | `~/.claude/` subscription auth | `ANTHROPIC_API_KEY` |
| Rate limits | Subscription limits only | API tier limits |
| Third-party restrictions | None | Subject to API policy |
| Session resume | Yes — `--resume <sessionId>` | Yes — via SDK |
| Streaming | Full SSE with tool events | SDK streaming |
| Cost | Covered by Pro/Max subscription | Per-token billing |

### Fallback to SDK

If `ANTHROPIC_API_KEY` is set in `.env` or the encrypted secrets store, `agent.ts` switches to the Anthropic SDK automatically. The rest of the system (memory, routing, scheduling) is identical in both modes.

### Session Resume

Both CLI and SDK modes support session resume: each `ctx.reply` conversation gets a unique `sessionId` (stored in SQLite). Subsequent turns pass `--resume <sessionId>` (CLI) or `resume: sessionId` (SDK) to maintain full conversation context across restarts.

### Streaming & Tool Events

In CLI mode, `--output-format stream-json` emits newline-delimited JSON events:

```
{"type":"assistant","message":{"content":[...]}}
{"type":"tool_use","tool":"bash","input":{...}}
{"type":"tool_result","content":"..."}
{"type":"result","subtype":"success","result":"..."}
```

`agent.ts` parses these events and:
- Shows tool-use steps to the user (configurable verbosity)
- Tracks `input_tokens` / `output_tokens` per turn
- Detects `context_window_compacted` events for the context warning

## CLI Onboarding Flow

On startup, `index.ts` calls `needsCliOnboarding()` which checks whether `~/.wild-claude-pi/life/me/_kernel/key.md` exists and is filled in. If not, `runCliOnboarding()` runs interactively in the terminal before the bot starts:

```
Bot starts
    │
    ├─ needsCliOnboarding() → key.md missing or has [FILL IN]?
    │
    ├─ YES: runCliOnboarding()
    │   ├─ Language selection (English, Italiano, Español)
    │   ├─ Print welcome banner
    │   ├─ AI backend choice (subscription vs API key)
    │   ├─ detectSources() — scan for OpenClaw/claude-mem/bOS/Claude Code
    │   ├─ If sources found: offer import (autoImport() runs with spinner)
    │   ├─ Profile questions (name, location, languages, work style, goals, projects)
    │   ├─ Bot personalization (custom name, personality preset)
    │   ├─ Dashboard token generation
    │   ├─ Write ~/.wild-claude-pi/life/me/_kernel/key.md
    │   ├─ Write ~/.wild-claude-pi/life/goals/_kernel/key.md
    │   └─ Write ~/.wild-claude-pi/config.json (botIdentity, personality)
    │
    └─ Bot starts normally (Telegram polling begins)
```

Users can also complete setup later via Telegram `/start` (Telegram onboarding flow in `onboarding.ts`) or by editing the markdown files directly.

## Multi-Model Routing

Every incoming message passes through the router before reaching Claude:

```
Message arrives
    │
    ├─ Pattern fast-path (no API call):
    │   /commands → SIMPLE (Haiku)
    │   "hi/hello/thanks" → SIMPLE
    │   "architect/design/plan" → COMPLEX (Opus)
    │   Short msgs (<20 chars) → SIMPLE
    │
    ├─ Heuristic classification (no ANTHROPIC_API_KEY):
    │   Code keywords → MEDIUM (Sonnet)
    │   Long + question → COMPLEX (Opus)
    │   Default → MEDIUM (Sonnet)
    │
    └─ Haiku API classification (with ANTHROPIC_API_KEY):
        ~$0.001, ~200ms → SIMPLE/MEDIUM/COMPLEX
```

Override: `/model opus` forces a model per-chat. Agent configs specify model per-agent.

## Concurrent Message Handling

When a message arrives while the agent queue is busy, three tiers of handling apply in sequence:

```
New message arrives while queue is busy
    │
    ├─ Tier 1: Smart routing
    │   Classify complexity of the new message
    │   SIMPLE → dispatch immediately to Haiku sidecar (no wait)
    │   MEDIUM/COMPLEX → proceed to Tier 2
    │
    ├─ Tier 2: Fast-path sidecar (MAX_SIDECAR_SESSIONS=1)
    │   Spawn a parallel Haiku session for an instant acknowledgement
    │   Main Opus/Sonnet session continues working in background
    │   Both results delivered to user when ready
    │
    └─ Tier 3: Buffer injection
        If sidecar slots exhausted, buffer the incoming message
        On completion of the active task, inject buffered messages
        as context prefix into the next query — nothing is lost
```

Configuration in `src/config.ts`:

| Variable | Default | Effect |
|----------|---------|--------|
| `BATCH_WINDOW_MS` | `200` | Milliseconds to wait before flushing the buffer |
| `MAX_SIDECAR_SESSIONS` | `1` | Max parallel Haiku sidecar instances |

## Agent System

### 5 Lanes, 17 Agents

```
BUILD        → architect(O), coder(S), debugger(S), tester(S)
REVIEW       → code-reviewer(O), security-reviewer(S)
DOMAIN       → researcher(S), writer(S), data-analyst(S)
COORDINATION → orchestrator(O), critic(O), dashboard-builder(S)
LIFE         → coach(O), organizer(S), finance(S), health(H), learner(S)

O=Opus  S=Sonnet  H=Haiku
```

### Delegation Flow

```
User: @coder implement the auth middleware

1. parseDelegation() extracts agentId="coder", prompt="implement..."
2. orchestrator looks up "coder" in agentRegistry (registry.yaml)
3. resolveAgentPath() checks user override first, then project default
4. getAgentSystemPrompt("coder") reads agents/build/coder.md
5. runAgent(prompt, sessionId, model="claude-sonnet-4-6") with system prompt
6. Result sent back to Telegram
7. Logged to hive_mind table
```

### Adding Agents

**Via Telegram (stored in `~/.wild-claude-pi/agents/`):**
```
/create_agent devops build CI/CD pipeline management
```

**Via file (project defaults in `agents/<lane>/<id>.md`):**
1. Create the `.md` file with YAML frontmatter
2. Add entry to `agents/registry.yaml`
3. Restart — agent is auto-discovered

User agents in `~/.wild-claude-pi/agents/` override project defaults by ID.

## Memory Architecture

### Fully Local — No External APIs

Memory extraction uses a local importance scorer in `memory-ingest.ts`. No Gemini or external API calls are made. The system:

- Checks message against skip patterns (ephemeral messages: "ok", "yes", single emojis)
- Checks against high-importance patterns (identity, decisions, preferences, rules)
- Scores importance from 0.5 (default) up to 0.9 (explicit instructions)
- Extracts topics via keyword map (development, finance, health, etc.)
- Extracts entities from capitalized words, @mentions, quoted strings
- **Deduplication:** before saving, checks for 80%+ word overlap with recent memories via FTS5 — prevents the same fact being stored multiple times

### Dual Persistence

Every memory is stored in two places:

1. **SQLite** (`~/.wild-claude-pi/store/wild-claude.db`) — fast search via FTS5, decay tracking, pin status, soft-delete
2. **Markdown files** (`~/.wild-claude-pi/memories/YYYY-MM/YYYY-MM-DD-<topic>.md`) — human-readable, git-trackable, survives DB resets

### Memory Lifecycle

```
User message + Claude response
    │
    ├─ memory-ingest.ts (synchronous, local)
    │   Local importance scoring
    │   Topic + entity extraction
    │   Dedup check (FTS5 similarity ≥ 80% → skip)
    │   Save to SQLite + write .md file
    │
    ├─ Every 30 min: consolidation
    │   Find patterns across 50+ recent memories
    │   Generate insights (searchable via FTS5)
    │
    └─ Every 24h: decay sweep
        salience *= weighted_factor (by importance + recency of access)
        salience < 0.01 → soft-delete (deleted_at timestamp set)
        soft-deleted > 30 days → hard delete
```

### Decay Model

| Condition | Multiplier | Retention |
|-----------|-----------|-----------|
| Pinned | 1.0 | Forever |
| Accessed within 7 days | 0.995/day | ~550 days |
| Importance ≥ 0.8 | 0.99/day | ~460 days |
| Importance ≥ 0.5, accessed within 30d | 0.985/day | ~300 days |
| Importance ≥ 0.5 | 0.97/day | ~230 days |
| Importance < 0.5 | 0.93/day | ~90 days |

Soft-deleted memories are recoverable via `undeleteMemory()` (30-day window).

After the 30-day soft-delete window, memories are **archived permanently** to the `memory_archive` table before hard deletion. Conversation log entries are also archived when pruned beyond the 500-entry limit. The archive is searchable via `searchArchive()`.

### Zero-Loss Architecture

```
Memory/Data lifecycle:
  Active → Soft-deleted (30d) → Archived permanently (memory_archive)
  Conversation log → Pruned to 500 → Archived permanently
  WA/Slack messages → 30-day retention (up from 3 days)
  Mission tasks → 30-day retention (up from 7 days)
  /reflect delete → Soft-delete (recoverable)
```

**Daily safeguards** (run in `runDecaySweep()`):
1. `VACUUM INTO` backup → `~/.wild-claude-pi/store/backups/claudeclaw-YYYY-MM-DD.db` (7 rolling)
2. `PRAGMA integrity_check` — logs error if DB is corrupted
3. Archive → then delete (never delete without archiving first)

**Markdown backup** — Each memory's raw user message is stored in `.md` files inside a collapsible `<details>` block, enabling recovery even if the DB is lost.

### Context Injection (5 layers)

Before each message is sent to Claude, relevant memories are prepended:

1. **FTS5 keyword search** — `ORDER BY rank * importance * salience DESC`, agent-filtered
2. **High-importance recent** — importance ≥ 0.4 AND salience ≥ 0.05, weighted sort
3. **Consolidation insights** — searched via FTS5 (falls back to LIKE on old DBs)
4. **Cross-agent activity** — what other agents have done in the last 24h
5. **Conversation history recall** — triggered by keywords like "remember", "last time", "we discussed"

## Secrets Manager

`secrets.ts` provides encrypted secret storage with resolution ordering:

```
getSecret("KEY")
    │
    ├─ 1. ~/.wild-claude-pi/secrets.enc.json (AES-256-GCM)
    ├─ 2. .env file in PROJECT_ROOT
    └─ 3. process.env
```

The encryption key is `DB_ENCRYPTION_KEY`. If not set, a machine-specific fallback is derived. `ensureEncryptionKey()` auto-generates and writes `DB_ENCRYPTION_KEY` to `.env` on first run if missing.

MCPs and plugins can register dynamic secrets via `registerSecret(def)`. These appear in `/secrets` output and can be set the same way.

## MCP Manager

`mcp-manager.ts` maintains a registry of 31 known MCP servers across 8 categories. When a server is installed:

1. Required secrets are registered with `registerSecret()`
2. Env vars are built by substituting secret values into templates
3. Server entry is written to `PROJECT_ROOT/.mcp.json`
4. Missing secrets are reported for the user to set via `/set_secret`

The `.mcp.json` config is read by the Claude Agent SDK at startup.

## Import System

`importer.ts` detects and imports from multiple sources:

| Source type | Detection path | Import method |
|-------------|---------------|---------------|
| `openclaw` | `~/openclaw/`, `~/OpenClaw/`, etc. | SQLite DB (memories, conversations, consolidations) |
| `claudeclaw` | `~/.claudeclaw/`, `store/claudeclaw.db` | SQLite DB + markdown files |
| `claude-mem` | `~/.claude-mem/claude-mem.db` | observations, session summaries, user_prompts |
| `bos` | `~/bOS/state/`, `~/bos/state/` | Markdown files → life kernel mapping |
| `claude-code` | `~/.claude/` | CLAUDE.md + memory dir + project memories |
| `markdown` | Any `.md` file/directory | Multi-section files split into separate memories |
| `json` | Any `.json` file | Array of memories or `{memories: [...]}` object |

Imported memories go into both SQLite and the `~/.wild-claude-pi/memories/` markdown files.

## Ralph (Autonomous Loop)

```
/ralph "Build the auth system"
    │
    ├─ Create PROJECT_ROOT/.ralph/ directory
    ├─ Write PROMPT.md with goal
    ├─ Ask Claude to decompose into fix_plan.md tasks
    │
    └─ Loop (max 20 iterations):
        ├─ Pick first unchecked task [ ]
        ├─ Call runAgent() with task prompt
        ├─ Check for "TASK COMPLETE" signal
        ├─ Mark task [x] if complete
        ├─ Send Telegram update
        │
        ├─ Circuit breaker: 3 no-progress → halt
        ├─ Rate limiter: max 30 calls/hour
        └─ Session continuity across iterations
```

## Self-Reflection & Self-Improvement

### Automatic Correction Detection

`self-reflection.ts` detects when the user corrects or contradicts a previous bot response:

```
Bot says X → User says "no, actually Y"
    │
    ├─ Correction pattern detected
    ├─ Lesson written to ~/.wild-claude-pi/reflections.jsonl
    └─ Injected into system prompt context on subsequent turns
```

### Manual Lesson Capture — `/learnlesson`

The `/learnlesson` skill captures lessons on demand, immediately after any error or misunderstanding. It writes to three destinations simultaneously:

```
/learnlesson
    │
    ├─ 1. Memory file (~/.wild-claude-pi/memories/YYYY-MM/YYYY-MM-DD-lesson-<slug>.md)
    │      importance: 0.95, pinned: true — never decays
    │
    ├─ 2. ~/.wild-claude-pi/reflections.jsonl
    │      Auto-injected into system prompt in all future sessions
    │
    └─ 3. ~/.wild-claude-pi/lessons-learned.md (user data — never in repo)
           Human-readable lesson history
```

Lesson format: `QUANDO / ERRORE / CORRETTO / PERCHÉ / CATEGORIA`

### Activity Log

`~/.wild-claude-pi/log.md` is an append-only cross-session log written after every significant action:

```
[YYYY-MM-DD HH:MM] [SESSION|CRON|AGENT] [project] action
```

Read at session start for continuity. Shared across all sessions and cron agents.

Both mechanisms create a compounding feedback loop that makes WildClaude progressively better at anticipating each user's preferences without requiring manual profile updates.

## Session Continuity

Before every `/newchat`, `session-continuity.ts` writes a handoff file:

```
~/.wild-claude-pi/session-handoffs/<chatId>-<timestamp>.md
```

This file contains the last N conversation turns and any key context. After `/newchat`:
- Use `/respin` to inject the handoff as a read-only context prefix into the new session
- The old session is also auto-summarized and committed to the `hive_mind` table in SQLite

## Overlay System

The overlay system (`src/overlay.ts`) is the core customization mechanism. It ensures user-created content always takes priority over project defaults, while keeping the repo clean and updatable.

### Resolution Order

For any resource (agent, skill, dashboard service, config):
1. `~/.wild-claude-pi/<resource>` (user override -- takes priority)
2. `PROJECT_ROOT/<resource>` (built-in default)

### What Can Be Overlaid

| Resource | Project Location | User Override Location |
|----------|-----------------|----------------------|
| Agents | `agents/<lane>/<id>.md` | `~/.wild-claude-pi/agents/<lane>/<id>.md` |
| Skills | `skills/<name>/SKILL.md` | `~/.wild-claude-pi/skills/<name>/SKILL.md` |
| Dashboard services | Built-in (7 services in `external-dashboards.ts`) | `~/.wild-claude-pi/config.json` `dashboards` array |
| User preferences | N/A | `~/.wild-claude-pi/config.json` `preferences` |
| Custom automations | `src/automations.ts` (3 defaults) | `~/.wild-claude-pi/config.json` `automations` array |

### Key Functions

- `listOverlayItems(subdir)` -- List all items of a type, merging user and project directories
- `resolveOverlayFile(subdir, filename)` -- Resolve a single file, user first
- `writeOverlayFile(subdir, filename, content)` -- Write to user overlay (never to project root)
- `deleteOverlayFile(subdir, filename)` -- Delete from user overlay only (cannot delete built-ins)
- `loadUserConfig()` / `saveUserConfig()` -- Read/write `~/.wild-claude-pi/config.json`

### Design Principle

New resources created via Telegram commands (`/create_agent`, `/create_skill`) or the dashboard API (`POST /api/dashboards`) are **always** written to `USER_DATA_DIR`. The project root is never modified by the running system. This means `git pull` on the repo will never conflict with user customizations.

## External Service Dashboards

`src/external-dashboards.ts` connects to external APIs and exposes their status, logs, and metrics through the dashboard UI and REST API.

### Built-in Services

| Service | Secret Key | Endpoints |
|---------|-----------|-----------|
| Vercel | `VERCEL_TOKEN` | Projects, Recent Deployments, Domains |
| Neon DB | `NEON_API_KEY` | Projects |
| Supabase | `SUPABASE_ACCESS_TOKEN` | Projects |
| Stripe | `STRIPE_SECRET_KEY` | Balance, Recent Charges, Customers |
| Cloudflare | `CLOUDFLARE_API_TOKEN` | Zones (Domains), Accounts |
| GitHub | `GITHUB_TOKEN` | Your Repos, Notifications |
| Sentry | `SENTRY_AUTH_TOKEN` | Projects |

### User-Defined Services

Add custom services via `~/.wild-claude-pi/config.json` or `POST /api/dashboards`:

```json
{
  "id": "my-api",
  "name": "My API",
  "secretKey": "MY_API_KEY",
  "baseUrl": "https://api.example.com",
  "authHeader": "Bearer",
  "endpoints": [{ "id": "status", "name": "Status", "path": "/v1/status" }]
}
```

User-defined services with the same ID override built-in services. Secrets are auto-registered and appear in `/secrets`.

### API Endpoints

- `GET /api/dashboards` -- List all services with configuration status
- `GET /api/dashboards/:service/:endpoint` -- Fetch data from a service
- `POST /api/dashboards` -- Create/update a custom service
- `DELETE /api/dashboards/:service` -- Delete a user-defined service

## Dashboard

11-module dark-mode SPA served by Hono at port 3141 (default). Page loads a login screen; `DASHBOARD_TOKEN` is optional.

| Module | API Endpoint | Update Method |
|--------|-------------|---------------|
| Command Center | POST /api/chat | SSE /api/events |
| Memory Palace | GET /api/memories | On-demand |
| Mission Control | GET /api/missions | On-demand |
| Agent Hub | GET /api/agents | On-demand |
| Workflow Engine | GET /api/tasks | On-demand |
| Skills & MCP | GET /api/mcp | On-demand |
| System Vitals | GET /api/vitals | Poll 5s |
| Daily Journal | GET /api/conversations | On-demand |
| External Dashboards | GET /api/dashboards | On-demand |
| Live Activity | SSE /api/events | Real-time stream |
| Settings (Personality) | GET/PUT /api/personality | On-demand |

### Personality API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/personality` | Get current personality settings |
| `PUT` | `/api/personality` | Update personality settings |
| `GET` | `/api/personality/presets` | List all presets (built-in + user) |
| `POST` | `/api/personality/presets` | Save a new user preset |
| `DELETE` | `/api/personality/presets/:name` | Delete a user preset |
| `POST` | `/api/personality/preview` | Preview generated system prompt for given settings |
| `POST` | `/api/personality/apply` | Apply a named preset |

## Security Model

| Layer | Mechanism |
|-------|-----------|
| Telegram auth | `ALLOWED_CHAT_ID` whitelist |
| PIN lock | SHA-256 hash, idle auto-lock |
| Kill phrase | Emergency stop (works even when locked) |
| Audit log | Every action logged to SQLite |
| DB encryption | AES-256-GCM for sensitive messages |
| Secrets store | AES-256-GCM, file mode 0600 |
| Dashboard auth | Optional token (login screen on first load) |
| Claude permissions | bypassPermissions (trusted personal machine) |

## Deployment

### PC (Development)
```
wildclaude dev → localhost:3141
```

### PC / Server (Production)
```
wildclaude start → host-ip:3141
```

### Raspberry Pi / Linux (Auto-start)
```
wildclaude service install → systemd service → host-ip:3141
Requirements: Node.js 20+, SSD recommended for SQLite WAL
```

### Resource Budget (lightweight deployment, e.g. Raspberry Pi)
```
OS + system:            ~500MB
WildClaude:             ~300MB
SQLite databases:       ~100MB
Available headroom:     ~7GB+ (API-based AI, no local models)
```
