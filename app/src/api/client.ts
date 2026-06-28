// Typed API client for a WildClaude server. Auth = Bearer DASHBOARD_TOKEN.
// Mirrors dashboard-ui/js/api.js: Bearer for REST, short-lived HMAC ticket for
// streaming (SSE/WS) so the raw token never sits in a URL.
import type { ServerProfile, ServerInfo } from '@/store/servers';
import type { ServerCap } from '@/features/manifest';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface InfoResponse {
  botName: string;
  botEmoji: string;
  role?: 'primary' | 'secondary' | 'unknown';
  capabilities?: string[];
  version?: string;
}

export class ServerClient {
  constructor(private server: ServerProfile) {}

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.server.token}`,
      ...extra,
    };
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    // Without a timeout, fetch hangs indefinitely when the host is reachable at
    // IP level but the port is filtered / not yet listening (e.g. the dashboard's
    // bind delay after a restart) — the UI would sit on "Verifico…" forever.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      res = await fetch(`${this.server.url}${path}`, {
        method,
        headers: this.headers(),
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (e) {
      throw new ApiError(
        0,
        controller.signal.aborted
          ? 'Timeout: nessuna risposta entro 12s. URL/porta corretti? Telefono sulla stessa rete o su Tailscale?'
          : 'Rete non raggiungibile — server offline, oppure HTTP bloccato (usa https o abilita cleartext).',
      );
    } finally {
      clearTimeout(timeout);
    }
    const ct = res.headers.get('content-type') || '';
    const payload = ct.includes('application/json') ? await res.json().catch(() => null) : await res.text();
    if (!res.ok) {
      const msg = payload && typeof payload === 'object' && 'error' in payload ? (payload as any).error : `HTTP ${res.status}`;
      throw new ApiError(res.status, msg);
    }
    return payload as T;
  }

  get<T>(path: string) { return this.request<T>('GET', path); }
  post<T>(path: string, body?: unknown) { return this.request<T>('POST', path, body); }
  put<T>(path: string, body?: unknown) { return this.request<T>('PUT', path, body); }
  del<T>(path: string) { return this.request<T>('DELETE', path); }

  /** Fetch a short-lived ticket for SSE/WS auth. */
  async ticket(): Promise<string> {
    const { ticket } = await this.post<{ ticket: string }>('/api/ticket');
    return ticket;
  }

  /** Probe the server: identity, role, capabilities. */
  async info(): Promise<ServerInfo> {
    const r = await this.get<InfoResponse>('/api/info');
    const known: ServerCap[] = ['chat', 'voice', 'fleet', 'dashboards', 'memory', 'agents', 'monitoring'];
    const caps = (r.capabilities || []).filter((c): c is ServerCap => (known as string[]).includes(c));
    return {
      caps,
      role: r.role ?? 'unknown',
      version: r.version,
      online: true,
    };
  }

  /** WebSocket/SSE base URL (http→ws, https→wss). */
  async streamUrl(path: string): Promise<string> {
    const t = await this.ticket();
    const base = this.server.url.replace(/^http/, 'ws');
    const sep = path.includes('?') ? '&' : '?';
    return `${base}${path}${sep}ticket=${encodeURIComponent(t)}`;
  }
}
