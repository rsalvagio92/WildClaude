#!/bin/bash
# WildClaude CLI — unified command-line interface
#
# Install globally:
#   sudo ln -sf $(pwd)/scripts/wildclaude.sh /usr/local/bin/wildclaude
#
# Usage:
#   wildclaude <command> [options]

set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }
info() { echo -e "  ${CYAN}→${NC} $1"; }

# Find project root (where package.json lives)
find_root() {
  # If WILDCLAUDE_DIR is set, use it
  if [ -n "$WILDCLAUDE_DIR" ]; then
    echo "$WILDCLAUDE_DIR"
    return
  fi
  # Check if we're inside the project
  local dir="$PWD"
  while [ "$dir" != "/" ]; do
    if [ -f "$dir/package.json" ] && grep -q '"wildclaude"' "$dir/package.json" 2>/dev/null; then
      echo "$dir"
      return
    fi
    dir=$(dirname "$dir")
  done
  # Common install locations
  for d in "$HOME/WildClaude" "$HOME/wildclaude" "/opt/wildclaude" "/opt/WildClaude"; do
    if [ -f "$d/package.json" ] && grep -q '"wildclaude"' "$d/package.json" 2>/dev/null; then
      echo "$d"
      return
    fi
  done
  echo ""
}

PROJECT_ROOT=$(find_root)
SERVICE_NAME="wildclaude"
DATA_DIR="${WILD_DATA_DIR:-$HOME/.wild-claude-pi}"

# Get local IP
get_ip() {
  hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost"
}

# Check if systemd service exists
has_service() {
  systemctl list-unit-files "$SERVICE_NAME.service" &>/dev/null 2>&1
}

# Check if running
is_running() {
  if has_service; then
    systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null
  elif [ -f "$DATA_DIR/store/${SERVICE_NAME}.pid" ]; then
    local pid=$(cat "$DATA_DIR/store/${SERVICE_NAME}.pid" 2>/dev/null)
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
  else
    pgrep -f "node.*dist/index.js" >/dev/null 2>&1
  fi
}

# ── Commands ─────────────────────────────────────────────────────────

cmd_install() {
  echo ""
  echo -e "  ${BOLD}WildClaude — Install${NC}"
  echo ""

  if [ -n "$PROJECT_ROOT" ] && [ -f "$PROJECT_ROOT/package.json" ]; then
    warn "WildClaude already installed at $PROJECT_ROOT"
    echo "  Use 'wildclaude upgrade' to update."
    echo ""
    return
  fi

  local install_dir="${1:-$HOME/WildClaude}"
  info "Installing to $install_dir..."

  git clone https://github.com/rsalvagio92/WildClaude.git "$install_dir"
  cd "$install_dir"
  bash scripts/bootstrap.sh
}

cmd_uninstall() {
  echo ""
  echo -e "  ${BOLD}WildClaude — Uninstall${NC}"
  echo ""

  if [ -z "$PROJECT_ROOT" ]; then
    fail "WildClaude not found."
  fi

  echo -e "  ${RED}This will remove:${NC}"
  echo "    - Project: $PROJECT_ROOT"
  echo "    - User data: $DATA_DIR"
  if has_service; then
    echo "    - Systemd service: $SERVICE_NAME"
  fi
  echo ""
  read -p "  Are you sure? (yes/no): " confirm
  if [ "$confirm" != "yes" ]; then
    echo "  Cancelled."
    return
  fi

  # Stop first
  cmd_stop 2>/dev/null || true

  # Remove systemd service
  if has_service; then
    sudo systemctl disable "$SERVICE_NAME" 2>/dev/null || true
    sudo rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
    sudo systemctl daemon-reload 2>/dev/null || true
    ok "Systemd service removed"
  fi

  # Remove project
  rm -rf "$PROJECT_ROOT"
  ok "Project removed: $PROJECT_ROOT"

  # Remove user data (ask separately)
  if [ -d "$DATA_DIR" ]; then
    read -p "  Also delete user data ($DATA_DIR)? (yes/no): " confirm_data
    if [ "$confirm_data" = "yes" ]; then
      rm -rf "$DATA_DIR"
      ok "User data removed"
    else
      warn "User data kept at $DATA_DIR"
    fi
  fi

  # Remove symlink
  if [ -L "/usr/local/bin/wildclaude" ]; then
    sudo rm -f /usr/local/bin/wildclaude
    ok "CLI symlink removed"
  fi

  echo ""
  ok "WildClaude uninstalled."
}

