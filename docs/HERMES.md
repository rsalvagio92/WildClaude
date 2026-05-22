# Hermes Stack — feature index & activation guide

The Hermes Stack is the layer added to WildClaude in 2026-05 that promotes it from "personal AI OS" toward "definitive agentic tool". This document is the activation guide for every Hermes-tier feature, grouped by what it does for you. All features are **off-by-default unless noted** — set the relevant env var or run the install step to opt in.

## Contents

1. [Safety & programmatic execution](#safety--programmatic-execution)
2. [Memory & observability](#memory--observability)
3. [Workflows, debate, reflection](#workflows-debate-reflection)
4. [MCP servers](#mcp-servers)
5. [Interop & ecosystem](#interop--ecosystem)
6. [Auto-cron schedule](#auto-cron-schedule)
7. [Environment variables](#environment-variables)
8. [Telegram command index](#telegram-command-index)
9. [Database schema additions](#database-schema-additions)

---

## Safety & programmatic execution

### Sandbox
Three backends in [src/sandbox/](../src/sandbox/):
- `local` — current behaviour (no isolation)
- `local-scratch` — **default** — fresh scratch dir under `~/.wild-claude-pi/sandboxes/sb-<id>/`. Ralph runs here so it can't touch the bot's own source.
- `docker` — requires `npm i dockerode` + a running daemon. Bind-mounts the scratch dir to `/workspace`, `--network=none` by default.

**Activate docker mode:**
```bash
npm install dockerode @types/dockerode
docker build -t wildclaude/ralph-default sandbox-images/ralph-default/
# In .env:
SANDBOX_DEFAULT=docker
SANDBOX_DOCKER_IMAGE=wildclaude/ralph-default
```

### execute_code MCP
[src/tools/execute-code-mcp.ts](../src/tools/execute-code-mcp.ts) — JSON-RPC stdio MCP server that exposes a single `run` tool. Collapses multi-step plans into one inference.

**Activate:**
```json
// .mcp.json
{
  "mcpServers": {
    "execute_code": {
      "command": "node",
      "args": ["dist/tools/execute-code-mcp.js"]
    }
  }
}
```

The LLM gets `wc.read(p)`, `wc.write(p, content)`, `wc.exists(p)`, `wc.exec(cmd)`, `wc.log(...)`, `wc.workspace`. Path traversal blocked, `process` / `require` not in scope.

---

## Memory & observability

### Memory blocks ([src/memory-blocks.ts](../src/memory-blocks.ts))

Mem0-style scopes (`user` / `session` / `agent`) + Letta-style editable blocks. The `memory_blocks` table coexists with the legacy `memories` table:

| Table | Purpose | Lifecycle |
|---|---|---|
| `memories` | passive, scored, decayable, full-text searchable | written by message ingestion |
| `memory_blocks` | explicit, editable, scoped, optionally semantic | written by API / commands |

**Semantic search** kicks in automatically when `GOOGLE_API_KEY` is set. Embeddings are generated lazily on `createBlock()`, stored in the `embedding BLOB` column. Cosine similarity ≥ 0.55 is the relevance floor; keyword LIKE backfills.

**Multi-modal attachments** — `attachToBlock(id, { kind: 'image', path })` attaches a file. For images, an auto-caption is generated via Claude vision (if `ANTHROPIC_API_KEY` is configured) and appended to the body so semantic search can find the memory by image content.

**Commands:** `/whatdoyouknow about <topic>` · `/unlearn <topic>`

### Trace Inspector ([src/trace-inspector.ts](../src/trace-inspector.ts))

Assembles per-session traces from `conversation_log` + `token_usage` without adding any new tracing infrastructure. Dashboard module "Trace Inspector" shows:
- Last 30-day cost breakdown by agent + by day
- Recent sessions with turns / cost / cache-hits / duration
- Click a session → expanded timeline with each turn's role + content + token usage

**Timestamp convention:** legacy tables (memories / conversation_log / token_usage / audit_log) store `created_at` in seconds. New Hermes tables store ms. Normalisation happens at the API boundary (`toMs()` helper).

### TokenJuice ([src/token-juice.ts](../src/token-juice.ts))

Output compression layer. Wired into browser-mcp (`read_text`), vision-mcp (`extract_text`), and gmail-mcp (`read`). Compression pipeline:
- HTML → Markdown (drops script/style/svg)
- URL shortening (long URLs → `[linkN]` + reference table)
- `dedupAdjacent` ("X\nX\nX" → "X (× 3)")
- `normalizeWhitespace`
- `truncateMiddle` (head + tail with snipped marker)

Stats tracked in-memory + persisted in `digests` table. **Command:** `/tokenjuice`. **Dashboard:** top card on the Marketplace page.

### Cost budget ([src/cost-budget.ts](../src/cost-budget.ts))

Set `MONTHLY_BUDGET_USD=10` in `.env` to enable. Alerts at 80% / 100% (each once per month). `shouldDowngradeForBudget()` makes the router downgrade everything to Haiku once the cap is hit (soft-throttle).

**Command:** `/budget`. **Auto-cron:** daily at 09:00.

---

## Workflows, debate, reflection

### Workflows ([src/workflows.ts](../src/workflows.ts))

Declarative DAG engine. YAML files in `~/.wild-claude-pi/workflows/`:

```yaml
name: weekly-review
steps:
  - id: gather
    agent: data-analyst
    prompt: "summarize this week's commits + memories"
  - id: reflect
    agent: coach
    depends_on: [gather]
    prompt: |
      Given this summary:
      {{ gather.output }}
      What patterns or risks do you see?
  - id: notify
    depends_on: [reflect]
    telegram: "Weekly review ready:\n{{ reflect.output }}"
```

Cycle detection + topological execution + `{{step.output}}` interpolation + SQLite-checkpointed resumable runs. **Commands:** `/workflow list|run <name>|recent`.

### Debate ([src/debate.ts](../src/debate.ts))

N-round structured debate between two agents + Haiku synthesis. **Command:** `/debate critic coach should I quit my job`.

### Reflection ([src/reflection.ts](../src/reflection.ts))

Haiku-drafted daily/weekly pattern surfacing. Samples `conversation_log` + `tool_sequences` + `memories` + `mission_tasks` for the period; asks Haiku for a 60-word summary + up to 3 patterns. **Commands:** `/reflect today|week|recent`. **Auto-cron:** 08:30 daily, Sunday 19:00 weekly.

### Digest ([src/digest.ts](../src/digest.ts))

Pure-SQL rollup: new memories / tasks / runs / cost for a period. **Command:** `/digest day|week|month`. **Auto-cron:** 23:00 daily.

### Moods ([src/moods.ts](../src/moods.ts))

Time-aware personality modifiers (focus / work / evening / weekend / neutral) layered on top of the personality preset. The base personality stays the user's preset; moods append a directive to the system prompt. **Command:** `/mood [set <name>]`.

### Evals ([src/evals.ts](../src/evals.ts))

Declarative test cases:

```yaml
name: morning-routine
cases:
  - prompt: "what's on my schedule today?"
    expect:
      contains: ["focus", "blocked"]
      tools: ["Read", "Bash"]
  - prompt: "summarize last week"
    expect:
      contains_any: ["week", "summary"]
      min_length: 40
```

Drop in `~/.wild-claude-pi/evals/`. **Commands:** `/evals list|run <name>|recent`. **Dashboard:** Evals module.

### Auto-skill synthesis ([src/skill-synthesis.ts](../src/skill-synthesis.ts))

Canonical, PII-free hashing of tool sequences during normal turns. When a sequence shows up `SKILL_SYNTHESIS_MIN_REPETITIONS` (default 5) times within `SKILL_SYNTHESIS_WINDOW_DAYS` (default 14), Haiku drafts a SKILL.md proposal. **Commands:** `/skill_accept <hash>` · `/skill_reject <hash>`.

### Agent self-improvement ([src/agent-self-improvement.ts](../src/agent-self-improvement.ts))

Weekly cycle finds agents with ≥30% failure rate over 7 days, asks Opus for a conservative revision (Execution Protocol + Constraints only — keeps voice intact). User reviews via `/agent_improve list`, approves with `/agent_improve accept <file> <agent>`. Previous live file is backed up automatically.

### Fine-tuning pipeline ([src/finetune.ts](../src/finetune.ts))

`/finetune estimate` shows token count + cost. `/finetune build` writes the JSONL to `~/.wild-claude-pi/finetune/`. Submission gated by `FINETUNE_ENABLED=true` until Anthropic publishes the GA fine-tune spec.

---

## MCP servers

### Browser ([src/tools/browser-mcp.ts](../src/tools/browser-mcp.ts))
Playwright wrapper. Tools: `navigate`, `read_text`, `screenshot`, `click`. Allowlist via `~/.wild-claude-pi/config.json → browser.allowedHosts` or set `BROWSER_ALLOW_ALL=true`. **Activate:**
```bash
npm install playwright && npx playwright install chromium
```
```json
// .mcp.json
"browser": { "command": "node", "args": ["dist/tools/browser-mcp.js"] }
```

### Vision ([src/tools/vision-mcp.ts](../src/tools/vision-mcp.ts))
Claude vision. Tools: `describe`, `extract_text`, `answer`. Requires `ANTHROPIC_API_KEY`.

### Home Assistant ([src/integrations/home-assistant.ts](../src/integrations/home-assistant.ts))
HA REST API. Tools: `list_entities`, `get_state`, `call_service`, `turn_on/off`. Set `HOME_ASSISTANT_URL` + `HOME_ASSISTANT_TOKEN`.

### Gmail ([src/integrations/gmail.ts](../src/integrations/gmail.ts))
Gmail REST API. Tools: `list_unread`, `read`, `search`, `draft`, `send_draft`. Set `GMAIL_ACCESS_TOKEN`.

### Google Calendar ([src/integrations/google-calendar.ts](../src/integrations/google-calendar.ts))
Tools: `list_events`, `create_event`, `find_free_slot`, `update_event`, `delete_event`. Set `GCAL_ACCESS_TOKEN` (+ optional `GCAL_CALENDAR_ID`, default `primary`).

### Computer Use ([src/tools/computer-use-mcp.ts](../src/tools/computer-use-mcp.ts))
Desktop control. Tools: `screenshot`, `click`, `type`, `key`, `move`. **DISABLED by default.** To enable:
```bash
# .env
COMPUTER_USE_ENABLED=true
COMPUTER_USE_DRY_RUN=true   # log would-do actions without executing
COMPUTER_USE_RATE_PER_MIN=30
```
Linux requires `xdotool` (X11). macOS requires `cliclick`. Windows uses PowerShell + `System.Windows.Forms`. Every action is appended to `~/.wild-claude-pi/computer-use.audit.jsonl`.

---

## Interop & ecosystem

### ACP gateway

- **stdio** ([src/acp/server.ts](../src/acp/server.ts), entry [src/acp/index.ts](../src/acp/index.ts)) — for IDEs that spawn ACP servers as subprocesses (Zed, Cursor). Run with `npm run acp`. IDE config:
  ```json
  { "command": "node", "args": ["/path/to/WildClaude/dist/acp/index.js"] }
  ```
- **WebSocket** ([src/acp/ws-server.ts](../src/acp/ws-server.ts)) — for remote IDE plugins. Set `ACP_WS_PORT=3142` in `.env`. Token auth via `?token=$DASHBOARD_TOKEN`. Hand-rolled WS framing, no `ws` dep.

Methods: `initialize` · `session/new` · `session/prompt` (streams `session/text`) · `session/cancel` · `shutdown`.

### Trajectory export ([src/trajectory-export.ts](../src/trajectory-export.ts))

`/export trajectories [--since YYYY-MM-DD] [--limit N] [--raw] [--encrypt <pass>]`. PII scrubbing (emails / phones / API keys / IPv4 except localhost) by default. Chat IDs hashed (sha1, 12 chars). `--raw` bypasses both. `--encrypt` produces AES-256-GCM ciphertext (`salt | iv | authTag | ct`, key derived via scrypt).

### Skill import ([src/skill-import.ts](../src/skill-import.ts))

`/skill_install <name-or-url>` → preview → `/skill_confirm` to commit, or `/skill_cancel`. Strips python/shell scriptlets, adds `source:` annotation. Resolves bare slugs as `agentskills.io/skills/<slug>/SKILL.md`.

### Recommended skills ([src/recommended-skills.ts](../src/recommended-skills.ts))

Curated picks: book-to-skill, graphify, Skill_Seekers, awesome-agent-skills catalog, claude-skills-313. **Command:** `/recommended [tag]`. **Dashboard:** "Curated picks" card in Marketplace.

### Plugin SDK ([src/sdk/index.ts](../src/sdk/index.ts))

Public type exports for third-party plugin authors:
```ts
import type { Sandbox, MemoryBlock, WorkflowDefinition, EvalDefinition } from '@wildclaude/sdk';
```

### Litestream sync ([src/sync/litestream.ts](../src/sync/litestream.ts))

`/sync init` walks you through it. Generates `~/.wild-claude-pi/litestream.yml` for S3-backed SQLite replication. Only ONE device should run `replicate` at a time; restore on the second device when migrating.

### Real-time voice streaming ([src/voice-streaming.ts](../src/voice-streaming.ts))

ElevenLabs streaming TTS scaffold. Gated by `VOICE_STREAMING_ENABLED=true`. Sentence splitter + async-iterable bridge for `runAgent`'s `onStreamText`. Default voice flow remains batch (transcribe → full response → TTS → send).

---

## Auto-cron schedule

Sentinel prompts (`__internal:*`) dispatched by `scheduler.handleInternalSentinel` without LLM calls:

| Time | Task |
|---|---|
| 08:30 daily | `__internal:reflect:day` — Haiku reflection over last 24h |
| 09:00 daily | `__internal:budget:check` — cost budget alert if 80%/100% crossed |
| 23:00 daily | `__internal:digest:day` — period rollup |
| Sun 19:00 | `__internal:reflect:week` — Haiku reflection over last 7d |

To disable any of them: `/automations` in Telegram or edit `~/.wild-claude-pi/config.json` → `automations.disabled: ["auto-reflect-day", …]`.

---

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `SANDBOX_DEFAULT` | `local-scratch` | Sandbox backend (`local` / `local-scratch` / `docker`) |
| `SANDBOX_DOCKER_IMAGE` | `node:20-slim` | Image when `docker` backend |
| `SANDBOX_TIMEOUT_MS` | `300000` | Per-exec timeout |
| `SANDBOX_MEM_LIMIT_MB` | `512` | Docker memory cap |
| `SANDBOX_NETWORK` | `none` | Docker network mode |
| `SANDBOX_PRUNE_AGE_MS` | `604800000` (7d) | Auto-prune older scratch dirs |
| `SKILL_SYNTHESIS_ENABLED` | `true` | Tool-sequence proposer |
| `SKILL_SYNTHESIS_MIN_REPETITIONS` | `5` | |
| `SKILL_SYNTHESIS_WINDOW_DAYS` | `14` | |
| `SKILL_SYNTHESIS_MIN_TOOLS` | `3` | |
| `GOOGLE_API_KEY` | — | Enables semantic memory search (text-embedding-004) |
| `MONTHLY_BUDGET_USD` | `0` (disabled) | Monthly cost cap; soft-throttles to Haiku at 100% |
| `BROWSER_ALLOW_ALL` | `false` | Skip browser host allowlist |
| `HOME_ASSISTANT_URL` / `HOME_ASSISTANT_TOKEN` | — | HA MCP config |
| `GMAIL_ACCESS_TOKEN` | — | Gmail MCP config |
| `GCAL_ACCESS_TOKEN` / `GCAL_CALENDAR_ID` | — / `primary` | Calendar MCP config |
| `COMPUTER_USE_ENABLED` | `false` | Desktop control switch |
| `COMPUTER_USE_DRY_RUN` | `false` | Log would-do actions without executing |
| `COMPUTER_USE_RATE_PER_MIN` | `30` | Rate limit |
| `ACP_WS_PORT` | — (disabled) | WebSocket ACP transport port |
| `VOICE_STREAMING_ENABLED` | `false` | Real-time TTS streaming |
| `ELEVENLABS_MODEL_ID` | `eleven_turbo_v2_5` | TTS model |
| `FINETUNE_ENABLED` | `false` | Allow submission to Anthropic FT API |

---

## Telegram command index

See the full table in [CLAUDE.md](../CLAUDE.md#telegram-commands). Hermes-specific commands:

```
/sandbox              # status / prune / docker / test
/skill_install <ref>  # preview → /skill_confirm or /skill_cancel
/skill_accept <hash>  # auto-skill proposal
/skill_reject <hash>
/whatdoyouknow about <topic>
/unlearn <topic>
/evals run <name>
/workflow run <name>
/debate <agentA> <agentB> <topic>
/reflect [today|week|recent]
/digest [day|week|month]
/mood [set <name>]
/sync [status|init|configure]
/export trajectories [--encrypt <pass>]
/tokenjuice
/recommended [tag]
/budget
/agent_improve [list|run|accept|drop]
/finetune [estimate|build|submit]
```

---

## Database schema additions

CREATE IF NOT EXISTS in [src/db.ts](../src/db.ts) — fully backward-compatible with existing installs:

| Table | Purpose |
|---|---|
| `sandboxes` | per-run sandbox lifecycle |
| `tool_sequences` | canonical hashes of tool patterns + proposal status |
| `memory_blocks` | scoped + editable memory with embeddings + attachments |
| `evals` / `eval_runs` | declarative eval cases + results |
| `workflows` / `workflow_runs` | DAG definitions + step-state checkpoints |
| `reflections` | daily/weekly pattern records |
| `digests` | rollup snapshots + tokenjuice stats |
| `mood_log` | mood overrides over time |

Migration adds `memory_blocks.attachments` column to existing installs at startup.
