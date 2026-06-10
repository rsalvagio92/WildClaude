// API client + token management. All modules go through apiFetch/api*.
const TOKEN_KEY = 'wcp_token';

export function getToken() {
  // URL ?token / #token win once, then persist to sessionStorage.
  const url = new URL(location.href);
  const fromQuery = url.searchParams.get('token');
  const fromHash = new URLSearchParams(location.hash.replace(/^#/, '')).get('token');
  const t = fromQuery || fromHash;
  if (t) {
    sessionStorage.setItem(TOKEN_KEY, t);
    // Strip token from the visible URL.
    url.searchParams.delete('token');
    history.replaceState(null, '', url.pathname + url.search);
  }
  return sessionStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(t) { sessionStorage.setItem(TOKEN_KEY, t); }
export function clearToken() { sessionStorage.removeItem(TOKEN_KEY); }

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/**
 * Fetch a dashboard API endpoint with the bearer token attached.
 * Throws ApiError on non-2xx. Returns parsed JSON (or text) on success.
 */
export async function apiFetch(path, opts = {}) {
  const token = sessionStorage.getItem(TOKEN_KEY) || '';
  const headers = { ...(opts.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  let body = opts.body;
  if (body && typeof body === 'object' && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, { ...opts, headers, body });
  } catch (e) {
    throw new ApiError(0, 'Network error — is the bot running?', null);
  }
  const ct = res.headers.get('content-type') || '';
  const isJson = ct.includes('application/json');
  const payload = isJson ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    const msg = (isJson && payload && payload.error) ? payload.error : `HTTP ${res.status}`;
    throw new ApiError(res.status, msg, payload);
  }
  return payload;
}

export const api = {
  get: (p) => apiFetch(p),
  post: (p, body) => apiFetch(p, { method: 'POST', body }),
  put: (p, body) => apiFetch(p, { method: 'PUT', body }),
  patch: (p, body) => apiFetch(p, { method: 'PATCH', body }),
  del: (p) => apiFetch(p, { method: 'DELETE' }),
};

// Download a file endpoint as an attachment (auth via query token).
export function downloadUrl(path) {
  const token = sessionStorage.getItem(TOKEN_KEY) || '';
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}token=${encodeURIComponent(token)}`;
}

// The active chat id used across modules (single-user bot → owner chat).
let _chatId = null;
export async function chatId() {
  if (_chatId) return _chatId;
  try {
    const info = await api.get('/api/info');
    _chatId = info.chatId || 'dashboard';
  } catch { _chatId = 'dashboard'; }
  return _chatId;
}

// Selectable models, cached. Single source for every model dropdown.
let _models = null;
export async function models() {
  if (_models) return _models;
  try {
    _models = await api.get('/api/models');
  } catch {
    _models = { models: [{ id: 'claude-opus-4-8', alias: 'opus', label: 'Opus', description: '' }], default: 'claude-opus-4-8' };
  }
  return _models;
}
