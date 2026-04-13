/**
 * External service dashboards for WildClaude.
 *
 * Connects to Vercel, Neon, Supabase, Stripe, Cloudflare etc.
 * and exposes their status, logs, metrics via API endpoints.
 *
 * Each service uses the user's API keys from the secrets store.
 */

import { Hono } from 'hono';
import { getSecret, registerSecret } from './secrets.js';
import { loadUserConfig, saveUserConfig } from './overlay.js';
import { logger } from './logger.js';

interface ServiceDef {
  id: string;
  name: string;
  icon: string;
  secretKey: string;
  baseUrl: string;
  endpoints: Array<{
    id: string;
    name: string;
    path: string;
    method?: string;
  }>;
}

const SERVICES: ServiceDef[] = [
  {
    id: 'vercel',
    name: 'Vercel',
    icon: '&#9650;',
    secretKey: 'VERCEL_TOKEN',
    baseUrl: 'https://api.vercel.com',
    endpoints: [
      { id: 'projects', name: 'Projects', path: '/v9/projects' },
      { id: 'deployments', name: 'Recent Deployments', path: '/v6/deployments?limit=10' },
      { id: 'domains', name: 'Domains', path: '/v5/domains' },
    ],
  },
  {
    id: 'neon',
    name: 'Neon DB',
    icon: '&#128311;',
    secretKey: 'NEON_API_KEY',
    baseUrl: 'https://console.neon.tech/api/v2',
    endpoints: [
      { id: 'projects', name: 'Projects', path: '/projects' },
    ],
  },
  {
    id: 'supabase',
    name: 'Supabase',
    icon: '&#9889;',
    secretKey: 'SUPABASE_ACCESS_TOKEN',
    baseUrl: 'https://api.supabase.com/v1',
    endpoints: [
      { id: 'projects', name: 'Projects', path: '/projects' },
    ],
  },
  {
    id: 'stripe',
    name: 'Stripe',
    icon: '&#128179;',
    secretKey: 'STRIPE_SECRET_KEY',
    baseUrl: 'https://api.stripe.com/v1',
    endpoints: [
      { id: 'balance', name: 'Balance', path: '/balance' },
      { id: 'charges', name: 'Recent Charges', path: '/charges?limit=10' },
      { id: 'customers', name: 'Customers', path: '/customers?limit=10' },
    ],
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    icon: '&#9729;',
    secretKey: 'CLOUDFLARE_API_TOKEN',
    baseUrl: 'https://api.cloudflare.com/client/v4',
    endpoints: [
      { id: 'zones', name: 'Zones (Domains)', path: '/zones' },
      { id: 'accounts', name: 'Accounts', path: '/accounts' },
    ],
  },
  {
    id: 'github',
    name: 'GitHub',
    icon: '&#128025;',
    secretKey: 'GITHUB_TOKEN',
    baseUrl: 'https://api.github.com',
    endpoints: [
      { id: 'repos', name: 'Your Repos', path: '/user/repos?sort=updated&per_page=10' },
      { id: 'notifications', name: 'Notifications', path: '/notifications?per_page=10' },
    ],
  },
  {
    id: 'sentry',
    name: 'Sentry',
    icon: '&#128027;',
    secretKey: 'SENTRY_AUTH_TOKEN',
    baseUrl: 'https://sentry.io/api/0',
    endpoints: [
      { id: 'projects', name: 'Projects', path: '/projects/' },
    ],
  },
];

/**
 * Get ALL services: built-in + user-defined from config.json.
 * User dashboards can be:
 *   1. Full ServiceDef (has baseUrl, endpoints) — standalone API dashboard
 *   2. Service-ref (has service: "vercel") — references a built-in service with project-specific config
 */
