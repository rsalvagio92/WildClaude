#!/usr/bin/env node
/**
 * Computer Use MCP — desktop control with HEAVY safety gates.
 *
 * Exposes a subset of Anthropic's computer-use primitives:
 *   screenshot()                    — capture screen, return path
 *   click(x, y, [button])           — single mouse click
 *   type(text)                      — type literal text
 *   key(name)                       — single key (enter, escape, tab, etc.)
 *   move(x, y)                      — move cursor without clicking
 *
 * SAFETY MODEL:
 *   - Default: DISABLED. Set COMPUTER_USE_ENABLED=true in .env to activate.
 *   - Every action writes to USER_DATA_DIR/computer-use.audit.jsonl
 *   - COMPUTER_USE_DRY_RUN=true logs would-do actions but doesn't execute
 *   - Rate limited: max 30 actions per minute
 *   - Each action has a timeout
 *
 * Backends:
 *   - Linux/macOS: tries `xdotool` (X11) and `cliclick` (macOS)
 *   - Windows: uses PowerShell via System.Windows.Forms
 *   - All fail gracefully if binaries missing
 *
 * This is intentionally a thin shim, not a full Anthropic computer-use
 * client — the goal is "let an agent move your mouse on a Pi/laptop you
 * control" with clear off-switches, not enterprise RPA.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { serveStdio } from './mcp-stdio.js';
import { USER_DATA_DIR } from '../paths.js';

const execFileAsync = promisify(execFile);

const ENABLED = (process.env.COMPUTER_USE_ENABLED ?? 'false').toLowerCase() === 'true';
const DRY_RUN = (process.env.COMPUTER_USE_DRY_RUN ?? 'false').toLowerCase() === 'true';
const AUDIT_LOG = path.join(USER_DATA_DIR, 'computer-use.audit.jsonl');
const RATE_PER_MIN = parseInt(process.env.COMPUTER_USE_RATE_PER_MIN ?? '30', 10);

const actionTimestamps: number[] = [];

function audit(action: string, args: Record<string, unknown>, result: string): void {
  try {
    fs.appendFileSync(AUDIT_LOG, JSON.stringify({
      ts: new Date().toISOString(),
      action,
      args,
      result,
      enabled: ENABLED,
      dryRun: DRY_RUN,
    }) + '\n');
  } catch { /* */ }
}

function checkRate(): void {
  const now = Date.now();
  while (actionTimestamps.length > 0 && now - actionTimestamps[0] > 60_000) actionTimestamps.shift();
  if (actionTimestamps.length >= RATE_PER_MIN) {
    throw new Error(`Rate limit: max ${RATE_PER_MIN} actions/min`);
  }
  actionTimestamps.push(now);
}

function disabledResponse() {
  return {
    text: 'Computer Use is DISABLED. Set COMPUTER_USE_ENABLED=true in .env to enable. Each enable is irrevocable for that session — review src/tools/computer-use-mcp.ts before flipping the flag.',
    isError: true,
  };
}

async function runOrDry(cmd: string, args: string[]): Promise<string> {
  if (DRY_RUN) return `(dry-run) ${cmd} ${args.join(' ')}`;
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: 5000 });
    return stdout.trim() || '(ok)';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`${cmd} failed: ${msg.slice(0, 200)}`);
  }
}

async function screenshotImpl(): Promise<string> {
  const outDir = path.join(USER_DATA_DIR, 'uploads', 'computer-use');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `screen-${Date.now()}.png`);
  if (DRY_RUN) return `(dry-run) would save to ${outPath}`;
  if (process.platform === 'darwin') {
    await execFileAsync('screencapture', ['-x', outPath], { timeout: 10_000 });
  } else if (process.platform === 'linux') {
    // Prefer scrot; fall back to imagemagick
    try {
      await execFileAsync('scrot', ['-o', outPath], { timeout: 10_000 });
    } catch {
      await execFileAsync('import', ['-window', 'root', outPath], { timeout: 10_000 });
    }
  } else if (process.platform === 'win32') {
    const ps = `Add-Type -AssemblyName System.Windows.Forms; ` +
               `Add-Type -AssemblyName System.Drawing; ` +
               `$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; ` +
               `$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height; ` +
               `$g = [System.Drawing.Graphics]::FromImage($bmp); ` +
               `$g.CopyFromScreen($b.Location, [Drawing.Point]::Empty, $b.Size); ` +
               `$bmp.Save('${outPath.replace(/\\/g, '\\\\')}');`;
    await execFileAsync('powershell.exe', ['-NoProfile', '-Command', ps], { timeout: 15_000 });
  } else {
    throw new Error(`Unsupported platform: ${process.platform}`);
  }
  return outPath;
}

