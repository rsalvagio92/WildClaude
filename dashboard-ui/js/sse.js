// Single shared SSE connection to /api/chat/stream with auto-reconnect.
// Modules subscribe to event types; the connection is opened once at app start.
import { getToken, getTicket } from './api.js';

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

// The server sends NAMED SSE events (`event: <type>`), so EventSource.onmessage
// (which only fires for the default unnamed "message" event) never sees them —
// each type must be registered with addEventListener.
const SSE_EVENTS = ['processing', 'user_message', 'assistant_message', 'progress', 'error', 'ping', 'mission_update'];

export async function startSSE() {
  if (!getToken()) return;
  if (source) source.close();
  // Authenticate the stream with a short-lived ticket, not the raw token in
  // the URL. A fresh ticket is fetched on every (re)connect so it never expires
  // mid-stream's lifetime budget.
  let ticket;
  try { ticket = await getTicket(); } catch { setTimeout(startSSE, backoff); backoff = Math.min(backoff * 2, 30000); return; }
  source = new EventSource(`/api/chat/stream?ticket=${encodeURIComponent(ticket)}`);
  source.onopen = () => { backoff = 1000; setConnected(true); };
  const handle = (type) => (ev) => {
    if (type === 'ping') return; // keepalive
    let data = {};
    try { data = ev.data ? JSON.parse(ev.data) : {}; } catch { /* non-JSON */ }
    emit(type, data);
  };
  for (const type of SSE_EVENTS) source.addEventListener(type, handle(type));
  // Also handle the default event in case the server ever sends unnamed data.
  source.onmessage = (ev) => {
    try { const d = JSON.parse(ev.data); emit(d.type || 'message', d); } catch {}
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
