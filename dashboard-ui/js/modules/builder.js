// Dashboard Builder — create & view declarative dashboards (the /api/dash engine).
// Build from a template, describe one in plain language (LLM generates the spec),
// or open an existing one. Widgets render generically and resolve server-side.
import { api } from '../api.js';
import {
  el, mount, clear, escapeHtml, badge, card, empty, loading, errbox,
  modal, confirmDialog, toast, toastOk, toastErr, action, fmtTime, truncate,
  barChart, sparkline,
} from '../ui.js';

export default {
  async mount(view, params) {
    const root = el('div');
    mount(view, root);
    // Deep link: #/builder?id=<dashboardId> opens a dashboard directly.
    const id = params && params.id;
    if (id) openDashboard(root, id);
    else renderIndex(root);
  },
};

// ── Index: cards for each dashboard + create actions ──────────────────

function renderIndex(root) {
  const run = () => renderIndex(root);

  const head = el('div.page-head', {}, [
    el('div', {}, [
      el('h3', { text: 'Dashboards' }),
      el('p.muted', { text: 'Build a custom dashboard from a template or just describe what you want.' }),
    ]),
    el('div.btn-row', {}, [
      el('button.btn.btn-accent', { text: '✨ Describe a dashboard', onclick: () => openGenerate(run) }),
      el('button.btn', { text: '+ From template', onclick: () => openTemplates(run) }),
      el('button.icon-btn', { text: '⟳', onclick: run }),
    ]),
  ]);

  const grid = el('div.grid.grid-3');
  mount(root, head, grid);
  mount(grid, loading('Loading dashboards…'));

  api.get('/api/dash').then(({ dashboards }) => {
    if (!dashboards || !dashboards.length) {
      mount(grid, empty('No dashboards yet. Describe one or pick a template to get started.'));
      return;
    }
    mount(grid, ...dashboards.map((d) => dashCard(d, root, run)));
  }).catch((e) => mount(grid, errbox(e.message)));
}

function dashCard(d, root, refresh) {
  const head = el('div.row', {}, [
    el('span', { html: escapeHtml(d.icon || '📊'), style: 'font-size:18px' }),
    el('h3', { text: d.title, style: 'margin:0' }),
    d.builtinTemplate ? badge('template', '') : null,
  ]);
  const meta = el('p.muted', { text: `${(d.widgets || []).length} widgets · updated ${fmtTime(d.updatedAt)}`, style: 'font-size:12px' });
  const desc = d.description ? el('p.muted', { text: truncate(d.description, 100), style: 'font-size:12px' }) : null;
  const btnRow = el('div.btn-row', { style: 'margin-top:10px' }, [
    el('button.btn.btn-sm.btn-accent', { text: 'Open', onclick: () => openDashboard(root, d.id) }),
    el('button.btn.btn-sm', { text: 'Spec', onclick: () => viewSpec(d.id) }),
    el('button.btn.btn-sm.btn-danger', {
      text: 'Delete',
      onclick: () => confirmDialog(`Delete dashboard "${d.title}"?`, () =>
        action(() => api.del('/api/dash/' + encodeURIComponent(d.id)), { ok: 'Deleted', refresh }), { danger: true, confirmText: 'Delete' }),
    }),
  ]);
  return el('div.card', {}, [head, desc, meta, btnRow]);
}

// ── Create flows ──────────────────────────────────────────────────────

function openGenerate(refresh) {
  const promptIn = el('textarea', {
    rows: 4, style: 'width:100%',
    placeholder: 'e.g. "A crypto dashboard with BTC/ETH prices and a table of the top 10 coins" or "A reading tracker where I log books and see pages-per-week"',
  });
  const m = modal({
    title: '✨ Describe a dashboard',
    wide: true,
    body: [
      el('p.muted', { text: 'Tell WildClaude what you want to track or monitor. It will design the widgets and wire public data sources.' }),
      el('div.field', {}, [el('label', { text: 'What should this dashboard show?' }), promptIn]),
    ],
    footer: [
      el('button.btn', { text: 'Cancel', onclick: () => m.close() }),
      el('button.btn.btn-accent', {
        text: 'Generate',
        onclick: async (ev) => {
          const prompt = promptIn.value.trim();
          if (!prompt) { toastErr('Describe what you want first'); return; }
          const btn = ev.target;
          btn.disabled = true; btn.textContent = 'Designing…';
          try {
            const { dashboard } = await api.post('/api/dash', { prompt });
            toastOk(`Created "${dashboard.title}" with ${dashboard.widgets.length} widgets`);
            m.close();
            refresh && refresh();
          } catch (e) {
            toastErr(e.message);
            btn.disabled = false; btn.textContent = 'Generate';
          }
        },
      }),
    ],
  });
}

