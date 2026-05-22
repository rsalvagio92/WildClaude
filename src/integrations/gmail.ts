#!/usr/bin/env node
/**
 * Gmail MCP tool — Gmail REST API wrapper.
 *
 * Tools exposed:
 *   list_unread([maxResults])           — recent unread message IDs + snippets
 *   read(message_id)                    — single message (from, subject, body)
 *   search(q, [maxResults])             — Gmail search query syntax
 *   draft(to, subject, body)            — create a draft (NOT send)
 *   send_draft(draft_id)                — send a previously-created draft
 *
 * Config (env or secrets):
 *   GMAIL_ACCESS_TOKEN  — short-lived OAuth token (refresh handled externally)
 *
 * Why no IMAP/SMTP path? Gmail's REST API gives us search + drafts + threads
 * without needing a long-lived TLS connection. For non-Gmail accounts, use a
 * different MCP server. We deliberately keep this scoped.
 */

import { serveStdio } from '../tools/mcp-stdio.js';
import { juice } from '../token-juice.js';
import { getGoogleAccessToken } from './google-oauth.js';

async function gapi(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
  const t = await getGoogleAccessToken('gmail');
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    method,
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail ${method} ${path} → ${res.status}: ${text.slice(0, 240)}`);
  }
  return res.status === 204 ? null : res.json();
}

interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  snippet: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
    parts?: GmailPart[];
    body?: { data?: string };
    mimeType?: string;
  };
}

function decode(b64url: string): string {
  return Buffer.from(b64url.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function findTextBody(parts: GmailPart[] | undefined): string {
  if (!parts) return '';
  for (const p of parts) {
    if (p?.mimeType === 'text/plain' && p.body?.data) return decode(p.body.data);
  }
  for (const p of parts) {
    if (p?.parts) {
      const found = findTextBody(p.parts);
      if (found) return found;
    }
  }
  // Fall back to HTML
  for (const p of parts) {
    if (p?.mimeType === 'text/html' && p.body?.data) return decode(p.body.data);
  }
  return '';
}

function header(msg: GmailMessage, name: string): string {
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function rfc2822(to: string, subject: string, body: string): string {
  return [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ].join('\r\n');
}

function b64url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

serveStdio({
  name: 'wildclaude-gmail',
  version: '0.1.0',
  tools: [
    {
      name: 'list_unread',
      description: 'List unread messages with one-line snippets. Returns IDs you can pass to read().',
      inputSchema: {
        type: 'object',
        properties: { maxResults: { type: 'number', description: 'Default 20, max 100' } },
      },
      handler: async (args) => {
        const max = Math.min(Number(args.maxResults ?? 20), 100);
        const list = (await gapi('GET', `/messages?q=is:unread&maxResults=${max}`)) as { messages?: Array<{ id: string }> };
        const ids = (list.messages ?? []).map((m) => m.id);
        const lines: string[] = [`${ids.length} unread message(s)`];
        for (const id of ids.slice(0, max)) {
          const msg = (await gapi('GET', `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`)) as GmailMessage;
          lines.push(`${id} · ${header(msg, 'From').slice(0, 40)} · ${header(msg, 'Subject').slice(0, 60)} — ${msg.snippet.slice(0, 80)}`);
        }
        return { text: lines.join('\n') };
      },
    },
    {
      name: 'read',
      description: 'Read a single Gmail message by ID. Returns from / subject / plain-text body.',
      inputSchema: {
        type: 'object',
        properties: { message_id: { type: 'string' } },
        required: ['message_id'],
      },
      handler: async (args) => {
        const msg = (await gapi('GET', `/messages/${args.message_id}?format=full`)) as GmailMessage;
        let body = '';
        if (msg.payload?.body?.data) body = decode(msg.payload.body.data);
        else body = findTextBody(msg.payload?.parts);
        const compressed = juice(body, { tag: 'gmail-read', maxChars: 12_000 });
        return {
          text:
            `From: ${header(msg, 'From')}\n` +
            `Subject: ${header(msg, 'Subject')}\n` +
            `Date: ${header(msg, 'Date')}\n\n` +
            compressed.text,
        };
      },
    },
    {
      name: 'search',
      description: 'Gmail search query (e.g. "from:alice@example.com newer_than:7d"). Returns matching IDs + snippets.',
      inputSchema: {
        type: 'object',
        properties: { q: { type: 'string' }, maxResults: { type: 'number' } },
        required: ['q'],
      },
      handler: async (args) => {
        const max = Math.min(Number(args.maxResults ?? 20), 100);
        const list = (await gapi('GET', `/messages?q=${encodeURIComponent(String(args.q))}&maxResults=${max}`)) as { messages?: Array<{ id: string }> };
        const ids = (list.messages ?? []).map((m) => m.id);
        return { text: `${ids.length} match(es):\n${ids.join('\n')}` };
      },
    },
    {
      name: 'draft',
      description: 'Create a Gmail draft. Does NOT send. Returns draft_id.',
      inputSchema: {
        type: 'object',
        properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } },
        required: ['to', 'subject', 'body'],
      },
      handler: async (args) => {
        const raw = b64url(rfc2822(String(args.to), String(args.subject), String(args.body)));
        const resp = (await gapi('POST', `/drafts`, { message: { raw } })) as { id: string };
        return { text: `Draft created: ${resp.id}` };
      },
    },
    {
      name: 'send_draft',
      description: 'Send a previously-created draft.',
      inputSchema: {
        type: 'object',
        properties: { draft_id: { type: 'string' } },
        required: ['draft_id'],
      },
      handler: async (args) => {
        const r = (await gapi('POST', `/drafts/send`, { id: args.draft_id })) as { id: string };
        return { text: `Sent. Message id: ${r.id}` };
      },
    },
  ],
});