cmd_start() {
  if [ -z "$PROJECT_ROOT" ]; then
    fail "WildClaude not found. Run 'wildclaude install' first."
  fi

  if is_running; then
    warn "WildClaude is already running."
    return
  fi

  if has_service; then
    sudo systemctl start "$SERVICE_NAME"
    ok "WildClaude started (systemd)"
  else
    cd "$PROJECT_ROOT"
    nohup node dist/index.js > /tmp/wildclaude.log 2>&1 &
    ok "WildClaude started (PID: $!)"
    info "Logs: /tmp/wildclaude.log"
  fi

  local ip=$(get_ip)
  local port=$(grep "^DASHBOARD_PORT=" "$PROJECT_ROOT/.env" 2>/dev/null | cut -d= -f2)
  port=${port:-3141}
  info "Dashboard: http://$ip:$port"
}

cmd_stop() {
  if has_service; then
    sudo systemctl stop "$SERVICE_NAME"
    ok "WildClaude stopped"
  elif [ -f "$DATA_DIR/store/${SERVICE_NAME}.pid" ] || [ -f "$DATA_DIR/store/claudeclaw.pid" ]; then
    local pid=$(cat "$DATA_DIR/store/${SERVICE_NAME}.pid" 2>/dev/null || cat "$DATA_DIR/store/claudeclaw.pid" 2>/dev/null)
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null && ok "WildClaude stopped (PID: $pid)" || warn "Process $pid not found"
    fi
  else
    pkill -f "node.*dist/index.js" 2>/dev/null && ok "WildClaude stopped" || warn "WildClaude not running"
  fi
}

cmd_restart() {
  cmd_stop 2>/dev/null || true
  sleep 1
  cmd_start
}

cmd_status() {
  echo ""
  echo -e "  ${BOLD}WildClaude Status${NC}"
  echo ""

  # Project
  if [ -n "$PROJECT_ROOT" ]; then
    ok "Project: $PROJECT_ROOT"
    local version=$(node -e "console.log(require('$PROJECT_ROOT/package.json').version)" 2>/dev/null || echo "?")
    info "Version: $version"
  else
    warn "Project: not found"
  fi

  # User data
  if [ -d "$DATA_DIR" ]; then
    ok "User data: $DATA_DIR"
    local mem_count=$(find "$DATA_DIR/memories" -name "*.md" 2>/dev/null | wc -l)
    info "Memories: $mem_count files"
  else
    warn "User data: not initialized"
  fi

  # Running
  if is_running; then
    ok "Status: running"
    if has_service; then
      info "Mode: systemd service"
    else
      local pid=$(cat "$DATA_DIR/store/${SERVICE_NAME}.pid" 2>/dev/null)
      info "Mode: standalone (PID: ${pid:-unknown})"
    fi
  else
    warn "Status: stopped"
  fi

  # Network
  local ip=$(get_ip)
  local port=$(grep "^DASHBOARD_PORT=" "$PROJECT_ROOT/.env" 2>/dev/null | cut -d= -f2)
  port=${port:-3141}
  info "Dashboard: http://$ip:$port"

  # Telegram
  local token=$(grep "^TELEGRAM_BOT_TOKEN=" "$PROJECT_ROOT/.env" 2>/dev/null | cut -d= -f2)
  if [ -n "$token" ] && [ "$token" != "your_token_from_botfather" ]; then
    ok "Telegram: configured"
  else
    warn "Telegram: not configured"
  fi

  # AI backend
  local api_key=$(grep "^ANTHROPIC_API_KEY=" "$PROJECT_ROOT/.env" 2>/dev/null | cut -d= -f2)
  if [ -n "$api_key" ]; then
    info "AI backend: Anthropic API"
  else
    info "AI backend: Claude subscription (CLI)"
  fi

  # Claude CLI
  if command -v claude &>/dev/null; then
    ok "Claude CLI: $(claude --version 2>/dev/null || echo 'installed')"
  else
    warn "Claude CLI: not found"
  fi

  echo ""
}