function openTemplates(refresh) {
  const m = modal({ title: '+ From template', wide: true, body: loading('Loading templates…') });
  const body = m.box.querySelector('.modal-body');
  api.get('/api/dash/templates').then(({ templates }) => {
    if (!templates || !templates.length) { mount(body, empty('No templates available.')); return; }
    mount(body, el('div.grid.grid-2', {}, templates.map((t) => el('div.card', {}, [
      el('div.row', {}, [el('span', { html: escapeHtml(t.icon || '📊'), style: 'font-size:18px' }), el('h3', { text: t.title, style: 'margin:0' })]),
      el('p.muted', { text: t.description || '', style: 'font-size:12px' }),
      el('button.btn.btn-sm.btn-accent', {
        text: 'Use this',
        onclick: () => action(() => api.post('/api/dash', { templateId: t.id }), {
          ok: 'Dashboard created', refresh: () => { m.close(); refresh && refresh(); },
        }),
      }),
    ]))));
  }).catch((e) => mount(body, errbox(e.message)));
}

function viewSpec(id) {
  const m = modal({ title: 'Dashboard spec', wide: true, body: loading('Loading…') });
  const body = m.box.querySelector('.modal-body');
  api.get('/api/dash/' + encodeURIComponent(id))
    .then(({ dashboard }) => mount(body, el('pre.block', { text: JSON.stringify(dashboard, null, 2), style: 'max-height:60vh;overflow:auto;font-size:12px' })))
    .catch((e) => mount(body, errbox(e.message)));
}

// ── Open one dashboard: render its widget grid ─────────────────────────

function openDashboard(root, id) {
  clear(root);
  const head = el('div.page-head', {}, [
    el('div', {}, [el('h3', { text: 'Loading…' })]),
    el('div.btn-row', {}, [
      el('button.btn', { text: '← All dashboards', onclick: () => renderIndex(root) }),
      el('button.icon-btn', { text: '⟳', onclick: () => openDashboard(root, id) }),
    ]),
  ]);
  const grid = el('div.dash-grid');
  mount(root, head, grid);
  mount(grid, loading('Loading widgets…'));

  api.get('/api/dash/' + encodeURIComponent(id)).then(({ dashboard }) => {
    mount(head, el('div', {}, [
      el('h3', { text: `${dashboard.icon || '📊'} ${dashboard.title}` }),
      dashboard.description ? el('p.muted', { text: dashboard.description, style: 'font-size:12px' }) : null,
    ]), el('div.btn-row', {}, [
      el('button.btn', { text: '← All dashboards', onclick: () => renderIndex(root) }),
      el('button.icon-btn', { text: '⟳', onclick: () => openDashboard(root, id) }),
    ]));
    clear(grid);
    for (const w of dashboard.widgets || []) grid.appendChild(widgetTile(dashboard.id, w));
  }).catch((e) => mount(grid, errbox(e.message)));
}

function widgetTile(dashId, w) {
  const span = Math.min(12, Math.max(1, w.w || 4));
  const tile = el('div.dash-tile', { style: `grid-column: span ${span};` });
  const head = el('div.row', {}, [el('h4', { text: w.title, style: 'margin:0;font-size:14px' })]);
  const bodyBox = el('div', { style: 'margin-top:8px' });
  mount(tile, head, bodyBox);

  // Forms render locally (no resolve); note widgets render their markdown.
  if (w.type === 'form') { mount(bodyBox, formWidget(dashId, w)); return tile; }
  if (w.type === 'note') { mount(bodyBox, noteWidget(w)); return tile; }

  // Data widgets resolve server-side.
  mount(bodyBox, loading('…'));
  const load = () => api.get(`/api/dash/${encodeURIComponent(dashId)}/widget/${encodeURIComponent(w.id)}`)
    .then((res) => {
      if (!res.ok) { mount(bodyBox, errbox(res.error || 'resolve failed')); return; }
      mount(bodyBox, renderWidget(w, res.data));
    })
    .catch((e) => mount(bodyBox, errbox(e.message)));
  load();
  if (w.refreshSec && w.refreshSec >= 15) {
    const t = setInterval(() => { if (document.body.contains(tile)) load(); else clearInterval(t); }, w.refreshSec * 1000);
  }
  return tile;
}

// ── Widget renderers by type ───────────────────────────────────────────

function renderWidget(w, data) {
  switch (w.type) {
    case 'metric': return metricWidget(w, data);
    case 'chart': return chartWidget(w, data);
    case 'table': return tableWidget(w, data);
    case 'list': return listWidget(w, data);
    case 'feed': return feedWidget(data);
    default: return el('pre.block', { text: safeStringify(data), style: 'max-height:240px;overflow:auto;font-size:12px' });
  }
}

