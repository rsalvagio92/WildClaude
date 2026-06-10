// Single shared SSE connection to /api/chat/stream with auto-reconnect.
// Modules subscribe to event types; the connection is opened once at app start.
import { getToken } from './api.js';

const listeners = new Map(); // type -> Set<fn>
let source = null;
let backoff = 1000;
let connected = false;
const statusListeners = new Set();

function emit(type, data) {
  (listeners.get(type) || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } });
  (listeners.get('*') || []).forEach((fn) => { try { fn(type, data); } catch (e) { console.error(e); } });
}

function setConnected(v) {
  connected = v;
  statusListeners.forEach((fn) => { try { fn(v); } catch {} });
}

export function startSSE() {
  const token = getToken();
  if (!token) return;
  if (source) source.close();
  source = new EventSource(`/api/chat/stream?token=${encodeURIComponent(token)}`);
  source.onopen = () => { backoff = 1000; setConnected(true); };
  source.onmessage = (ev) => {
    try {
      const parsed = JSON.parse(ev.data);
      emit(parsed.type || 'message', parsed);
    } catch { /* ignore non-JSON keepalives */ }
  };
  source.onerror = () => {
    setConnected(false);
    if (source) source.close();
    source = null;
    setTimeout(startSSE, backoff);
    backoff = Math.min(backoff * 2, 30000);
  };
}

export function onSSE(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => listeners.get(type)?.delete(fn);
}

export function onSSEStatus(fn) { statusListeners.add(fn); fn(connected); return () => statusListeners.delete(fn); }
export function sseConnected() { return connected; }