function getAllServices(): ServiceDef[] {
  const userConfig = loadUserConfig();
  const userDashboards = userConfig.dashboards || [];

  const merged = new Map<string, ServiceDef>();
  for (const s of SERVICES) merged.set(s.id, s);

  for (const ud of userDashboards) {
    const d = ud as Record<string, unknown>;
    if (!d.id || !d.name) continue;

    // Type 1: Full ServiceDef (has baseUrl)
    if (d.baseUrl && d.secretKey) {
      const svc = d as unknown as ServiceDef;
      merged.set(svc.id, svc);
      registerSecret({
        key: svc.secretKey,
        name: `${svc.name} API Key`,
        description: `For ${svc.name} dashboard`,
        feature: `dashboard-${svc.id}`,
        required: false,
      });
      continue;
    }

    // Type 2: Service-ref (has service: "vercel", "neon", etc.)
    // These reference a built-in service but with project-specific endpoints
    if (d.service && typeof d.service === 'string') {
      const parent = SERVICES.find(s => s.id === d.service);
      if (!parent) continue;
      const config = (d.config || {}) as Record<string, string>;

      // Build project-specific endpoints
      const endpoints: ServiceDef['endpoints'] = [];
      if (d.service === 'vercel' && config.projectId) {
        endpoints.push(
          { id: 'deployments', name: 'Deployments', path: `/v6/deployments?projectId=${config.projectId}&limit=5` },
          { id: 'project', name: 'Project Info', path: `/v9/projects/${config.projectId}` },
        );
      } else if (d.service === 'neon' && config.projectId) {
        endpoints.push(
          { id: 'project', name: 'Project Info', path: `/projects/${config.projectId}` },
          { id: 'branches', name: 'Branches', path: `/projects/${config.projectId}/branches` },
          { id: 'endpoints', name: 'Endpoints', path: `/projects/${config.projectId}/endpoints` },
        );
      } else if (d.service === 'supabase' && config.projectId) {
        endpoints.push(
          { id: 'project', name: 'Project', path: `/projects/${config.projectId}` },
        );
      } else {
        // Generic: just use parent endpoints
        endpoints.push(...parent.endpoints);
      }

      merged.set(String(d.id), {
        id: String(d.id),
        name: String(d.name),
        icon: parent.icon,
        secretKey: parent.secretKey,
        baseUrl: parent.baseUrl,
        endpoints,
        // Carry through the service-ref type, config, and group for frontend use
        ...(d.service ? { service: d.service } : {}),
        ...(d.config ? { config: d.config } : {}),
        ...(d.group ? { group: d.group } : {}),
      } as ServiceDef);
    }
  }

  return Array.from(merged.values());
}

/**
 * Get all configured services (have API key set).
 */
function getConfiguredServices(): Array<ServiceDef & { configured: boolean; source: 'built-in' | 'user' }> {
  const allServices = getAllServices();
  const builtInIds = new Set(SERVICES.map(s => s.id));
  return allServices.map(s => ({
    ...s,
    configured: !!getSecret(s.secretKey),
    source: builtInIds.has(s.id) ? 'built-in' as const : 'user' as const,
  }));
}

/**
 * Fetch data from an external service API.
 */
async function fetchService(serviceId: string, endpointId: string): Promise<{ data?: unknown; error?: string; status?: number }> {
  const allServices = getAllServices();
  const service = allServices.find(s => s.id === serviceId);
  if (!service) return { error: 'Unknown service' };

  const endpoint = service.endpoints.find(e => e.id === endpointId);
  if (!endpoint) return { error: 'Unknown endpoint' };

  const token = getSecret(service.secretKey);
  if (!token) return { error: `API key not set. Use /set_secret ${service.secretKey}` };

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    // Auth header — use service-specific pattern or default Bearer
    const authType = (service as ServiceDef & { authHeader?: string }).authHeader;
    if (authType === 'token') {
      headers['Authorization'] = `token ${token}`;
    } else if (authType === 'Basic') {
      headers['Authorization'] = `Basic ${Buffer.from(token).toString('base64')}`;
    } else if (authType && authType.includes('${TOKEN}')) {
      headers['Authorization'] = authType.replace('${TOKEN}', token);
    } else {
      headers['Authorization'] = `Bearer ${token}`;
    }
    // Service-specific headers
    if (service.id === 'github') {
      headers['Accept'] = 'application/vnd.github.v3+json';
    }
    // Notion requires version header
    const svcAny = service as unknown as Record<string, unknown>;
    if (svcAny.notionVersion || service.id === 'notion' || service.baseUrl?.includes('notion.com')) {
      headers['Notion-Version'] = String(svcAny.notionVersion || '2022-06-28');
    }
    // Stripe uses form encoding
    if (service.id === 'stripe' || service.baseUrl?.includes('stripe.com')) {
      delete headers['Content-Type'];
    }

    const url = service.baseUrl + endpoint.path;
    const response = await fetch(url, {
      method: endpoint.method || 'GET',
      headers,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      return { error: `${response.status}: ${text.slice(0, 200)}`, status: response.status };
    }

    const data = await response.json();
    return { data, status: response.status };
  } catch (err) {
    logger.warn({ err, serviceId, endpointId }, 'External service fetch failed');
    return { error: String(err) };
  }
}

