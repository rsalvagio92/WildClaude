#!/bin/bash
# WildClaude — One-Command Setup
#
# After cloning, run:  bash scripts/bootstrap.sh
#
# This single script handles EVERYTHING:
# 1. Checks/installs prerequisites (Node.js, Claude CLI)
# 2. Authenticates with Claude (opens browser)
# 3. Installs dependencies and builds
# 4. Prompts for Telegram bot token
# 5. Runs the app (which triggers onboarding wizard)

set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║        WildClaude — Setup            ║"
echo "  ╚══════════════════════════════════════╝"
echo ""
echo "  $(uname -s) $(uname -m)"
echo ""

# ── 1. Node.js ────────────────────────────────────────────────────
if command -v node &>/dev/null; then
    NODE_MAJOR=$(node --version | sed 's/v//' | cut -d. -f1)
    if [ "$NODE_MAJOR" -ge 20 ]; then
        ok "Node.js $(node --version)"
    else
        NEED_NODE=1
    fi
else
    NEED_NODE=1
fi

if [ "${NEED_NODE:-0}" = "1" ]; then
    echo "  Installing Node.js 22..."
    if command -v apt-get &>/dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/dev/null 2>&1
        sudo apt-get install -y nodejs >/dev/null 2>&1
    elif command -v dnf &>/dev/null; then
        curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash - >/dev/null 2>&1
        sudo dnf install -y nodejs >/dev/null 2>&1
    elif command -v brew &>/dev/null; then
        brew install node >/dev/null 2>&1
    else
        fail "Install Node.js 20+ manually: https://nodejs.org/"
    fi
    ok "Node.js $(node --version) installed"
fi

# ── 2. Claude CLI ─────────────────────────────────────────────────
CLAUDE_CMD=""
for cmd in claude "$HOME/.npm-global/bin/claude" /usr/local/bin/claude; do
    if [ -x "$(command -v $cmd 2>/dev/null)" ] || [ -x "$cmd" ]; then
        CLAUDE_CMD="$cmd"; break
    fi
done

if [ -n "$CLAUDE_CMD" ]; then
    ok "Claude CLI ($($CLAUDE_CMD --version 2>/dev/null || echo 'ok'))"
else
    echo "  Installing Claude CLI..."
    npm install -g @anthropic-ai/claude-code 2>/dev/null || {
        mkdir -p "$HOME/.npm-global"
        npm config set prefix "$HOME/.npm-global" 2>/dev/null
        export PATH="$HOME/.npm-global/bin:$PATH"
        npm install -g @anthropic-ai/claude-code 2>/dev/null
    }
    CLAUDE_CMD=$(command -v claude 2>/dev/null || echo "$HOME/.npm-global/bin/claude")
    ok "Claude CLI installed"
fi
export PATH="$HOME/.npm-global/bin:$PATH"

# ── 3. Claude auth ────────────────────────────────────────────────
if [ -d "$HOME/.claude" ] && ls "$HOME/.claude/"*.json &>/dev/null 2>&1; then
    ok "Claude authenticated"
else
    echo ""
    echo "  Claude needs to be authenticated with your Anthropic account."
    echo "  This will open a browser — log in and come back here."
    echo ""
    $CLAUDE_CMD login || warn "Login skipped. Run 'claude login' later before using the bot."
    echo ""
fi

# ── 4. Dependencies ───────────────────────────────────────────────
echo "  Installing dependencies..."
npm install 2>&1 | tail -1
ok "Dependencies installed"

echo "  Building..."
npm run build 2>&1 | tail -1
ok "Build complete"

# ── 5. Configuration ──────────────────────────────────────────────
if [ ! -f .env ]; then
    cp .env.example .env 2>/dev/null || echo "TELEGRAM_BOT_TOKEN=" > .env
fi

# ── 5a. AI Backend ───────────────────────────────────────────────
echo ""
echo "  How should WildClaude connect to Claude?"
echo ""
echo "    1. Claude subscription (via 'claude login' — recommended)"
echo "       Uses your existing Claude Pro/Max subscription."
echo "       Requires Claude CLI to be installed and logged in."
echo ""
echo "    2. Anthropic API key (pay-per-use)"
echo "       Uses the Anthropic API directly. You pay per token."
echo "       Get a key at: https://console.anthropic.com/settings/keys"
echo ""
read -p "  (1/2): " AI_MODE

if [ "$AI_MODE" = "2" ]; then
    CURRENT_API_KEY=$(grep "^ANTHROPIC_API_KEY=" .env | cut -d= -f2)
    if [ -z "$CURRENT_API_KEY" ]; then
        echo ""
        read -p "  Paste your Anthropic API key (sk-ant-...): " API_KEY
        if [ -n "$API_KEY" ]; then
            sed -i "s/^ANTHROPIC_API_KEY=.*/ANTHROPIC_API_KEY=$API_KEY/" .env
            ok "API key saved"
        else
            warn "No API key. Set ANTHROPIC_API_KEY in .env before running."
        fi
    else
        ok "Anthropic API key already configured"
    fi
else
    # Subscription mode — verify Claude CLI is logged in
    if [ -n "$CLAUDE_CMD" ]; then
        if [ -d "$HOME/.claude" ] && ls "$HOME/.claude/"*.json &>/dev/null 2>&1; then
            ok "Claude subscription mode (CLI authenticated)"
        else
            warn "Claude CLI not logged in. Run: claude login"
        fi
    else
        warn "Claude CLI not found. Install and log in: npm i -g @anthropic-ai/claude-code && claude login"
    fi