async function clickImpl(x: number, y: number, button = 'left'): Promise<string> {
  if (process.platform === 'linux') {
    return runOrDry('xdotool', ['mousemove', String(x), String(y), 'click', button === 'right' ? '3' : '1']);
  }
  if (process.platform === 'darwin') {
    return runOrDry('cliclick', [`c:${x},${y}`]);
  }
  if (process.platform === 'win32') {
    const ps = `Add-Type -AssemblyName System.Windows.Forms; ` +
               `[System.Windows.Forms.Cursor]::Position = New-Object Drawing.Point(${x}, ${y}); ` +
               `Add-Type -MemberDefinition '[DllImport(\\"user32.dll\\")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);' -Name U -Namespace W; ` +
               `[W.U]::mouse_event(2, 0, 0, 0, 0); [W.U]::mouse_event(4, 0, 0, 0, 0);`;
    return runOrDry('powershell.exe', ['-NoProfile', '-Command', ps]);
  }
  throw new Error(`Unsupported platform: ${process.platform}`);
}

async function typeImpl(text: string): Promise<string> {
  if (process.platform === 'linux') return runOrDry('xdotool', ['type', '--', text]);
  if (process.platform === 'darwin') return runOrDry('cliclick', [`t:${text}`]);
  if (process.platform === 'win32') {
    const escaped = text.replace(/"/g, '`"').replace(/\$/g, '`$');
    return runOrDry('powershell.exe', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("${escaped}")`]);
  }
  throw new Error(`Unsupported platform: ${process.platform}`);
}

async function keyImpl(name: string): Promise<string> {
  if (process.platform === 'linux') return runOrDry('xdotool', ['key', name]);
  if (process.platform === 'darwin') return runOrDry('cliclick', [`kp:${name}`]);
  if (process.platform === 'win32') return runOrDry('powershell.exe', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("{${name}}")`]);
  throw new Error(`Unsupported platform: ${process.platform}`);
}

async function moveImpl(x: number, y: number): Promise<string> {
  if (process.platform === 'linux') return runOrDry('xdotool', ['mousemove', String(x), String(y)]);
  if (process.platform === 'darwin') return runOrDry('cliclick', [`m:${x},${y}`]);
  if (process.platform === 'win32') {
    return runOrDry('powershell.exe', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object Drawing.Point(${x}, ${y})`]);
  }
  throw new Error(`Unsupported platform: ${process.platform}`);
}

serveStdio({
  name: 'wildclaude-computer-use',
  version: '0.1.0',
  tools: [
    {
      name: 'screenshot',
      description: 'Capture the primary screen to a PNG and return its path. Disabled by default (set COMPUTER_USE_ENABLED=true).',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        if (!ENABLED) return disabledResponse();
        checkRate();
        const p = await screenshotImpl();
        audit('screenshot', {}, p);
        return { text: `Saved: ${p}` };
      },
    },
    {
      name: 'click',
      description: 'Click at (x, y). button = "left" | "right". Disabled unless COMPUTER_USE_ENABLED=true.',
      inputSchema: {
        type: 'object',
        properties: { x: { type: 'number' }, y: { type: 'number' }, button: { type: 'string' } },
        required: ['x', 'y'],
      },
      handler: async (args) => {
        if (!ENABLED) return disabledResponse();
        checkRate();
        const r = await clickImpl(Number(args.x), Number(args.y), String(args.button ?? 'left'));
        audit('click', args, r);
        return { text: r };
      },
    },
    {
      name: 'type',
      description: 'Type literal text at the current cursor focus. Disabled by default.',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
      handler: async (args) => {
        if (!ENABLED) return disabledResponse();
        checkRate();
        const r = await typeImpl(String(args.text));
        audit('type', { len: String(args.text).length }, r);
        return { text: r };
      },
    },
    {
      name: 'key',
      description: 'Press a single named key (Return, Escape, Tab, BackSpace, Down, etc.). Disabled by default.',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
      handler: async (args) => {
        if (!ENABLED) return disabledResponse();
        checkRate();
        const r = await keyImpl(String(args.name));
        audit('key', args, r);
        return { text: r };
      },
    },
    {
      name: 'move',
      description: 'Move cursor to (x, y) without clicking. Disabled by default.',
      inputSchema: {
        type: 'object',
        properties: { x: { type: 'number' }, y: { type: 'number' } },
        required: ['x', 'y'],
      },
      handler: async (args) => {
        if (!ENABLED) return disabledResponse();
        checkRate();
        const r = await moveImpl(Number(args.x), Number(args.y));
        audit('move', args, r);
        return { text: r };
      },
    },
  ],
});
