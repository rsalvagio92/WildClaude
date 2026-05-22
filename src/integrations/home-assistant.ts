#!/usr/bin/env node
/**
 * Home Assistant MCP tool — control your home from WildClaude.
 *
 * Tools exposed:
 *   list_entities([domain])         → list known entities (optional filter)
 *   get_state(entity_id)            → current state of an entity
 *   call_service(domain, service, [target], [data]) → invoke a service
 *   turn_on(entity_id)              → convenience for switch.turn_on / light.turn_on
 *   turn_off(entity_id)             → convenience for *.turn_off
 *
 * Config (env or secrets):
 *   HOME_ASSISTANT_URL    — e.g. http://homeassistant.local:8123
 *   HOME_ASSISTANT_TOKEN  — long-lived access token from HA profile
 *
 * MCP entry point:
 *   { "command": "node", "args": ["dist/integrations/home-assistant.js"] }
 */

import { serveStdio } from '../tools/mcp-stdio.js';
import { readEnvFile } from '../env.js';

function config(): { url: string; token: string } | null {
  const secrets = readEnvFile(['HOME_ASSISTANT_URL', 'HOME_ASSISTANT_TOKEN']);
  const url = process.env.HOME_ASSISTANT_URL || secrets.HOME_ASSISTANT_URL || '';
  const token = process.env.HOME_ASSISTANT_TOKEN || secrets.HOME_ASSISTANT_TOKEN || '';
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ''), token };
}

async function ha(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
  const cfg = config();
  if (!cfg) throw new Error('Home Assistant not configured. Set HOME_ASSISTANT_URL and HOME_ASSISTANT_TOKEN.');
  const res = await fetch(`${cfg.url}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HA ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') ?? '';
  return ct.includes('application/json') ? res.json() : res.text();
}

interface HaState { entity_id: string; state: string; attributes?: Record<string, unknown> }

serveStdio({
  name: 'wildclaude-home-assistant',
  version: '0.1.0',
  tools: [
    {
      name: 'list_entities',
      description: 'List entities known to Home Assistant. Optional domain filter (light, switch, sensor, etc.).',
      inputSchema: {
        type: 'object',
        properties: { domain: { type: 'string', description: 'Filter, e.g. "light"' } },
      },
      handler: async (args) => {
        const domain = args.domain ? String(args.domain) : null;
        const states = (await ha('GET', '/api/states')) as HaState[];
        const filtered = domain
          ? states.filter((s) => s.entity_id.startsWith(domain + '.'))
          : states;
        const lines = filtered.slice(0, 200).map((s) => `${s.entity_id} = ${s.state}`);
        return { text: `${filtered.length} entities${domain ? ` (domain=${domain})` : ''}\n${lines.join('\n')}` };
      },
    },
    {
      name: 'get_state',
      description: 'Get the current state of a single entity.',
      inputSchema: {
        type: 'object',
        properties: { entity_id: { type: 'string' } },
        required: ['entity_id'],
      },
      handler: async (args) => {
        const state = (await ha('GET', `/api/states/${encodeURIComponent(String(args.entity_id))}`)) as HaState;
        return { text: `${state.entity_id} = ${state.state}\nAttributes: ${JSON.stringify(state.attributes ?? {}, null, 2).slice(0, 1500)}` };
      },
    },
    {
      name: 'call_service',
      description: 'Invoke a Home Assistant service: domain.service with optional target and data.',
      inputSchema: {
        type: 'object',
        properties: {
          domain: { type: 'string' },
          service: { type: 'string' },
          target: { type: 'object' },
          data: { type: 'object' },
        },
        required: ['domain', 'service'],
      },
      handler: async (args) => {
        const body: Record<string, unknown> = { ...(args.data as Record<string, unknown> ?? {}) };
        if (args.target) Object.assign(body, args.target);
        await ha('POST', `/api/services/${args.domain}/${args.service}`, body);
        return { text: `Invoked ${args.domain}.${args.service}` };
      },
    },
    {
      name: 'turn_on',
      description: 'Turn on a switchable entity (light/switch/etc.). Sends domain-appropriate turn_on.',
      inputSchema: {
        type: 'object',
        properties: { entity_id: { type: 'string' } },
        required: ['entity_id'],
      },
      handler: async (args) => {
        const eid = String(args.entity_id);
        const domain = eid.split('.')[0];
        if (!domain) return { text: 'invalid entity_id', isError: true };
        await ha('POST', `/api/services/${domain}/turn_on`, { entity_id: eid });
        return { text: `Turned on ${eid}` };
      },
    },
    {
      name: 'turn_off',
      description: 'Turn off a switchable entity.',
      inputSchema: {
        type: 'object',
        properties: { entity_id: { type: 'string' } },
        required: ['entity_id'],
      },
      handler: async (args) => {
        const eid = String(args.entity_id);
        const domain = eid.split('.')[0];
        if (!domain) return { text: 'invalid entity_id', isError: true };
        await ha('POST', `/api/services/${domain}/turn_off`, { entity_id: eid });
        return { text: `Turned off ${eid}` };
      },
    },
  ],
});
