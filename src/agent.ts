import { query } from '@anthropic-ai/claude-agent-sdk';
import { spawn, execSync } from 'child_process';

import { PROJECT_ROOT, agentCwd } from './config.js';
import { readEnvFile } from './env.js';
import { logger } from './logger.js';

// ── Direct CLI mode ──────────────────────────────────────────────────
// Uses `claude -p` directly instead of the Agent SDK.
// This uses the subscription auth from ~/.claude/ and avoids
// the "third-party app" usage limits.

/** Find the claude CLI binary. */
function findClaudeCli(): string {
  const candidates = [
    'claude',
    '/usr/local/bin/claude',
    `${process.env.HOME}/.npm-global/bin/claude`,
    '/home/gighy/.npm-global/bin/claude',
  ];
  for (const cmd of candidates) {
    try {
      execSync(`${cmd} --version`, { stdio: 'pipe', timeout: 5000 });
      return cmd;
    } catch { /* not found */ }
  }
  return 'claude'; // fallback
}

let claudeCliPath: string | null = null;

/**
 * Run a message through the Claude CLI directly (subscription mode).
 * Falls back to SDK if CLI is not available.
 */
async function runAgentDirect(
  message: string,
  sessionId: string | undefined,
  onTyping: () => void,
  onProgress?: (event: AgentProgressEvent) => void,
  model?: string,
  abortController?: AbortController,
  onStreamText?: (accumulatedText: string) => void,
  appendSystemPrompt?: string,
): Promise<AgentResult> {
  if (!claudeCliPath) {
    claudeCliPath = findClaudeCli();
    try {
      execSync(`${claudeCliPath} --version`, { stdio: 'pipe', timeout: 5000 });
      logger.info({ cli: claudeCliPath }, 'Using direct Claude CLI (subscription mode)');
    } catch {
      claudeCliPath = null;
      throw new Error('Claude CLI not available');
    }
  }

  const cwd = agentCwd ?? (process.env.HOME || process.env.USERPROFILE || PROJECT_ROOT);

  const args = [
    '-p', message,
    '--output-format', 'stream-json',
    '--verbose',
  ];

  if (sessionId) args.push('--resume', sessionId);
  if (model) args.push('--model', model);
  if (appendSystemPrompt) args.push('--append-system-prompt', appendSystemPrompt);
  args.push('--max-turns', '50');
  args.push('--dangerously-skip-permissions');

  return new Promise<AgentResult>((resolve, reject) => {
    logger.info({ sessionId: sessionId ?? 'new', messageLen: message.length, mode: 'direct-cli' }, 'Starting agent query (direct CLI)');

    const typingInterval = setInterval(onTyping, 4000);
    let buffer = '';
    let newSessionId: string | undefined = sessionId;
    let resultText: string | null = null;
    let usage: UsageInfo | null = null;

    const proc = spawn(claudeCliPath!, args, {
      cwd,
      env: { ...process.env, PATH: `${process.env.HOME}/.npm-global/bin:${process.env.PATH}` },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Close stdin immediately — message is passed via -p flag, not stdin
    proc.stdin.end();

    if (abortController) {
      abortController.signal.addEventListener('abort', () => proc.kill('SIGTERM'));
    }

    // Parse NDJSON stream for events
    proc.stdout.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);

          if (event.type === 'system' && event.subtype === 'init' && event.session_id) {
            newSessionId = event.session_id;
          }

          // Tool use events — forward as progress
          if (event.type === 'assistant' && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === 'tool_use' && block.name && onProgress) {
                let detail = toolLabel(block.name);
                const input = block.input;
                if (input) {
                  if (block.name === 'Read' && input.file_path) detail += `: ${input.file_path}`;
                  else if (block.name === 'Write' && input.file_path) detail += `: ${input.file_path}`;
                  else if (block.name === 'Edit' && input.file_path) detail += `: ${input.file_path}`;
                  else if (block.name === 'Bash' && input.command) detail += `: ${String(input.command)}`;
                  else if (block.name === 'Agent' && input.description) detail += `: ${input.description}`;
                }
                onProgress({ type: 'tool_active', description: detail });
              }
              if (block.type === 'text' && block.text && onStreamText) {
                onStreamText(block.text);
              }
            }
          }

          // Sub-agent events
          if (event.type === 'system' && event.subtype === 'task_started' && onProgress) {
            onProgress({ type: 'task_started', description: event.description ?? 'Sub-agent started' });
          }
          if (event.type === 'system' && event.subtype === 'task_notification' && onProgress) {
            onProgress({ type: 'task_completed', description: event.summary ?? 'Sub-agent finished' });
          }

          // Final result
          if (event.type === 'result') {
            resultText = event.result ?? null;
            newSessionId = event.session_id || newSessionId;
            if (event.usage) {
              usage = {
                inputTokens: event.usage.input_tokens ?? 0,
                outputTokens: event.usage.output_tokens ?? 0,
                cacheReadInputTokens: event.usage.cache_read_input_tokens ?? 0,
                totalCostUsd: event.total_cost_usd ?? 0,
                didCompact: false,
                preCompactTokens: null,
                lastCallCacheRead: event.usage.cache_read_input_tokens ?? 0,
                lastCallInputTokens: event.usage.input_tokens ?? 0,
              };
            }
          }
        } catch { /* skip malformed JSON lines */ }
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      const msg = data.toString();
      // Log all stderr for debugging
      if (msg.trim()) {
        logger.warn({ stderr: msg.slice(0, 500), mode: 'direct-cli' }, 'Claude CLI stderr');
      }
      if (msg.includes('Third-party') || msg.includes('LLM request rejected')) {
        proc.kill('SIGTERM');
        reject(new Error('Claude CLI rejected: ' + msg.slice(0, 200)));
      }
    });

    proc.on('close', (code) => {
      clearInterval(typingInterval);

      logger.info(
        { mode: 'direct-cli', hasResult: !!resultText, code, sessionId: newSessionId, cost: usage?.totalCostUsd },
        'Agent result received (direct CLI)',
      );

      // If CLI failed with a session resume, retry without --resume
      // (stale session IDs from old installs cause code 1)
      if (code !== 0 && !resultText && sessionId) {
        logger.warn({ sessionId, code }, 'CLI failed with session resume, retrying without --resume');
        const retryArgs = args.filter(a => a !== '--resume' && a !== sessionId);
        const retry = spawn(claudeCliPath!, retryArgs, {
          cwd,
          env: { ...process.env, PATH: `${process.env.HOME}/.npm-global/bin:${process.env.PATH}` },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        retry.stdin.end();

        // Connect abort controller to retry process
        if (abortController) {
          abortController.signal.addEventListener('abort', () => retry.kill('SIGTERM'));
        }

        let retryBuf = '';
        let retryResult: string | null = null;
        let retrySessionId: string | undefined;
        let retryUsage: UsageInfo | null = null;

        retry.stdout.on('data', (data: Buffer) => {
          retryBuf += data.toString();
          const lines = retryBuf.split('\n');
          retryBuf = lines.pop() || '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line);
              if (event.type === 'system' && event.session_id) retrySessionId = event.session_id;
              if (event.type === 'result') {
                retryResult = event.result ?? null;
                retrySessionId = event.session_id || retrySessionId;
                if (event.usage) {
                  retryUsage = {
                    inputTokens: event.usage.input_tokens ?? 0,
                    outputTokens: event.usage.output_tokens ?? 0,
                    cacheReadInputTokens: event.usage.cache_read_input_tokens ?? 0,
                    totalCostUsd: event.total_cost_usd ?? 0,
                    didCompact: false,
                    preCompactTokens: null,
                    lastCallCacheRead: event.usage.cache_read_input_tokens ?? 0,
                    lastCallInputTokens: event.usage.input_tokens ?? 0,
                  };
                }
              }
            } catch { /* skip */ }
          }
        });
        retry.stderr.on('data', (data: Buffer) => {
          const msg = data.toString();
          if (msg.trim()) logger.warn({ stderr: msg.slice(0, 500), mode: 'direct-cli-retry' }, 'Claude CLI stderr (retry)');
        });
        retry.on('close', (retryCode) => {
          logger.info({ mode: 'direct-cli-retry', hasResult: !!retryResult, code: retryCode }, 'Retry result');
          resolve({ text: retryResult, newSessionId: retrySessionId, usage: retryUsage });
        });
        retry.on('error', () => resolve({ text: null, newSessionId, usage: null }));
        return;
      }

      resolve({
        text: resultText,
        newSessionId,
        usage,
      });
    });

    proc.on('error', (err) => {
      clearInterval(typingInterval);
      reject(err);
    });
  });
}

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  totalCostUsd: number;
  /** True if the SDK auto-compacted context during this turn */
  didCompact: boolean;
  /** Token count before compaction (if it happened) */
  preCompactTokens: number | null;
  /**
   * The cache_read_input_tokens from the LAST API call in the turn.
   * Unlike the cumulative cacheReadInputTokens, this reflects the actual
   * context window size (cumulative overcounts on multi-step tool-use turns).
   */
  lastCallCacheRead: number;
  /**
   * The input_tokens from the LAST API call in the turn.
   * This is the actual context window size: system prompt + conversation
   * history + tool results for that call. Use this for context warnings.
   */
  lastCallInputTokens: number;
}