cmd_upgrade() {
  if [ -z "$PROJECT_ROOT" ]; then
    fail "WildClaude not found. Run 'wildclaude install' first."
  fi

  echo ""
  echo -e "  ${BOLD}WildClaude — Upgrade${NC}"
  echo ""

  cd "$PROJECT_ROOT"

  # Check for changes
  local current=$(git rev-parse HEAD 2>/dev/null)
  git fetch origin master 2>/dev/null
  local remote=$(git rev-parse origin/master 2>/dev/null)

  if [ "$current" = "$remote" ]; then
    ok "Already up to date."
    return
  fi

  info "Updating from $(echo $current | head -c 7) to $(echo $remote | head -c 7)..."

  # Stop if running
  local was_running=false
  if is_running; then
    was_running=true
    cmd_stop
    sleep 1
  fi

  # Pull (use reset if pull fails — handles force-pushed history)
  if ! git pull origin master 2>&1 | tail -3; then
    git reset --hard origin/master 2>&1 | tail -1
  fi
  ok "Code updated"

  # Install deps (if package-lock changed)
  npm install 2>&1 | tail -1
  ok "Dependencies updated"

  # Build
  npm run build 2>&1 | tail -1
  ok "Build complete"

  # Restart if was running
  if [ "$was_running" = true ]; then
    cmd_start
  fi

  echo ""
  ok "Upgrade complete!"
}

cmd_logs() {
  if has_service; then
    local lines="${1:-50}"
    local follow="${2:-}"
    if [ "$follow" = "-f" ] || [ "$follow" = "--follow" ]; then
      journalctl -u "$SERVICE_NAME" -f
    else
      journalctl -u "$SERVICE_NAME" -n "$lines" --no-pager
    fi
  elif [ -f /tmp/wildclaude.log ]; then
    local follow="${1:-}"
    if [ "$follow" = "-f" ] || [ "$follow" = "--follow" ]; then
      tail -f /tmp/wildclaude.log
    else
      tail -50 /tmp/wildclaude.log
    fi
  else
    warn "No logs found. Is WildClaude running?"
  fi
}

cmd_config() {
  if [ -z "$PROJECT_ROOT" ]; then
    fail "WildClaude not found."
  fi
  local editor="${EDITOR:-nano}"
  if ! command -v "$editor" &>/dev/null; then
    editor="vi"
  fi
  "$editor" "$PROJECT_ROOT/.env"
}

cmd_reset() {
  echo ""
  echo -e "  ${BOLD}WildClaude — Reset${NC}"
  echo ""

  echo -e "  ${YELLOW}This will delete all user data and re-run onboarding:${NC}"
  echo "    - Life data (profile, goals, log)"
  echo "    - Memories"
  echo "    - Personalities"
  echo "    - Session handoffs"
  echo "    - Config (bot name, personality)"
  echo ""
  echo "  Secrets and database will be KEPT."
  echo ""
  read -p "  Continue? (yes/no): " confirm
  if [ "$confirm" != "yes" ]; then
    echo "  Cancelled."
    return
  fi

  # Stop if running
  if is_running; then
    cmd_stop
    sleep 1
  fi

  # Remove onboarding-related data only
  rm -rf "$DATA_DIR/life"
  rm -rf "$DATA_DIR/memories"
  rm -rf "$DATA_DIR/personalities"
  rm -rf "$DATA_DIR/session-handoffs"
  rm -f "$DATA_DIR/config.json"
  rm -f "$DATA_DIR/reflections.jsonl"
  rm -f "$DATA_DIR/evolution.log.json"
  ok "User data reset"

  echo "  Run 'wildclaude start' — onboarding will run again."
  echo ""
}

cmd_service_install() {
  if [ -z "$PROJECT_ROOT" ]; then
    fail "WildClaude not found."
  fi

  local user=$(whoami)
  local node_path=$(which node)

  sudo tee /etc/systemd/system/${SERVICE_NAME}.service > /dev/null <<EOF
[Unit]
Description=WildClaude Personal AI OS
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$user
WorkingDirectory=$PROJECT_ROOT
ExecStart=$node_path dist/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=HOME=$HOME
Environment=PATH=$HOME/.npm-global/bin:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=multi-user.target
EOF

  sudo systemctl daemon-reload
  sudo systemctl enable "$SERVICE_NAME"
  ok "Systemd service installed and enabled"
  info "Start with: wildclaude start"
  info "Auto-starts on boot"
}

cmd_service_uninstall() {
  if ! has_service; then
    warn "No systemd service found."
    return
  fi

  cmd_stop 2>/dev/null || true
  sudo systemctl disable "$SERVICE_NAME" 2>/dev/null || true
  sudo rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
  sudo systemctl daemon-reload
  ok "Systemd service removed"
}

