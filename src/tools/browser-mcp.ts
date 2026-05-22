#!/usr/bin/env node
/**
 * Browser MCP tool — sandboxed Playwright wrapper.
 *
 * Tools exposed:
 *   navigate(url)                  → returns page title + URL
 *   read_text(url)                 → returns visible text content
 *   screenshot(url, [fullPage])    → returns path to saved PNG
 *   click(url, selector)           → click an element then return state
 *
 * Consent: each non-allowlisted host requires explicit pre-allow via
 *   ~/.wild-claude-pi/config.json → { "browser": { "allowedHosts": ["..."] } }
 *
 * Default allowlist: docs.anthropic.com, github.com, wikipedia.org.
 * Set BROWSER_ALLOW_ALL=true to disable the gate (use only on trusted networks).
 */

import fs from 'fs';
import path from 'path';

import { USER_DATA_DIR } from '../paths.js';
import { serveStdio } from './mcp-stdio.js';
import { juice } from '../token-juice.js';

const SCREENSHOT_DIR = path.join(USER_DATA_DIR, 'uploads', 'browser-screenshots');

interface BrowserConfig { allowedHosts: string[] }

function loadConfig(): BrowserConfig {
  const cfgPath = path.join(USER_DATA_DIR, 'config.json');
  try {
    if (fs.existsSync(cfgPath)) {
      const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as { browser?: Partial<BrowserConfig> };
      return {
        allowedHosts: Array.isArray(raw.browser?.allowedHosts) ? raw.browser!.allowedHosts! : [],
      };
    }
  } catch { /* */ }
  return { allowedHosts: [] };
}

const DEFAULT_ALLOWED = ['docs.anthropic.com', 'github.com', 'wikipedia.org', 'en.wikipedia.org', 'agentskills.io'];

function hostAllowed(url: string): boolean {
  if (process.env.BROWSER_ALLOW_ALL === 'true') return true;
  let host: string;
  try { host = new URL(url).host; } catch { return false; }
  const cfg = loadConfig();
  const allowed = new Set([...DEFAULT_ALLOWED, ...cfg.allowedHosts]);
  if (allowed.has(host)) return true;
  // Allow exact match or one-level subdomain
  for (const a of allowed) {
    if (host === a || host.endsWith('.' + a)) return true;
  }
  return false;
}

async function withBrowser<T>(fn: (page: any) => Promise<T>): Promise<T> {
  // dynamic import to keep playwright optional
  let pw: any;
  try {
    pw = await import('playwright' as any);
  } catch (err) {
    throw new Error(`Playwright not installed. Run: npm install playwright (${err instanceof Error ? err.message : String(err)})`);
  }
  const browser = await pw.chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(30_000);
    return await fn(page);
  } finally {
    await browser.close().catch(() => {});
  }
}

async function handleNavigate(args: Record<string, unknown>) {
  const url = String(args.url ?? '');
  if (!hostAllowed(url)) {
    return { text: `Blocked: host not allowlisted. Add it to ~/.wild-claude-pi/config.json under browser.allowedHosts, or set BROWSER_ALLOW_ALL=true.`, isError: true };
  }
  return await withBrowser(async (page) => {
    const resp = await page.goto(url);
    return { text: `Title: ${await page.title()}\nFinal URL: ${page.url()}\nStatus: ${resp?.status() ?? 'n/a'}` };
  });
}

async function handleReadText(args: Record<string, unknown>) {
  const url = String(args.url ?? '');
  if (!hostAllowed(url)) return { text: 'Blocked: host not allowlisted.', isError: true };
  return await withBrowser(async (page) => {
    await page.goto(url);
    // Pull the raw HTML and let TokenJuice convert + compress it. innerText
    // would already strip tags but loses structure (headings, links, code).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const html: string = await page.evaluate(() => (globalThis as any).document?.documentElement?.outerHTML ?? '');
    const compressed = juice(html, { html: true, tag: 'browser-read_text', maxChars: 12_000 });
    const refs = compressed.urlReferences.length > 0
      ? '\n\n--- references ---\n' + compressed.urlReferences.map((u, i) => `[link${i + 1}] ${u}`).join('\n')
      : '';
    return { text: `${compressed.text.trim()}${refs}\n\n--- juice ---\n${compressed.bytesIn}B → ${compressed.bytesOut}B (saved ~${compressed.tokensSaved} tokens)` };
  });
}

async function handleScreenshot(args: Record<string, unknown>) {
  const url = String(args.url ?? '');
  const fullPage = !!args.fullPage;
  if (!hostAllowed(url)) return { text: 'Blocked: host not allowlisted.', isError: true };
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  return await withBrowser(async (page) => {
    await page.goto(url);
    const fname = `${Date.now()}-${new URL(url).host.replace(/[^a-z0-9.-]/gi, '_')}.png`;
    const out = path.join(SCREENSHOT_DIR, fname);
    await page.screenshot({ path: out, fullPage });
    return { text: `Saved screenshot: ${out}` };
  });
}

async function handleClick(args: Record<string, unknown>) {
  const url = String(args.url ?? '');
  const selector = String(args.selector ?? '');
  if (!hostAllowed(url)) return { text: 'Blocked: host not allowlisted.', isError: true };
  if (!selector) return { text: 'selector required', isError: true };
  return await withBrowser(async (page) => {
    await page.goto(url);
    await page.click(selector, { timeout: 10_000 });
    return { text: `Clicked ${selector}\nFinal URL: ${page.url()}\nTitle: ${await page.title()}` };
  });
}

serveStdio({
  name: 'wildclaude-browser',
  version: '0.1.0',
  tools: [
    {
      name: 'navigate',
      description: 'Open a URL in a headless browser and return page title + final URL. Requires host allowlist.',
      inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
      handler: handleNavigate,
    },
    {
      name: 'read_text',
      description: 'Open a URL and return its visible text (up to 50KB). Use for reading articles, docs, search results.',
      inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
      handler: handleReadText,
    },
    {
      name: 'screenshot',
      description: 'Open a URL and save a PNG screenshot. Returns the file path on disk.',
      inputSchema: { type: 'object', properties: { url: { type: 'string' }, fullPage: { type: 'boolean' } }, required: ['url'] },
      handler: handleScreenshot,
    },
    {
      name: 'click',
      description: 'Open a URL, click an element by CSS selector, return resulting page state.',
      inputSchema: { type: 'object', properties: { url: { type: 'string' }, selector: { type: 'string' } }, required: ['url', 'selector'] },
      handler: handleClick,
    },
  ],
});
