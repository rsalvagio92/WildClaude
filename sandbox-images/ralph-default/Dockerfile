# WildClaude default Ralph/exec sandbox image.
#
# Build:
#   docker build -t wildclaude/ralph-default sandbox-images/ralph-default/
#
# Then set in .env:
#   SANDBOX_DOCKER_IMAGE=wildclaude/ralph-default
#
# Includes:
#   - Node.js 20
#   - git, curl, ca-certificates, build-essential (for native deps)
#   - jq, ripgrep, fd (common agent tools)
#
# Does NOT include the Claude CLI — for now, WildClaude executes Bash inside the
# container but the Claude orchestration loop stays on the host. Tools like
# Write/Read/Edit operate on the host scratch dir (bind-mounted to /workspace).

FROM node:20-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      git \
      curl \
      ca-certificates \
      build-essential \
      jq \
      ripgrep \
      fd-find \
  && rm -rf /var/lib/apt/lists/*

# fd is installed as fd-find on Debian; create symlink for convenience.
RUN ln -sf $(which fdfind) /usr/local/bin/fd

WORKDIR /workspace

# Non-root user for safer execution. Bind-mount permissions match the host UID
# in most setups; for cross-host use, override at run time with --user.
RUN useradd -m -u 1000 sandbox && chown -R sandbox:sandbox /workspace
USER sandbox

CMD ["sleep", "infinity"]