function fmtNumber(v, cfg = {}) {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? '—');
  if (cfg.format === 'currency') return (cfg.unit || '$') + n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (cfg.format === 'percent') return n.toFixed(2) + '%';
  if (cfg.format === 'compact') return Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  const dec = cfg.decimals != null ? n.toFixed(cfg.decimals) : n.toLocaleString();
  return (cfg.unit && cfg.format !== 'currency' ? '' : '') + dec + (cfg.unit && cfg.format !== 'currency' ? ' ' + cfg.unit : '');
}

function metricWidget(w, data) {
  const cfg = w.config || {};
  // 'last' aggregation may return an object — pick the configured field.
  let val = data;
  if (val && typeof val === 'object' && !Array.isArray(val)) val = val[cfg.field] ?? val.value ?? Object.values(val)[0];
  return el('div.metric-big', { text: fmtNumber(val, cfg) });
}

function chartWidget(w, data) {
  const cfg = w.config || {};
  const arr = Array.isArray(data) ? data : [];
  if (!arr.length) return empty('No data yet');
  const xKey = cfg.x || 'day', yKey = cfg.y || 'value';
  if (cfg.kind === 'line') {
    return sparkline(arr.map((d) => Number(d[yKey]) || 0), { height: 90 });
  }
  return barChart(arr.map((d) => ({ label: String(d[xKey]), value: Number(d[yKey]) || 0, display: fmtNumber(d[yKey], cfg) })), { height: 130 });
}

function tableWidget(w, data) {
  const rows = Array.isArray(data) ? data : (data ? [data] : []);
  if (!rows.length) return empty('No rows');
  const cfg = w.config || {};
  const cols = (cfg.columns && cfg.columns.length)
    ? cfg.columns
    : [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => !k.startsWith('_')).slice(0, 6).map((k) => ({ key: k, label: k }));
  return el('div.table-wrap', {}, [el('table', {}, [
    el('thead', {}, el('tr', {}, cols.map((c) => el('th', { text: c.label || c.key })))),
    el('tbody', {}, rows.slice(0, 50).map((r) => el('tr', {}, cols.map((c) => {
      const v = r[c.key];
      const text = (c.format && v != null) ? fmtNumber(v, c) : (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
      return el('td', { text: truncate(text, 80) });
    })))),
  ])]);
}

function listWidget(w, data) {
  const items = Array.isArray(data) ? data : [];
  if (!items.length) return empty('Empty');
  return el('ul.clean-list', {}, items.slice(0, 20).map((it) =>
    el('li', { text: typeof it === 'object' ? (it.title || it.name || JSON.stringify(it)) : String(it) })));
}

function feedWidget(data) {
  const items = Array.isArray(data) ? data : [];
  if (!items.length) return empty('No items');
  return el('ul.feed-list', {}, items.slice(0, 15).map((it) => el('li', {}, [
    it.link
      ? el('a', { href: it.link, target: '_blank', rel: 'noopener', text: it.title || it.link })
      : el('span', { text: it.title || '—' }),
    it.date ? el('span.muted', { text: ' · ' + truncate(it.date, 24), style: 'font-size:11px' }) : null,
  ])));
}

function noteWidget(w) {
  const md = (w.config && (w.config.markdown || w.config.text)) || '';
  return el('div.note-body', { text: md });
}

// ── Form widget: append tracker entries ────────────────────────────────

function formWidget(dashId, w) {
  const fields = (w.config && w.config.fields) || [{ name: 'value', label: 'Value', type: 'number' }];
  const inputs = {};
  const rows = fields.map((f) => {
    const input = el('input', { type: f.type === 'number' ? 'number' : 'text', placeholder: f.label || f.name, step: f.type === 'number' ? 'any' : undefined });
    inputs[f.name] = input;
    return el('div.field', {}, [el('label', { text: f.label || f.name }), input]);
  });
  const submit = el('button.btn.btn-sm.btn-accent', {
    text: (w.config && w.config.submitLabel) || 'Save',
    onclick: async () => {
      const values = {};
      for (const f of fields) {
        const raw = inputs[f.name].value;
        values[f.name] = f.type === 'number' ? Number(raw) : raw;
      }
      try {
        await api.post(`/api/dash/${encodeURIComponent(dashId)}/data`, { widgetId: w.id, values });
        toastOk('Saved');
        for (const f of fields) inputs[f.name].value = '';
      } catch (e) { toastErr(e.message); }
    },
  });
  return el('div', {}, [...rows, el('div.btn-row', { style: 'margin-top:6px' }, [submit])]);
}

function safeStringify(data) {
  try { return JSON.stringify(data, null, 2); } catch { return String(data); }
}
