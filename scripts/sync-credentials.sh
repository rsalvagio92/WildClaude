#!/usr/bin/env bash
# Propagate the primary's Claude CLI subscription credentials to the secondary
# machines. The OAuth access token is refreshed only on the primary (the
# actively-used machine); idle secondaries never refresh, so their copy of
# ~/.claude/.credentials.json expires and they start answering "Not logged in
# · Please run /login". Pushing the fresh file on a timer keeps them alive.
#
# Run by wc-cred-sync.timer (every 30 min). Idempotent; only copies when the
# local file is newer than what the secondary already has.
set -u

CRED="$HOME/.claude/.credentials.json"
HOSTS=("wb2" "wb3")

[ -f "$CRED" ] || { echo "no local credentials at $CRED"; exit 0; }

for host in "${HOSTS[@]}"; do
  # -p preserves mtime so the next run can skip if unchanged.
  if scp -p -o ConnectTimeout=10 -o BatchMode=yes "$CRED" "$host:~/.claude/.credentials.json" 2>/dev/null; then
    echo "synced credentials -> $host"
  else
    echo "WARN: failed to sync credentials -> $host"
  fi
done