/** Progress event emitted during agent execution for Telegram feedback. */
export interface AgentProgressEvent {
  type: 'task_started' | 'task_completed' | 'tool_active';
  description: string;
}

/** Map SDK tool names to human-readable labels. */
const TOOL_LABELS: Record<string, string> = {
  Read: 'Reading file',
  Write: 'Writing file',
  Edit: 'Editing file',
  Bash: 'Running command',
  Grep: 'Searching code',
  Glob: 'Finding files',
  WebSearch: 'Web search',
  WebFetch: 'Fetching page',
  Agent: 'Sub-agent',
  NotebookEdit: 'Editing notebook',
  AskUserQuestion: 'User question',
};

function toolLabel(toolName: string): string {
  if (TOOL_LABELS[toolName]) return TOOL_LABELS[toolName];
  // MCP tools: mcp__server__tool → "server: tool"
  if (toolName.startsWith('mcp__')) {
    const parts = toolName.split('__');
    return parts.length >= 3 ? `${parts[1]}: ${parts.slice(2).join(' ')}` : toolName;
  }
  return toolName;
}

export interface AgentResult {
  text: string | null;
  newSessionId: string | undefined;
  usage: UsageInfo | null;
  aborted?: boolean;
}

/**
 * A minimal AsyncIterable that yields a single user message then closes.
 * This is the format the Claude Agent SDK expects for its `prompt` parameter.
 * The SDK drives the agentic loop internally (tool use, multi-step reasoning)
 * and surfaces a final `result` event when done.
 */
