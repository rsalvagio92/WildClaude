#!/usr/bin/env node
/**
 * Web Search MCP — lightweight search tool (Brave or Tavily).
 *
 * Why not just use the existing Browser MCP? Browser is heavy (Playwright,
 * full DOM, 50KB+ HTML per page). For "what's the latest news on X" we want
 * snippets + URLs in <1s. Two providers supported:
 *   - Brave Search API (free tier 2k queries/month)  — preferred default
 *   - Tavily API (search optimized for LLMs)
 *
 * Tools exposed:
 *   search(q, [count])       → ranked results with title + url + snippet
 *   news(q, [count])         → news-mode results (Brave only)
 *
 * Config (env or secrets):
 *   BRAVE_API_KEY      — preferred
 *   TAVILY_API_KEY     — fallback
 * If both are set, Brave wins. If neither, the tool returns a clear error.
 */

import { serveStdio } from '../tools/mcp-stdio.js';
import { readEnvFile } from '../env.js';
import { juice } from '../token-juice.js';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function getProvider(): { kind: 'brave' | 'tavily'; key: string } | null {
  const s = readEnvFile(['BRAVE_API_KEY', 'TAVILY_API_KEY']);
  const brave = process.env.BRAVE_API_KEY || s.BRAVE_API_KEY;
  const tavily = process.env.TAVILY_API_KEY || s.TAVILY_API_KEY;
  if (brave) return { kind: 'brave', key: brave };
  if (tavily) return { kind: 'tavily', key: tavily };
  return null;
}

async function braveSearch(q: string, count: number, kind: 'web' | 'news', key: string): Promise<SearchResult[]> {
  const endpoint = kind === 'news' ? 'https://api.search.brave.com/res/v1/news/search' : 'https://api.search.brave.com/res/v1/web/search';
  const url = `${endpoint}?q=${encodeURIComponent(q)}&count=${Math.min(count, 20)}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': key,
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Brave ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json() as { web?: { results?: Array<{ title: string; url: string; description: string }> }; results?: Array<{ title: string; url: string; description: string }> };
  const items = kind === 'news' ? (data.results ?? []) : (data.web?.results ?? []);
  return items.map((r) => ({ title: r.title, url: r.url, snippet: r.description ?? '' }));
}

async function tavilySearch(q: string, count: number, key: string): Promise<SearchResult[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: key,
      query: q,
      max_results: Math.min(count, 20),
      search_depth: 'basic',
      include_answer: false,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Tavily ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json() as { results?: Array<{ title: string; url: string; content: string }> };
  return (data.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content ?? '' }));
}

function format(results: SearchResult[]): string {
  if (results.length === 0) return 'No results.';
  const lines = results.map((r, i) => {
    const j = juice(r.snippet, { html: false, dedup: true, normalize: true, maxChars: 600 });
    return `${i + 1}. ${r.title}\n   ${r.url}\n   ${j.text}`;
  });
  return lines.join('\n\n');
}

serveStdio({
  name: 'wildclaude-web-search',
  version: '0.1.0',
  tools: [
    {
      name: 'search',
      description: 'Web search via Brave or Tavily. Returns ranked title/URL/snippet results — lightweight (no DOM parsing). Prefer this over browser-mcp for "what is X" style queries.',
      inputSchema: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          count: { type: 'number', description: 'Default 10, max 20' },
        },
        required: ['q'],
      },
      handler: async (args) => {
        const provider = getProvider();
        if (!provider) {
          return { text: 'Web Search not configured. Set BRAVE_API_KEY (preferred) or TAVILY_API_KEY.', isError: true };
        }
        const count = Number(args.count ?? 10);
        const q = String(args.q ?? '');
        const results = provider.kind === 'brave'
          ? await braveSearch(q, count, 'web', provider.key)
          : await tavilySearch(q, count, provider.key);
        return { text: `[via ${provider.kind}]\n\n${format(results)}` };
      },
    },
    {
      name: 'news',
      description: 'News-mode web search (Brave only). For "latest news on X" queries.',
      inputSchema: {
        type: 'object',
        properties: { q: { type: 'string' }, count: { type: 'number' } },
        required: ['q'],
      },
      handler: async (args) => {
        const provider = getProvider();
        if (!provider) return { text: 'Web Search not configured.', isError: true };
        if (provider.kind !== 'brave') {
          return { text: 'News search requires Brave. Set BRAVE_API_KEY or use the general search tool.', isError: true };
        }
        const results = await braveSearch(String(args.q ?? ''), Number(args.count ?? 10), 'news', provider.key);
        return { text: format(results) };
      },
    },
  ],
});
