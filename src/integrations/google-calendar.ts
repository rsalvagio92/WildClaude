#!/usr/bin/env node
/**
 * Google Calendar MCP tool.
 *
 * Tools exposed:
 *   list_events([since], [until], [maxResults])  — upcoming events
 *   create_event(summary, start, end, [description]) — new event
 *   find_free_slot(durationMinutes, [withinDays]) — first available slot
 *   update_event(event_id, patch)                — modify an event
 *   delete_event(event_id)                       — remove
 *
 * Config:
 *   GCAL_ACCESS_TOKEN   — OAuth token with calendar scope
 *   GCAL_CALENDAR_ID    — default 'primary'
 */

import { serveStdio } from '../tools/mcp-stdio.js';
import { getGoogleAccessToken } from './google-oauth.js';

function calendarId(): string {
  return process.env.GCAL_CALENDAR_ID || 'primary';
}

async function gapi(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<unknown> {
  const t = await getGoogleAccessToken('gcal');
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    method,
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GCal ${method} ${path} → ${res.status}: ${text.slice(0, 240)}`);
  }
  return res.status === 204 ? null : res.json();
}

interface CalEvent {
  id: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  location?: string;
}

function fmtEvent(e: CalEvent): string {
  const s = e.start?.dateTime ?? e.start?.date ?? '?';
  const en = e.end?.dateTime ?? e.end?.date ?? '?';
  return `${e.id} · ${e.summary ?? '(no title)'} · ${s} → ${en}${e.location ? ' @ ' + e.location : ''}`;
}

serveStdio({
  name: 'wildclaude-gcal',
  version: '0.1.0',
  tools: [
    {
      name: 'list_events',
      description: 'List upcoming calendar events. Defaults to next 7 days. Times in ISO 8601.',
      inputSchema: {
        type: 'object',
        properties: {
          since: { type: 'string', description: 'ISO datetime (default: now)' },
          until: { type: 'string', description: 'ISO datetime (default: now+7d)' },
          maxResults: { type: 'number' },
        },
      },
      handler: async (args) => {
        const timeMin = args.since ? String(args.since) : new Date().toISOString();
        const timeMax = args.until ? String(args.until) : new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
        const max = Math.min(Number(args.maxResults ?? 25), 100);
        const data = (await gapi(
          'GET',
          `/calendars/${encodeURIComponent(calendarId())}/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&maxResults=${max}&singleEvents=true&orderBy=startTime`,
        )) as { items?: CalEvent[] };
        const items = data.items ?? [];
        return { text: `${items.length} event(s):\n${items.map(fmtEvent).join('\n')}` };
      },
    },
    {
      name: 'create_event',
      description: 'Create a calendar event. start/end must be ISO 8601 (e.g. 2026-05-23T15:00:00+02:00).',
      inputSchema: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          start: { type: 'string' },
          end: { type: 'string' },
          description: { type: 'string' },
          location: { type: 'string' },
        },
        required: ['summary', 'start', 'end'],
      },
      handler: async (args) => {
        const body = {
          summary: args.summary,
          description: args.description ?? '',
          location: args.location ?? '',
          start: { dateTime: args.start },
          end: { dateTime: args.end },
        };
        const r = (await gapi('POST', `/calendars/${encodeURIComponent(calendarId())}/events`, body)) as CalEvent;
        return { text: `Created event ${r.id}` };
      },
    },
    {
      name: 'find_free_slot',
      description: 'Find the first free slot of `durationMinutes` within the next `withinDays`.',
      inputSchema: {
        type: 'object',
        properties: {
          durationMinutes: { type: 'number' },
          withinDays: { type: 'number' },
        },
        required: ['durationMinutes'],
      },
      handler: async (args) => {
        const dur = Number(args.durationMinutes);
        const days = Number(args.withinDays ?? 7);
        const timeMin = new Date().toISOString();
        const timeMax = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
        const data = (await gapi(
          'GET',
          `/calendars/${encodeURIComponent(calendarId())}/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime&maxResults=250`,
        )) as { items?: CalEvent[] };

        const items = (data.items ?? [])
          .map((e) => ({
            start: e.start?.dateTime ? new Date(e.start.dateTime).getTime() : null,
            end: e.end?.dateTime ? new Date(e.end.dateTime).getTime() : null,
          }))
          .filter((x): x is { start: number; end: number } => x.start !== null && x.end !== null)
          .sort((a, b) => a.start - b.start);

        let cursor = Date.now();
        const horizon = cursor + days * 24 * 3600 * 1000;
        const need = dur * 60 * 1000;
        for (const ev of items) {
          if (ev.start - cursor >= need) {
            return { text: `Free slot found: ${new Date(cursor).toISOString()} → ${new Date(cursor + need).toISOString()}` };
          }
          cursor = Math.max(cursor, ev.end);
        }
        if (horizon - cursor >= need) {
          return { text: `Free slot found: ${new Date(cursor).toISOString()} → ${new Date(cursor + need).toISOString()}` };
        }
        return { text: `No free slot of ${dur} min within ${days} day(s).`, isError: true };
      },
    },
    {
      name: 'update_event',
      description: 'Patch an existing event. Pass any of: summary, description, location, start, end (ISO).',
      inputSchema: {
        type: 'object',
        properties: {
          event_id: { type: 'string' },
          summary: { type: 'string' },
          description: { type: 'string' },
          location: { type: 'string' },
          start: { type: 'string' },
          end: { type: 'string' },
        },
        required: ['event_id'],
      },
      handler: async (args) => {
        const patch: Record<string, unknown> = {};
        if (args.summary !== undefined) patch.summary = args.summary;
        if (args.description !== undefined) patch.description = args.description;
        if (args.location !== undefined) patch.location = args.location;
        if (args.start !== undefined) patch.start = { dateTime: args.start };
        if (args.end !== undefined) patch.end = { dateTime: args.end };
        await gapi('PATCH', `/calendars/${encodeURIComponent(calendarId())}/events/${args.event_id}`, patch);
        return { text: `Updated ${args.event_id}` };
      },
    },
    {
      name: 'delete_event',
      description: 'Delete an event by ID.',
      inputSchema: {
        type: 'object',
        properties: { event_id: { type: 'string' } },
        required: ['event_id'],
      },
      handler: async (args) => {
        await gapi('DELETE', `/calendars/${encodeURIComponent(calendarId())}/events/${args.event_id}`);
        return { text: `Deleted ${args.event_id}` };
      },
    },
  ],
});