async function* singleTurn(text: string): AsyncGenerator<{
  type: 'user';
  message: { role: 'user'; content: string };
  parent_tool_use_id: null;
  session_id: string;
}> {
  yield {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
    session_id: '',
  };
}

/**
 * Run a single user message through Claude Code and return the result.
 *
 * Uses `resume` to continue the same session across Telegram messages,
 * giving Claude persistent context without re-sending history.
 *
 * Auth: The SDK spawns the `claude` CLI subprocess which reads OAuth auth
 * from ~/.claude/ automatically (the same auth used in the terminal).
 * No explicit token needed if you're already logged in via `claude login`.
 * Optionally override with CLAUDE_CODE_OAUTH_TOKEN in .env.
 *
 * @param message    The user's text (may include transcribed voice prefix)
 * @param sessionId  Claude Code session ID to resume, or undefined for new session
 * @param onTyping   Called every TYPING_REFRESH_MS while waiting — sends typing action to Telegram
 * @param onProgress Called when sub-agents start/complete — sends status updates to Telegram
 */
export async function runAgent(
  message: string,
  sessionId: string | undefined,
  onTyping: () => void,
  onProgress?: (event: AgentProgressEvent) => void,
  model?: string,
  abortController?: AbortController,
  onStreamText?: (accumulatedText: string) => void,
  appendSystemPrompt?: string,
): Promise<AgentResult> {
  // Try direct CLI first (uses subscription, avoids third-party limits)
  // Falls back to SDK if CLI fails or ANTHROPIC_API_KEY is set (explicit API mode)
  const secrets = readEnvFile(['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']);
  if (!secrets.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    try {
      return await runAgentDirect(message, sessionId, onTyping, onProgress, model, abortController, onStreamText, appendSystemPrompt);
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Direct CLI failed, falling back to SDK');
    }
  }

  // SDK mode (when ANTHROPIC_API_KEY is set or CLI is unavailable)

  const sdkEnv: Record<string, string | undefined> = { ...process.env };
  if (secrets.CLAUDE_CODE_OAUTH_TOKEN) {
    sdkEnv.CLAUDE_CODE_OAUTH_TOKEN = secrets.CLAUDE_CODE_OAUTH_TOKEN;
  }
  if (secrets.ANTHROPIC_API_KEY) {
    sdkEnv.ANTHROPIC_API_KEY = secrets.ANTHROPIC_API_KEY;
  }

  let newSessionId: string | undefined;
  let resultText: string | null = null;
  let usage: UsageInfo | null = null;
  let didCompact = false;
  let preCompactTokens: number | null = null;
  let lastCallCacheRead = 0;
  let lastCallInputTokens = 0;
  let streamedText = '';

  // Refresh typing indicator on an interval while Claude works.
  // Telegram's "typing..." action expires after ~5s.
  const typingInterval = setInterval(onTyping, 4000);

  try {
    logger.info(
      { sessionId: sessionId ?? 'new', messageLen: message.length },
      'Starting agent query',
    );

    for await (const event of query({
      prompt: singleTurn(message),
      options: {
        // cwd = agent directory (if running as agent) or user's home.
        // NEVER use PROJECT_ROOT — Claude Code would modify the bot's own source.
        // Use the user's home directory as workspace. Claude Code loads
        // CLAUDE.md from ~/.wild-claude-pi/ via settingSources.
        cwd: agentCwd ?? (process.env.HOME || process.env.USERPROFILE || PROJECT_ROOT),

        // Resume the previous session for this chat (persistent context)
        resume: sessionId,

        // 'project' loads CLAUDE.md from cwd; 'user' loads ~/.claude/skills/ and user settings
        settingSources: ['project', 'user'],

        // Skip all permission prompts — this is a trusted personal bot on your own machine
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,

        // Pass secrets to the subprocess without polluting our own process.env
        env: sdkEnv,

        // Stream partial text so Telegram can show progressive updates
        includePartialMessages: !!onStreamText,

        // Model override (e.g. 'claude-haiku-4-5', 'claude-sonnet-4-5')
        ...(model ? { model } : {}),

        // Abort support — signals the SDK to kill the subprocess
        ...(abortController ? { abortController } : {}),
      },
    })) {
      const ev = event as Record<string, unknown>;

      if (ev['type'] === 'system' && ev['subtype'] === 'init') {
        newSessionId = ev['session_id'] as string;
        logger.info({ newSessionId }, 'Session initialized');
      }

      // Detect auto-compaction (context window was getting full)
      if (ev['type'] === 'system' && ev['subtype'] === 'compact_boundary') {
        didCompact = true;
        const meta = ev['compact_metadata'] as { trigger: string; pre_tokens: number } | undefined;
        preCompactTokens = meta?.pre_tokens ?? null;
        logger.warn(
          { trigger: meta?.trigger, preCompactTokens },
          'Context window compacted',
        );
      }

      // Track per-call token usage and detect tool use from assistant message events.
      // Each assistant message represents one API call; its usage reflects
      // that single call's context size (not cumulative across the turn).
      if (ev['type'] === 'assistant') {
        const msg = ev['message'] as Record<string, unknown> | undefined;
        const msgUsage = msg?.['usage'] as Record<string, number> | undefined;
        const callCacheRead = msgUsage?.['cache_read_input_tokens'] ?? 0;
        const callInputTokens = msgUsage?.['input_tokens'] ?? 0;
        if (callCacheRead > 0) {
          lastCallCacheRead = callCacheRead;
        }
        if (callInputTokens > 0) {
          lastCallInputTokens = callInputTokens;
        }

        // Extract tool_use blocks from assistant content for progress reporting
        if (onProgress) {
          const content = msg?.['content'] as Array<{ type: string; name?: string; input?: Record<string, unknown> }> | undefined;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'tool_use' && block.name) {
                let detail = toolLabel(block.name);
                const input = block.input;
                if (input) {
                  if (block.name === 'Read' && input.file_path) detail += `: ${input.file_path}`;
                  else if (block.name === 'Write' && input.file_path) detail += `: ${input.file_path}`;
                  else if (block.name === 'Edit' && input.file_path) detail += `: ${input.file_path}`;
                  else if (block.name === 'Bash' && input.command) detail += `: ${String(input.command)}`;
                  else if (block.name === 'Grep' && input.pattern) detail += `: "${input.pattern}"${input.path ? ' in ' + input.path : ''}`;
                  else if (block.name === 'Glob' && input.pattern) detail += `: ${input.pattern}`;
                  else if (block.name === 'WebSearch' && input.query) detail += `: "${input.query}"`;
                  else if (block.name === 'WebFetch' && input.url) detail += `: ${input.url}`;
                  else if (block.name === 'Agent' && input.description) detail += `: ${input.description}`;
                  else if (block.name === 'TodoWrite') detail = `TodoWrite: ${Array.isArray(input.todos) ? input.todos.length + ' items' : ''}`;
                  else if (block.name.startsWith('mcp__')) {
                    const args = Object.entries(input).map(([k, v]) => `${k}=${String(v).slice(0, 100)}`).join(', ');
                    if (args) detail += `: ${args}`;
                  } else {
                    // Generic: show all input keys
                    const args = Object.entries(input).map(([k, v]) => `${k}=${String(v).slice(0, 100)}`).join(', ');
                    if (args) detail += `: ${args}`;
                  }
                }
                onProgress({ type: 'tool_active', description: detail });
              }
            }
          }
        }
      }

      // Sub-agent lifecycle events — surface to Telegram for user feedback
      if (ev['type'] === 'system' && ev['subtype'] === 'task_started' && onProgress) {
        const desc = (ev['description'] as string) ?? 'Sub-agent started';
        onProgress({ type: 'task_started', description: desc });
      }
      if (ev['type'] === 'system' && ev['subtype'] === 'task_notification' && onProgress) {
        const summary = (ev['summary'] as string) ?? 'Sub-agent finished';
        const status = (ev['status'] as string) ?? 'completed';
        onProgress({
          type: 'task_completed',
          description: status === 'failed' ? `Failed: ${summary}` : summary,
        });
      }

      // Stream text deltas for progressive Telegram updates.
      // Only stream the outermost assistant response (parent_tool_use_id === null)
      // to avoid showing internal tool-use reasoning.
      if (ev['type'] === 'stream_event' && onStreamText && ev['parent_tool_use_id'] === null) {
        const streamEvent = ev['event'] as Record<string, unknown> | undefined;
        if (streamEvent?.['type'] === 'content_block_delta') {
          const delta = streamEvent['delta'] as Record<string, unknown> | undefined;
          if (delta?.['type'] === 'text_delta' && typeof delta['text'] === 'string') {
            streamedText += delta['text'];
            onStreamText(streamedText);
          }
        }
        if (streamEvent?.['type'] === 'message_start') {
          streamedText = '';
        }
      }

      if (ev['type'] === 'result') {
        resultText = (ev['result'] as string | null | undefined) ?? null;

        // Extract usage info from result event
        const evUsage = ev['usage'] as Record<string, number> | undefined;
        if (evUsage) {
          usage = {
            inputTokens: evUsage['input_tokens'] ?? 0,
            outputTokens: evUsage['output_tokens'] ?? 0,
            cacheReadInputTokens: evUsage['cache_read_input_tokens'] ?? 0,
            totalCostUsd: (ev['total_cost_usd'] as number) ?? 0,
            didCompact,
            preCompactTokens,
            lastCallCacheRead,
            lastCallInputTokens,
          };
          logger.info(
            {
              inputTokens: usage.inputTokens,
              cacheReadTokens: usage.cacheReadInputTokens,
              lastCallCacheRead: usage.lastCallCacheRead,
              lastCallInputTokens: usage.lastCallInputTokens,
              costUsd: usage.totalCostUsd,
              didCompact,
            },
            'Turn usage',
          );
        }

        logger.info(
          { hasResult: !!resultText, subtype: ev['subtype'] },
          'Agent result received',
        );
      }
    }
  } catch (err) {
    if (abortController?.signal.aborted) {
      logger.info('Agent query aborted by user');
      return { text: null, newSessionId, usage, aborted: true };
    }
    throw err;
  } finally {
    clearInterval(typingInterval);
  }

  return { text: resultText, newSessionId, usage };
}