fi

# ── 5b. Interface mode ───────────────────────────────────────────
echo ""
echo "  WildClaude can be used via Telegram, the web dashboard, or both."
echo ""
echo "  How do you want to use it?"
echo "    1. Telegram + Dashboard (recommended)"
echo "    2. Dashboard only (no Telegram)"
echo "    3. Skip configuration (set up later)"
echo ""
read -p "  (1/2/3): " USE_MODE

if [ "$USE_MODE" = "3" ]; then
    warn "Configuration skipped. Edit .env and run: npm run dev"
elif [ "$USE_MODE" = "2" ]; then
    ok "Dashboard-only mode."
    echo "  The dashboard will be available at http://localhost:3141"
    echo "  Tokens are auto-generated on first run."
else
    # Telegram setup
    CURRENT_TOKEN=$(grep "^TELEGRAM_BOT_TOKEN=" .env | cut -d= -f2)
    if [ -z "$CURRENT_TOKEN" ]; then
        echo ""
        echo "  You need a Telegram bot token."
        echo "  Open Telegram → @BotFather → /newbot → copy the token."
        echo ""
        read -p "  Paste your bot token (or Enter to skip Telegram): " BOT_TOKEN
        if [ -n "$BOT_TOKEN" ]; then
            sed -i "s/^TELEGRAM_BOT_TOKEN=.*/TELEGRAM_BOT_TOKEN=$BOT_TOKEN/" .env
            ok "Bot token saved"
            CURRENT_TOKEN="$BOT_TOKEN"
        else
            warn "No Telegram token. Dashboard will still work."
        fi
    else
        ok "Bot token already configured"
    fi

    # Auto-detect Chat ID
    CURRENT_CHATID=$(grep "^ALLOWED_CHAT_ID=" .env | cut -d= -f2)
    if [ -z "$CURRENT_CHATID" ] && [ -n "$CURRENT_TOKEN" ]; then
        BOT_INFO=$(curl -s "https://api.telegram.org/bot${CURRENT_TOKEN}/getMe" 2>/dev/null)
        BOT_VALID=$(echo "$BOT_INFO" | python3 -c "import json,sys;d=json.load(sys.stdin);print('yes' if d.get('ok') else 'no')" 2>/dev/null)
        BOT_NAME=$(echo "$BOT_INFO" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('result',{}).get('username',''))" 2>/dev/null)

        if [ "$BOT_VALID" = "yes" ]; then
            ok "Bot verified: @$BOT_NAME"
            echo ""
            echo "  Send any message to @$BOT_NAME on Telegram (e.g. type 'hello')."
            echo "  Your chat ID will be detected automatically..."
            echo ""

            curl -s "https://api.telegram.org/bot${CURRENT_TOKEN}/getUpdates?offset=-1" >/dev/null 2>&1

            CHAT_ID=""
            for i in $(seq 1 12); do
                RESPONSE=$(curl -s "https://api.telegram.org/bot${CURRENT_TOKEN}/getUpdates?timeout=5&limit=1" 2>/dev/null)
                CHAT_ID=$(echo "$RESPONSE" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    if d.get('ok') and d.get('result'):
        print(d['result'][-1]['message']['chat']['id'])
except: pass
" 2>/dev/null)
                if [ -n "$CHAT_ID" ]; then
                    break
                fi
                printf "\r  Waiting... (%ds)" "$((i * 5))"
            done

            if [ -n "$CHAT_ID" ]; then
                echo ""
                sed -i "s/^ALLOWED_CHAT_ID=.*/ALLOWED_CHAT_ID=$CHAT_ID/" .env
                ok "Chat ID detected and saved: $CHAT_ID"
                ok "Only YOU can use this bot now."
                # Send welcome message
                curl -s -X POST "https://api.telegram.org/bot${CURRENT_TOKEN}/sendMessage" \
                  -d "chat_id=${CHAT_ID}" \
                  -d "text=Welcome to WildClaude! / Benvenuto! / ¡Bienvenido!

Select your language:
1. English
2. Italiano
3. Español

Reply with 1, 2 or 3" >/dev/null 2>&1
                ok "Welcome message sent to your Telegram!"
                curl -s "https://api.telegram.org/bot${CURRENT_TOKEN}/getUpdates?offset=-1" >/dev/null 2>&1
            else
                echo ""
                warn "Timeout. Send /chatid to the bot after starting, then add to .env."
            fi
        else
            warn "Bot token invalid. Check and update in .env."
        fi
    fi
fi

# ── 6. Launch ─────────────────────────────────────────────────────
echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║          Setup Complete!             ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

# Check if token is set before auto-launching
FINAL_TOKEN=$(grep "^TELEGRAM_BOT_TOKEN=" .env | cut -d= -f2)
if [ -n "$FINAL_TOKEN" ] && [ "$FINAL_TOKEN" != "your_token_from_botfather" ]; then
    echo "  Starting WildClaude..."
    echo "  (First run will ask you a few setup questions)"
    echo ""
    npm run dev
else
    echo "  To start WildClaude:"
    echo "    1. Edit .env: nano .env"
    echo "       Set TELEGRAM_BOT_TOKEN=your_token"
    echo "    2. Run: npm run dev"
    echo "    3. Send /chatid in Telegram, add to .env, restart"
    echo ""
fi
