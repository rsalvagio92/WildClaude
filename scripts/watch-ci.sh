#!/bin/bash
# Watch a GitHub Actions run to completion and notify on Telegram — detached,
# survives the agent session that launched it (the Monitor tool dies on
# session teardown; this does not).
#
# Usage:
#   scripts/watch-ci.sh <RUN_ID> [REPO] [--apk-artifact]
#
#   RUN_ID          GitHub Actions run id to watch
#   REPO            owner/repo (default: rsalvagio92/WildClaude)
#   --apk-artifact  on success, download the APK artifact, copy it to the
#                   local APK server dir, ensure the server is up, and send
#                   the install link instead of a plain success message
#
# Launch detached:  nohup scripts/watch-ci.sh 123456 >/tmp/watch-ci.log 2>&1 &
#
# Reads the GitHub token from the git credential helper and Telegram creds
# via scripts/notify.sh (.env: TELEGRAM_BOT_TOKEN + ALLOWED_CHAT_ID).

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RUN_ID="${1:?usage: watch-ci.sh <RUN_ID> [REPO] [--apk-artifact]}"
REPO="${2:-rsalvagio92/WildClaude}"
APK_MODE=false
for a in "$@"; do [ "$a" = "--apk-artifact" ] && APK_MODE=true; done

APK_SERVE_DIR="/tmp/apk-serve"
APK_PORT="9877"
TAILSCALE_IP="100.68.24.30"
POLL_INTERVAL=30
MAX_POLLS=60   # 30s * 60 = 30 min ceiling

notify() { "$SCRIPT_DIR/notify.sh" "$1"; }

GH_TOKEN=$(printf "protocol=https\nhost=github.com\n\n" | git -C "$REPO_ROOT" credential fill 2>/dev/null | grep password | cut -d= -f2)
export GH_TOKEN

start_apk_server() {
  curl -sI "http://localhost:${APK_PORT}/wildclaude.apk" >/dev/null 2>&1 && return 0
  cd "$APK_SERVE_DIR" || return 1
  nohup python3 -c "
import http.server, socketserver, os
class H(http.server.SimpleHTTPRequestHandler):
    def guess_type(self, p):
        return 'application/vnd.android.package-archive' if p.endswith('.apk') else super().guess_type(p)
os.chdir('${APK_SERVE_DIR}')
socketserver.TCPServer(('0.0.0.0', ${APK_PORT}), H).serve_forever()
" >/tmp/apk-server.log 2>&1 &
}

for i in $(seq 1 "$MAX_POLLS"); do
  S=$(gh run view "$RUN_ID" --repo "$REPO" --json status,conclusion 2>/dev/null)
  ST=$(echo "$S" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
  if [ "$ST" = "completed" ]; then
    CC=$(echo "$S" | grep -o '"conclusion":"[^"]*"' | cut -d'"' -f4)
    if [ "$CC" != "success" ]; then
      ERR=$(gh run view "$RUN_ID" --repo "$REPO" --log 2>/dev/null \
            | grep -iE "error:|Error:|Cannot find|FAILED|npm error" \
            | grep -v "deprecated\|w: file\|DeprecationWarning" \
            | tail -3 | sed 's/^[^ ]*[ \t]*//' | head -c 400)
      notify "❌ CI fallita (run ${RUN_ID})
${ERR}"
      exit 0
    fi
    if [ "$APK_MODE" = true ]; then
      mkdir -p "$APK_SERVE_DIR"
      rm -rf /tmp/ci-artifact && gh run download "$RUN_ID" --repo "$REPO" --dir /tmp/ci-artifact 2>/dev/null
      APK=$(find /tmp/ci-artifact -name "*.apk" 2>/dev/null | head -1)
      if [ -n "$APK" ]; then
        cp "$APK" "$APK_SERVE_DIR/wildclaude.apk"
        start_apk_server
        SZ=$(du -h "$APK_SERVE_DIR/wildclaude.apk" | cut -f1)
        notify "✅ APK pronto (run ${RUN_ID})

📱 http://${TAILSCALE_IP}:${APK_PORT}/wildclaude.apk
Size: ${SZ}

• Tailscale attivo
• Apri in Chrome (non browser Telegram)
• Consenti origini sconosciute"
      else
        notify "⚠️ CI ok ma artifact APK non trovato (run ${RUN_ID})."
      fi
    else
      notify "✅ CI completata con successo (run ${RUN_ID})."
    fi
    exit 0
  fi
  sleep "$POLL_INTERVAL"
done

notify "⏱️ CI ancora in corso dopo $((MAX_POLLS * POLL_INTERVAL / 60)) min (run ${RUN_ID}) — controlla manualmente."