cmd_dashboard() {
  local ip=$(get_ip)
  local port=$(grep "^DASHBOARD_PORT=" "$PROJECT_ROOT/.env" 2>/dev/null | cut -d= -f2)
  port=${port:-3141}
  echo ""
  echo "  Dashboard: http://$ip:$port"
  echo ""
  echo "  Access from anywhere with Tailscale: https://tailscale.com"
  echo ""
  # Try to open in browser
  if command -v xdg-open &>/dev/null; then
    xdg-open "http://$ip:$port" 2>/dev/null &
  elif command -v open &>/dev/null; then
    open "http://$ip:$port" 2>/dev/null &
  fi
}

cmd_dev() {
  if [ -z "$PROJECT_ROOT" ]; then
    fail "WildClaude not found."
  fi
  cd "$PROJECT_ROOT"
  npm run dev
}

cmd_build() {
  if [ -z "$PROJECT_ROOT" ]; then
    fail "WildClaude not found."
  fi
  cd "$PROJECT_ROOT"
  npm run build
  ok "Build complete"
}

cmd_setup() {
  if [ -z "$PROJECT_ROOT" ]; then
    fail "Run this from the WildClaude project directory."
  fi

  local target="/usr/local/bin/wildclaude"
  local source="$PROJECT_ROOT/wildclaude"

  if [ ! -f "$source" ]; then
    source="$PROJECT_ROOT/scripts/wildclaude.sh"
  fi

  # Make executable
  chmod +x "$source" 2>/dev/null || true
  chmod +x "$PROJECT_ROOT/scripts/wildclaude.sh" 2>/dev/null || true

  if [ -w "/usr/local/bin" ]; then
    ln -sf "$source" "$target"
  else
    sudo ln -sf "$source" "$target"
  fi

  ok "CLI installed globally: wildclaude"
  info "Run 'wildclaude help' from anywhere"
}

cmd_help() {
  echo ""
  echo -e "  ${BOLD}WildClaude CLI${NC}"
  echo ""
  echo "  Usage: wildclaude <command> [options]"
  echo ""
  echo -e "  ${BOLD}Setup${NC}"
  echo "    setup               Install CLI globally (adds 'wildclaude' to PATH)"
  echo "    install [dir]       Clone and set up WildClaude"
  echo "    uninstall           Remove WildClaude completely"
  echo "    upgrade             Pull latest code, rebuild, restart"
  echo "    reset               Reset user data (re-run onboarding)"
  echo ""
  echo -e "  ${BOLD}Running${NC}"
  echo "    start               Start WildClaude"
  echo "    stop                Stop WildClaude"
  echo "    restart             Stop + start"
  echo "    status              Show status, config, versions"
  echo "    dev                 Start in development mode (auto-reload)"
  echo "    build               Rebuild TypeScript"
  echo ""
  echo -e "  ${BOLD}System${NC}"
  echo "    logs [-f]           Show logs (-f to follow)"
  echo "    config              Edit .env in your editor"
  echo "    dashboard           Open dashboard URL"
  echo "    service install     Install systemd service (auto-start on boot)"
  echo "    service uninstall   Remove systemd service"
  echo ""
  echo -e "  ${BOLD}Environment${NC}"
  echo "    WILDCLAUDE_DIR      Override project directory"
  echo "    WILD_DATA_DIR       Override user data directory"
  echo ""
  echo "  https://github.com/rsalvagio92/WildClaude"
  echo ""
}

# ── Main ─────────────────────────────────────────────────────────────

case "${1:-help}" in
  setup)      cmd_setup ;;
  install)    cmd_install "$2" ;;
  uninstall)  cmd_uninstall ;;
  start)      cmd_start ;;
  stop)       cmd_stop ;;
  restart)    cmd_restart ;;
  status)     cmd_status ;;
  upgrade|update) cmd_upgrade ;;
  logs|log)   shift; cmd_logs "$@" ;;
  config)     cmd_config ;;
  reset)      cmd_reset ;;
  dashboard|dash|ui) cmd_dashboard ;;
  dev)        cmd_dev ;;
  build)      cmd_build ;;
  service)
    case "${2:-}" in
      install)   cmd_service_install ;;
      uninstall) cmd_service_uninstall ;;
      *)         echo "  Usage: wildclaude service [install|uninstall]" ;;
    esac
    ;;
  help|--help|-h) cmd_help ;;
  version|--version|-v)
    if [ -n "$PROJECT_ROOT" ]; then
      node -e "console.log('WildClaude v' + require('$PROJECT_ROOT/package.json').version)" 2>/dev/null || echo "WildClaude (version unknown)"
    else
      echo "WildClaude (not installed)"
    fi
    ;;
  *)
    echo -e "  ${RED}Unknown command: $1${NC}"
    echo "  Run 'wildclaude help' for usage."
    exit 1
    ;;
esac
