// Framework-free UI helpers: element builder, states, modal, toast, formatters.

/** Hyperscript-lite element builder. el('div.card', {onclick}, [children|strings]) */
export function el(spec, attrs = {}, children = []) {
  const [tag, ...classes] = String(spec).split('.');
  const node = document.createElement(tag || 'div');
  if (classes.length) node.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k in node && k !== 'list') { try { node[k] = v; } catch { node.setAttribute(k, v); } }
    else node.setAttribute(k, v);
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const c of kids.flat()) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return node;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }
export function mount(container, ...nodes) { clear(container); nodes.flat().forEach((n) => n && container.appendChild(n)); }

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function loading(msg = 'Loading…') {
  return el('div.loading', {}, [el('div.spinner'), el('div', { text: msg })]);
}
export function empty(msg = 'Nothing here yet.') { return el('div.empty', { text: msg }); }
export function errbox(msg) { return el('div.errbox', { text: '⚠ ' + msg }); }

/**
 * Async render helper: shows a spinner, runs loader(), then render(data).
 * On error shows an error box. Returns a re-runnable function.
 */
export function asyncView(container, loader, render, loadingMsg) {
  const run = async () => {
    mount(container, loading(loadingMsg));
    try {
      const data = await loader();
      const out = render(data, run);
      mount(container, out);
    } catch (e) {
      mount(container, errbox(e.message || String(e)));
    }
  };
  run();
  return run;
}

export function stat(value, key) {
  return el('div.stat', {}, [el('div.v', { text: value }), el('div.k', { text: key })]);
}

export function badge(text, kind = '') { return el('span.badge' + (kind ? '.' + kind : ''), { text }); }

export function card(title, bodyNodes, headExtra) {
  const head = title ? el('div.card-head', {}, [el('h3', { text: title }), headExtra]) : null;
  return el('div.card', {}, [head, ...[].concat(bodyNodes)]);
}

// ── Modal ──────────────────────────────────────────────
export function modal({ title, body, footer, onClose, wide }) {
  const root = document.getElementById('modal-root');
  const close = () => { clear(root); onClose && onClose(); };
  const box = el('div.modal', {}, [
    el('div.modal-head', {}, [el('h3', { text: title || '' }), el('button.icon-btn', { text: '✕', onclick: close })]),
    el('div.modal-body', {}, [].concat(body || [])),
    footer ? el('div.modal-foot', {}, [].concat(footer)) : null,
  ]);
  if (wide) box.style.width = 'min(900px, 96vw)';
  const overlay = el('div.modal-overlay', {
    onclick: (e) => { if (e.target === overlay) close(); },
  }, [box]);
  document.addEventListener('keydown', function esc(ev) {
    if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });
  mount(root, overlay);
  return { close, box };
}

export function confirmDialog(message, onConfirm, { danger = true, confirmText = 'Confirm' } = {}) {
  const m = modal({
    title: 'Confirm',
    body: el('p', { text: message }),
    footer: [
      el('button.btn', { text: 'Cancel', onclick: () => m.close() }),
      el('button.btn' + (danger ? '.btn-danger' : '.btn-accent'), {
        text: confirmText,
        onclick: async () => { m.close(); await onConfirm(); },
      }),
    ],
  });
  return m;
}

// ── Toast ──────────────────────────────────────────────
export function toast(message, kind = '', ms = 3200) {
  const root = document.getElementById('toast-root');
  const t = el('div.toast' + (kind ? '.' + kind : ''), { text: message });
  root.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 250); }, ms);
}
export const toastOk = (m) => toast(m, 'ok');
export const toastErr = (m) => toast(m, 'err');

// Wrap a mutating action: runs fn, toasts ok/err, optionally refreshes.
export async function action(fn, { ok, refresh } = {}) {
  try {
    const r = await fn();
    if (ok) toastOk(ok);
    if (refresh) refresh();
    return r;
  } catch (e) {
    toastErr(e.message || String(e));
    throw e;
  }
}

// ── Formatters ─────────────────────────────────────────
export function fmtTime(ts) {
  if (!ts) return '—';
  const ms = ts > 1e12 ? ts : ts * 1000; // seconds vs ms
  const d = new Date(ms);
  if (isNaN(d)) return '—';
  return d.toLocaleString();
}
export function fmtAgo(ts) {
  if (!ts) return '—';
  const ms = ts > 1e12 ? ts : ts * 1000;
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
export function fmtBytes(b) {
  if (b == null) return '—';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(2) + ' GB';
}
export function fmtUsd(n) { return '$' + (Number(n) || 0).toFixed(4); }
export function truncate(s, n = 120) { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + '…' : s; }

// ── Charts (dependency-free inline SVG) ────────────────────────────────
const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs = {}) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

/**
 * Bar chart from [{label, value}]. Accent-coloured bars, value labels on hover
 * (title), x-axis labels thinned to avoid crowding. Returns an SVG element.
 */
export function barChart(data, { height = 140, barColor } = {}) {
  if (!data || !data.length) return empty('No data');
  const color = barColor || getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#8b5cf6';
  const W = Math.max(data.length * 14, 280), H = height, pad = 22;
  const max = Math.max(...data.map((d) => d.value || 0), 1);
  const bw = (W - pad * 2) / data.length;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, preserveAspectRatio: 'none', role: 'img' });
  const labelEvery = Math.ceil(data.length / 8);
  data.forEach((d, i) => {
    const h = Math.max(1, ((d.value || 0) / max) * (H - pad * 2));
    const x = pad + i * bw, y = H - pad - h;
    const rect = svgEl('rect', { x: x + 1, y, width: Math.max(1, bw - 2), height: h, rx: 2, fill: color, opacity: 0.85 });
    rect.appendChild(svgEl('title')).textContent = `${d.label}: ${d.display ?? d.value}`;
    svg.appendChild(rect);
    if (i % labelEvery === 0) {
      const t = svgEl('text', { x: x + bw / 2, y: H - 6, 'text-anchor': 'middle', 'font-size': 9, fill: 'var(--muted)' });
      t.textContent = String(d.label).slice(-5);
      svg.appendChild(t);
    }
  });
  return svg;
}

/** Sparkline line chart from an array of numbers. */
export function sparkline(values, { height = 60, color } = {}) {
  if (!values || values.length < 2) return empty('Not enough data');
  const stroke = color || getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#8b5cf6';
  const W = 600, H = height, pad = 4;
  const max = Math.max(...values), min = Math.min(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (W - pad * 2);
    const y = H - pad - ((v - min) / range) * (H - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, preserveAspectRatio: 'none' });
  svg.appendChild(svgEl('polyline', { points: pts, fill: 'none', stroke, 'stroke-width': 2, 'stroke-linejoin': 'round' }));
  return svg;
}

// Build a <select> from /api/models, preselecting `current`.
import { models as fetchModels } from './api.js';
export async function modelSelect(current, attrs = {}) {
  const { models: list, default: def } = await fetchModels();
  const sel = el('select', attrs);
  for (const m of list) {
    const o = el('option', { value: m.id, text: `${m.label} — ${m.description}` });
    if (m.id === (current || def)) o.selected = true;
    sel.appendChild(o);
  }
  return sel;
}
