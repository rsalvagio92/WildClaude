# WildClaude Setup Guide

## Prerequisites

- **Node.js 20+** — [Download](https://nodejs.org/) (22 LTS recommended)
- **Git** — [Download](https://git-scm.com/)
- **Telegram Bot Token** (optional) — Create via [@BotFather](https://t.me/BotFather)

## Quick Start (recommended)

The bootstrap script handles everything automatically:

**Linux / macOS / Raspberry Pi:**
```bash
git clone https://github.com/rsalvagio92/WildClaude.git
cd WildClaude
bash scripts/bootstrap.sh
```

**Windows (PowerShell):**
```powershell
git clone https://github.com/rsalvagio92/WildClaude.git
cd WildClaude
powershell -ExecutionPolicy Bypass -File scripts\bootstrap.ps1
```

The bootstrap script will:

1. Check and install **Node.js 22** and **Claude CLI**
2. Open Claude login (browser auth with your Anthropic account)
3. Install dependencies and build
4. Ask: **AI backend** — Claude subscription or Anthropic API key
5. Ask: **Interface mode** — Telegram + Dashboard, Dashboard only, or skip
6. If Telegram: ask for bot token, auto-detect your chat ID
7. Launch WildClaude

### First run: onboarding wizard

On first launch, an interactive onboarding wizard runs in the terminal:

1. **Language selection** — English, Italiano, Espanol
2. **AI backend** — Claude subscription (via `claude login`) or Anthropic API key
3. **Import detection** — scans for OpenClaw, claude-mem, bOS, Claude Code data
4. **Profile** — name, location, languages, work style, goals, projects
5. **Bot personalization** — choose a name (default: "WildClaude") and personality preset
6. **Dashboard token** — auto-generated for web access

Files written:
- `~/.wild-claude-pi/life/me/_kernel/key.md` — your profile
- `~/.wild-claude-pi/life/goals/_kernel/key.md` — your goals
- `~/.wild-claude-pi/config.json` — bot identity + personality preset

You can skip (`n` or `skip`) and configure later from Telegram (`/start`) or the dashboard.

### Telegram onboarding

If you skip CLI onboarding, send any message to the bot in Telegram. It will start a 7-question onboarding flow: language, name, languages, work style, goals, projects, bot name, personality.

## Manual Setup

If you prefer not to use the bootstrap script:

```bash
git clone https://github.com/rsalvagio92/WildClaude.git
cd WildClaude
npm install
npm run build
cp .env.example .env
# Edit .env — set TELEGRAM_BOT_TOKEN at minimum
npm run dev
```

## AI Backend

WildClaude supports two modes for connecting to Claude:

| Mode | Auth | Cost | Setup |
|------|------|------|-------|
| **Subscription** (default) | `claude login` | Included in Claude Pro/Max | Install Claude CLI, run `claude login` |
| **API key** | `ANTHROPIC_API_KEY` | Pay per token | Get key from [console.anthropic.com](https://console.anthropic.com/settings/keys) |

**Subscription mode** (default): calls `claude -p --output-format stream-json` using your Claude Pro/Max subscription. No API key needed. Full streaming with tool-use events. Session resume across restarts.

**API mode**: set `ANTHROPIC_API_KEY` in `.env` or via `/set_secret`. The system automatically switches to the Anthropic SDK. Also enables Haiku-based message classification (~$0.001 per message).

Both modes can be selected during onboarding or changed later:
- Edit `.env` and add/remove `ANTHROPIC_API_KEY`
- Use `/set_secret ANTHROPIC_API_KEY` from Telegram
- Use Dashboard > Settings > Secrets

## CLI Tool

After cloning, install the CLI globally:

```bash
./wildclaude setup         # Linux/macOS/Pi — symlinks to /usr/local/bin
.\wildclaude setup         # Windows — copies to WindowsApps
```

Then from anywhere:

```bash
wildclaude start           # Start the bot
wildclaude stop            # Stop
wildclaude status          # Show status, versions, config
wildclaude upgrade         # Pull latest, rebuild, restart
wildclaude logs -f         # Follow logs
wildclaude config          # Edit .env
wildclaude dashboard       # Open dashboard URL
wildclaude service install # Auto-start on boot (systemd)
wildclaude reset           # Clear user data, re-run onboarding
wildclaude help            # Full command list
```

## Configuration

### Environment (.env)

Minimum:
```env
TELEGRAM_BOT_TOKEN=your_token_from_botfather
ALLOWED_CHAT_ID=               # Auto-detected by bootstrap, or get via /chatid
```

Auto-generated on first run (no manual setup needed):
```env
DB_ENCRYPTION_KEY=             # Database encryption (auto-generated)
DASHBOARD_TOKEN=               # Dashboard auth token (auto-generated)
```

Optional:
```env
ANTHROPIC_API_KEY=             # For API mode (skip for subscription mode)
GROQ_API_KEY=                  # Voice transcription (Whisper STT)
ELEVENLABS_API_KEY=            # Voice responses (TTS)
ELEVENLABS_VOICE_ID=           # Voice ID for TTS
DASHBOARD_PORT=3141            # Dashboard port (default: 3141)
```

### Verify

In Telegram:
- Send `hello` — should respond
- Send `/help` — lists all commands
- Send `/agents` — shows 17 agents grouped by lane
- Send `/status` — health check

Dashboard: `http://<your-ip>:3141` — accessible from your local network. Use [Tailscale](https://tailscale.com) to access from anywhere.

## Data Separation

Code and user data live in separate locations:

| Location | What lives there |
|----------|-----------------|
| `WildClaude/` (project repo) | Source code, agent/skill templates, life kernel templates |
| `~/.wild-claude-pi/` (user data) | Life data, memories, custom agents/skills, secrets, SQLite DB, config |

The user data dir is created automatically on first run. Override with `WILD_DATA_DIR=/custom/path`.

```
~/.wild-claude-pi/
├── config.json                # Bot identity, personality, preferences, automations
├── life/
│   ├── me/_kernel/key.md      # Identity, preferences (written by onboarding)
│   ├── me/_kernel/log.md      # Decision/activity log
│   ├── goals/_kernel/key.md   # Active goals
│   ├── health/_kernel/key.md  # Health profile
│   ├── finance/_kernel/key.md # Budget, accounts
│   └── learning/_kernel/key.md # Learning goals
├── memories/                  # Markdown memory files (YYYY-MM/YYYY-MM-DD-topic.md)
├── agents/                    # Custom agents (override project defaults)
├── skills/                    # Custom skills (override project defaults)
├── personalities/             # User-defined personality presets (.json)
├── session-handoffs/          # Session continuity files
├── store/                     # SQLite databases
├── secrets.enc.json           # Encrypted secrets (AES-256-GCM)
├── reflections.jsonl          # Self-reflection log
├── evolution.log.json         # Self-evolution log
└── CLAUDE.md                  # User-specific system prompt override
```

## Secrets Management

Secrets are stored encrypted in `~/.wild-claude-pi/secrets.enc.json` (AES-256-GCM). Resolution order:
1. Encrypted store (set via `/set_secret` or dashboard)
2. `.env` file
3. Environment variable

Manage from Telegram:
```
/secrets                   — see status of all secrets
/set_secret GROQ_API_KEY   — set a secret (encrypted)
/delete_secret GROQ_API_KEY — remove from store
```

Or from the dashboard: Settings > Secrets.

## Importing Previous Data

WildClaude imports from:
- **OpenClaw / NanoClaw** — SQLite DB + markdown files
- **ClaudeClaw** — DB, CLAUDE.md, memories
- **claude-mem** — SQLite DB (observations, session summaries)
- **bOS** — state markdown files (tasks, projects, notes, goals)
- **Claude Code** — `~/.claude/` memory files and CLAUDE.md
- **Generic** — any `.md` file or directory, `.json` export, `.db` SQLite

Import during onboarding (automatic) or afterwards:
```
/import               — scan for sources
/import all           — import everything found
/import 2             — import source #2
/import file /path    — import specific file
```

## Dashboard

11 modules, dark mode, real-time SSE updates.

URL: `http://<your-ip>:3141` — uses `DASHBOARD_TOKEN` for auth (auto-generated on first run).

Modules: Command Center, Memory Palace, Mission Control, Agent Hub, Workflow Engine, Skills & MCP, System Vitals, Daily Journal, External Dashboards, Live Activity, Settings.

## MCP Servers

31 servers in the registry across 8 categories. Install from Telegram or the dashboard:
```
/mcp               — list installed + available
/mcp_install notion — install Notion MCP
/mcp_remove notion  — remove
```

Or just ask the bot: "install Notion" — it will handle it.

## Overlay System

WildClaude uses an overlay system: `~/.wild-claude-pi/` overrides project defaults for agents, skills, dashboard services, and config.

- `git pull` never overwrites your data
- Custom agents/skills are portable (copy `~/.wild-claude-pi/`)
- Override any built-in by placing a file with the same name in the user directory

### Custom Agents
```
/create_agent devops build CI/CD pipeline management
```

### Custom Skills
```
/create_skill meal-plan Weekly meal planning with shopping list
```

### Custom Dashboard Services

Add to `~/.wild-claude-pi/config.json`:
```json
{
  "dashboards": [{
    "id": "my-api", "name": "My API", "secretKey": "MY_API_KEY",
    "baseUrl": "https://api.example.com", "authHeader": "Bearer",
    "endpoints": [{ "id": "status", "name": "Status", "path": "/v1/status" }]
  }]
}
```

Built-in services (Vercel, GitHub, Neon, Supabase, Stripe, Cloudflare, Sentry) are available by default — just set the API key.

## Personality

6 built-in presets, hot-reload from `config.json`:

| Preset | Tone | Humor | Emoji |
|--------|------|-------|-------|
| `default` | direct | 2 | off |
| `professional` | formal | 0 | off |
| `casual` | casual | 6 | on |
| `coach` | warm | 3 | off |
| `debug` | direct | 0 | off |
| `creative` | friendly | 5 | on |

Change from Telegram: `/personality casual`
Change from dashboard: Settings > Personality

Settings: `tone`, `responseLength`, `humor` (0-10), `emoji`, `language`, `pushback`, `customPrompt`.

## Session Continuity

- `/newchat` — saves handoff file, clears session
- `/respin` — injects last session as read-only context
- **Self-reflection** — corrections logged to `reflections.jsonl`, auto-injected into prompts

## Deployment

| Target | Command |
|--------|---------|
| **Dev** | `wildclaude dev` or `npm run dev` |
| **PC / server** | `wildclaude start` |
| **Raspberry Pi / Linux** | `wildclaude service install && wildclaude start` |

~300MB RAM, SQLite, API-based AI. Runs on a Raspberry Pi 4 (4GB+).

Use [Tailscale](https://tailscale.com) to access the dashboard from anywhere.

## Troubleshooting

### 409 Conflict Error
Another instance is polling with the same bot token:
```bash
wildclaude stop
# or: pkill -f "node dist/index.js"
```

### Claude not responding
Ensure you're logged in: `claude login`. Or set `ANTHROPIC_API_KEY` for API mode.

### Voice not working
Set `GROQ_API_KEY` (STT) and `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID` (TTS) via `/set_secret` or `.env`.

### Dashboard not accessible
Check the IP: `wildclaude dashboard`. Use [Tailscale](https://tailscale.com) for remote access.