/**
 * Register external dashboard API routes on the Hono app.
 */
export function registerExternalDashboardRoutes(app: Hono): void {

  // List all services with config status
  app.get('/api/dashboards', (c) => {
    const services = getConfiguredServices();
    return c.json({ services });
  });

  // ── Vercel-specific API routes ──────────────────────────────────────
  // Registered BEFORE the generic :service/:endpoint route to avoid conflicts.
  // These provide richer data than the generic routes.
  // Only functional when VERCEL_TOKEN is set.

  // Deployments for a specific project
  app.get('/api/dashboards/vercel/deployments', async (c) => {
    const token = getSecret('VERCEL_TOKEN');
    if (!token) return c.json({ error: 'VERCEL_TOKEN not set' }, 401);
    const projectId = c.req.query('projectId');
    const limit = c.req.query('limit') || '10';
    if (!projectId) return c.json({ error: 'projectId query param required' }, 400);
    try {
      const url = `https://api.vercel.com/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=${encodeURIComponent(limit)}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return c.json({ error: `Vercel API ${res.status}: ${(await res.text()).slice(0, 200)}` }, res.status as import('hono/utils/http-status').ContentfulStatusCode);
      const data = await res.json();
      return c.json({ data });
    } catch (err) {
      logger.warn({ err }, 'Vercel deployments fetch failed');
      return c.json({ error: String(err) }, 500);
    }
  });

  // Build logs for a specific deployment
  app.get('/api/dashboards/vercel/deployment/:id/logs', async (c) => {
    const token = getSecret('VERCEL_TOKEN');
    if (!token) return c.json({ error: 'VERCEL_TOKEN not set' }, 401);
    const deploymentId = c.req.param('id');
    try {
      const url = `https://api.vercel.com/v2/deployments/${encodeURIComponent(deploymentId)}/events`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return c.json({ error: `Vercel API ${res.status}: ${(await res.text()).slice(0, 200)}` }, res.status as import('hono/utils/http-status').ContentfulStatusCode);
      const text = await res.text();
      const lines: Array<{ text: string; created: number; type?: string }> = [];
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          lines.push({
            text: obj.text || obj.payload?.text || JSON.stringify(obj),
            created: obj.created || obj.date || 0,
            type: obj.type || 'log',
          });
        } catch {
          lines.push({ text: line, created: 0, type: 'raw' });
        }
      }
      return c.json({ data: lines });
    } catch (err) {
      logger.warn({ err }, 'Vercel deployment logs fetch failed');
      return c.json({ error: String(err) }, 500);
    }
  });

  // Project details
  app.get('/api/dashboards/vercel/project/:id', async (c) => {
    const token = getSecret('VERCEL_TOKEN');
    if (!token) return c.json({ error: 'VERCEL_TOKEN not set' }, 401);
    const projectId = c.req.param('id');
    try {
      const url = `https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return c.json({ error: `Vercel API ${res.status}: ${(await res.text()).slice(0, 200)}` }, res.status as import('hono/utils/http-status').ContentfulStatusCode);
      const data = await res.json();
      return c.json({ data });
    } catch (err) {
      logger.warn({ err }, 'Vercel project fetch failed');
      return c.json({ error: String(err) }, 500);
    }
  });

  // Project domains
  app.get('/api/dashboards/vercel/project/:id/domains', async (c) => {
    const token = getSecret('VERCEL_TOKEN');
    if (!token) return c.json({ error: 'VERCEL_TOKEN not set' }, 401);
    const projectId = c.req.param('id');
    try {
      const url = `https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}/domains`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return c.json({ error: `Vercel API ${res.status}: ${(await res.text()).slice(0, 200)}` }, res.status as import('hono/utils/http-status').ContentfulStatusCode);
      const data = await res.json();
      return c.json({ data });
    } catch (err) {
      logger.warn({ err }, 'Vercel domains fetch failed');
      return c.json({ error: String(err) }, 500);
    }
  });

  // Project environment variables (values masked)
  app.get('/api/dashboards/vercel/project/:id/env', async (c) => {
    const token = getSecret('VERCEL_TOKEN');
    if (!token) return c.json({ error: 'VERCEL_TOKEN not set' }, 401);
    const projectId = c.req.param('id');
    try {
      const url = `https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}/env`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return c.json({ error: `Vercel API ${res.status}: ${(await res.text()).slice(0, 200)}` }, res.status as import('hono/utils/http-status').ContentfulStatusCode);
      const data = await res.json() as { envs?: Array<Record<string, unknown>> };
      const envs = (data.envs || []).map((env: Record<string, unknown>) => ({
        ...env,
        value: typeof env.value === 'string' && env.value.length > 3
          ? env.value.slice(0, 3) + '***'
          : '***',
      }));
      return c.json({ data: { envs } });
    } catch (err) {
      logger.warn({ err }, 'Vercel env vars fetch failed');
      return c.json({ error: String(err) }, 500);
    }
  });

  // Reveal a single env var value (explicit action)
  app.get('/api/dashboards/vercel/project/:id/env/:envId/reveal', async (c) => {
    const token = getSecret('VERCEL_TOKEN');
    if (!token) return c.json({ error: 'VERCEL_TOKEN not set' }, 401);
    const projectId = c.req.param('id');
    const envId = c.req.param('envId');
    try {
      const url = `https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}/env/${encodeURIComponent(envId)}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return c.json({ error: `Vercel API ${res.status}: ${(await res.text()).slice(0, 200)}` }, res.status as import('hono/utils/http-status').ContentfulStatusCode);
      const data = await res.json() as Record<string, unknown>;
      return c.json({ data: { value: data.value || '' } });
    } catch (err) {
      logger.warn({ err }, 'Vercel env reveal fetch failed');
      return c.json({ error: String(err) }, 500);
    }
  });

  // ── Generic service endpoint route ────────────────────────────────────
  // Fetch data from a specific service endpoint
  app.get('/api/dashboards/:service/:endpoint', async (c) => {
    const serviceId = c.req.param('service');
    const endpointId = c.req.param('endpoint');
    const result = await fetchService(serviceId, endpointId);
    if (result.error) {
      return c.json({ error: result.error }, result.status === 401 ? 401 : 400);
    }
    return c.json({ data: result.data });
  });

  // Create a custom dashboard service (saved to user config)
  app.post('/api/dashboards', async (c) => {
    const body = await c.req.json<{
      id: string; name: string; icon?: string;
      secretKey: string; baseUrl: string; authHeader?: string;
      endpoints: Array<{ id: string; name: string; path: string }>;
    }>();
    if (!body?.id || !body?.name || !body?.baseUrl) {
      return c.json({ error: 'id, name, and baseUrl required' }, 400);
    }
    const config = loadUserConfig();
    const dashboards = config.dashboards || [];
    // Remove existing with same ID
    const filtered = dashboards.filter(d => d.id !== body.id);
    filtered.push({
      id: body.id,
      name: body.name,
      icon: body.icon || '&#128300;',
      secretKey: body.secretKey,
      baseUrl: body.baseUrl,
      authHeader: body.authHeader,
      endpoints: body.endpoints || [],
    });
    config.dashboards = filtered;
    saveUserConfig(config);
    // Auto-register the secret
    registerSecret({
      key: body.secretKey,
      name: `${body.name} API Key`,
      description: `For ${body.name} dashboard`,
      feature: `dashboard-${body.id}`,
      required: false,
    });
    return c.json({ ok: true });
  });

  // Delete a custom dashboard service
  app.delete('/api/dashboards/:service', (c) => {
    const serviceId = c.req.param('service');
    // Can only delete user-defined services
    if (SERVICES.find(s => s.id === serviceId)) {
      return c.json({ error: 'Cannot delete built-in service' }, 400);
    }
    const config = loadUserConfig();
    const dashboards = config.dashboards || [];
    config.dashboards = dashboards.filter(d => d.id !== serviceId);
    saveUserConfig(config);
    return c.json({ ok: true });
  });

  // Get user config (for UI)
  app.get('/api/config', (c) => {
    return c.json(loadUserConfig());
  });

  // Update user config
  app.put('/api/config', async (c) => {
    const body = await c.req.json<Partial<import('./overlay.js').UserConfig>>();
    if (!body) return c.json({ error: 'body required' }, 400);
    const { updateUserConfig } = await import('./overlay.js');
    const updated = updateUserConfig(body);
    return c.json({ ok: true, config: updated });
  });
}
