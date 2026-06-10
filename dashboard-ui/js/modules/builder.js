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

// Two-step guided creation: describe → review recommended widgets & answer a
// few clarifying questions → generate. `opts.projectId` scopes it to a project.
export function openGenerate(refresh, opts = {}) {
  const m = modal({ title: '✨ Describe a dashboard', wide: true, body: el('div'), footer: el('div') });
  const body = m.box.querySelector('.modal-body');
  const foot = m.box.querySelector('.modal-foot');
  stepDescribe();

  function stepDescribe(prefill) {
    const promptIn = el('textarea', {
      rows: 4, style: 'width:100%', value: prefill || '',
      placeholder: 'e.g. "Track my sleep, weight and mood with trends and a goal" or "Crypto dashboard: BTC/ETH prices + top-10 table"',
    });
    mount(body, [
      el('p.muted', { text: 'Tell WildClaude what you want to track or monitor. Next, it’ll recommend features and ask a couple of quick questions before building.' }),
      el('div.field', {}, [el('label', { text: 'What should this dashboard show?' }), promptIn]),
    ]);
    mount(foot, [
      el('button.btn', { text: 'Cancel', onclick: () => m.close() }),
      el('button.btn.btn-accent', {
        text: 'Next →',
        onclick: async (ev) => {
          const prompt = promptIn.value.trim();
          if (!prompt) { toastErr('Describe what you want first'); return; }
          ev.target.disabled = true; ev.target.textContent = 'Thinking…';
          try {
            const { plan } = await api.post('/api/dash/plan', { prompt });
            stepReview(prompt, plan);
          } catch (e) {
            toastErr(e.message); ev.target.disabled = false; ev.target.textContent = 'Next →';
          }
        },
      }),
    ]);
    promptIn.focus();
  }

  function stepReview(prompt, plan) {
    m.box.querySelector('.modal-head h3').textContent = `${plan.icon || '✨'} ${plan.title || 'Dashboard'}`;
    const answers = {};
    const qNodes = (plan.questions || []).map((q) => {
      const wrap = el('div.field', {}, [el('label', { text: q.question })]);
      if (q.type === 'choice' && q.options) {
        const sel = el('select', { onchange: (e) => { answers[q.question] = e.target.value; } }, q.options.map((o) => {
          const opt = el('option', { value: o, text: o }); if (o === q.default) opt.selected = true; return opt;
        }));
        answers[q.question] = q.default || q.options[0];
        wrap.appendChild(sel);
      } else if (q.type === 'multi' && q.options) {
        const chips = el('div.chip-row');
        const picked = new Set();
        q.options.forEach((o) => chips.appendChild(el('button.chip', {
          text: o, type: 'button',
          onclick: (e) => { e.target.classList.toggle('on'); picked.has(o) ? picked.delete(o) : picked.add(o); answers[q.question] = [...picked].join(', '); },
        })));
        wrap.appendChild(chips);
      } else {
        const inp = el('input', { type: 'text', placeholder: q.default || '', oninput: (e) => { answers[q.question] = e.target.value; } });
        wrap.appendChild(inp);
      }
      return wrap;
    });

    mount(body, [
      plan.summary ? el('p.muted', { text: plan.summary }) : null,
      (plan.recommendedWidgets && plan.recommendedWidgets.length) ? el('div', {}, [
        el('label', { text: 'Recommended widgets' }),
        el('div.chip-row', { style: 'margin-bottom:10px' }, plan.recommendedWidgets.map((w) => el('span.chip.static', { text: w }))),
      ]) : null,
      qNodes.length ? el('label', { text: 'A couple of quick questions' }) : el('p.muted', { text: 'No questions — ready to build.' }),
      ...qNodes,
    ]);
    mount(foot, [
      el('button.btn', { text: '← Back', onclick: () => { m.box.querySelector('.modal-head h3').textContent = '✨ Describe a dashboard'; stepDescribe(prompt); } }),
      el('button.btn.btn-accent', {
        text: '✨ Build it',
        onclick: async (ev) => {
          ev.target.disabled = true; ev.target.textContent = 'Designing…';
          try {
            const { dashboard } = await api.post('/api/dash', { prompt, answers, projectId: opts.projectId });
            toastOk(`Created "${dashboard.title}" with ${dashboard.widgets.length} widgets`);
            m.close();
            refresh && refresh();
          } catch (e) { toastErr(e.message); ev.target.disabled = false; ev.target.textContent = '✨ Build it'; }
        },
      }),
    ]);
  }
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

function openDashboard(root, id, opts = {}) {
  clear(root);
  const editing = !!opts.editing;
  const head = el('div.page-head', {}, [
    el('div', {}, [el('h3', { text: 'Loading…' })]),
    el('div.btn-row', {}, [el('button.btn', { text: '← All dashboards', onclick: () => renderIndex(root) })]),
  ]);
  const grid = el('div.dash-grid');
  mount(root, head, grid);
  mount(grid, loading('Loading widgets…'));

  api.get('/api/dash/' + encodeURIComponent(id)).then(({ dashboard }) => {
    const reopen = (o) => openDashboard(root, id, o);
    mount(head, el('div', {}, [
      el('h3', { text: `${dashboard.icon || '📊'} ${dashboard.title}` }),
      dashboard.description ? el('p.muted', { text: dashboard.description, style: 'font-size:12px' }) : null,
    ]), el('div.btn-row', {}, [
      el('button.btn.btn-accent', { text: '✨ Improve', onclick: () => openImprove(dashboard, () => reopen({ editing })) }),
      el('button.btn' + (editing ? '.btn-accent' : ''), { text: editing ? '✓ Done' : '✎ Edit', onclick: () => reopen({ editing: !editing }) }),
      el('button.btn.btn-sm', { text: '{ } Spec', onclick: () => editSpec(dashboard, () => reopen({ editing })) }),
      el('button.icon-btn', { text: '⟳', onclick: () => reopen({ editing }) }),
      el('button.btn', { text: '← All', onclick: () => renderIndex(root) }),
    ]));
    clear(grid);
    const widgets = dashboard.widgets || [];
    widgets.forEach((w, i) => grid.appendChild(widgetTile(dashboard, w, i, editing, () => reopen({ editing }))));
  }).catch((e) => mount(grid, errbox(e.message)));
}

function widgetTile(dashboard, w, index, editing, reload) {
  const dashId = dashboard.id;
  const span = Math.min(12, Math.max(1, w.w || 4));
  const tile = el('div.dash-tile' + (editing ? '.editing' : ''), { style: `grid-column: span ${span};` });
  const headChildren = [el('h4', { text: w.title, style: 'margin:0;font-size:14px;flex:1' })];
  if (editing) headChildren.push(widgetEditControls(dashboard, index, reload));
  const head = el('div.row', {}, headChildren);
  const bodyBox = el('div', { style: 'margin-top:8px' });
  mount(tile, head, bodyBox);

  // Forms render locally (no resolve); notes render markdown; insights are on-demand.
  if (w.type === 'form') { mount(bodyBox, formWidget(dashId, w)); return tile; }
  if (w.type === 'note') { mount(bodyBox, noteWidget(w)); return tile; }
  if (w.type === 'insight') { mount(bodyBox, insightWidget(dashId, w)); return tile; }

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

// ── Direct editing: per-widget controls + raw spec + conversational refine ──

function widgetEditControls(dashboard, index, reload) {
  const save = async (mutate) => {
    const widgets = dashboard.widgets.map((x) => ({ ...x }));
    mutate(widgets);
    try { await api.put('/api/dash/' + encodeURIComponent(dashboard.id), { ...dashboard, widgets }); reload(); }
    catch (e) { toastErr(e.message); }
  };
  return el('div.btn-row.tile-tools', {}, [
    el('button.icon-btn.sm', { title: 'Narrower', text: '−', onclick: () => save((ws) => { ws[index].w = Math.max(1, (ws[index].w || 4) - 2); }) }),
    el('button.icon-btn.sm', { title: 'Wider', text: '+', onclick: () => save((ws) => { ws[index].w = Math.min(12, (ws[index].w || 4) + 2); }) }),
    el('button.icon-btn.sm', { title: 'Move left', text: '◀', onclick: () => save((ws) => { if (index > 0) { const t = ws[index - 1]; ws[index - 1] = ws[index]; ws[index] = t; } }) }),
    el('button.icon-btn.sm', { title: 'Move right', text: '▶', onclick: () => save((ws) => { if (index < ws.length - 1) { const t = ws[index + 1]; ws[index + 1] = ws[index]; ws[index] = t; } }) }),
    el('button.icon-btn.sm.danger', { title: 'Delete widget', text: '✕', onclick: () => confirmDialog(`Delete widget "${dashboard.widgets[index].title}"?`, () => save((ws) => { ws.splice(index, 1); }), { danger: true, confirmText: 'Delete' }) }),
  ]);
}

// Conversational / voice refinement of the whole dashboard.
function openImprove(dashboard, reload) {
  const ta = el('textarea', { rows: 3, style: 'width:100%', placeholder: 'e.g. "make the weight chart full width and add a 7-day average; drop the table; add a steps goal of 10,000"' });
  const mic = micButton((t) => { ta.value = (ta.value ? ta.value + ' ' : '') + t; ta.focus(); }, { title: 'Speak your changes' });
  const examples = el('div.chip-row', { style: 'margin-bottom:8px' },
    ['Make it more visual', 'Add a goal gauge', 'Bigger charts', 'Add an AI insight', 'Remove the table', 'Add a streak counter'].map((s) =>
      el('span.chip', { text: s, onclick: () => { ta.value = (ta.value ? ta.value + '. ' : '') + s; ta.focus(); } })));
  const m = modal({
    title: '✨ Improve this dashboard',
    wide: true,
    body: [
      el('p.muted', { text: 'Describe the changes in plain language — or tap the mic and speak them. Your logged data is preserved.' }),
      examples,
      el('div.field', {}, [el('div.row', {}, [el('label', { text: 'What should change?', style: 'flex:1' }), mic].filter(Boolean)), ta]),
    ],
    footer: [
      el('button.btn', { text: 'Cancel', onclick: () => m.close() }),
      el('button.btn.btn-accent', {
        text: 'Apply',
        onclick: async (ev) => {
          const prompt = ta.value.trim();
          if (!prompt) { toastErr('Describe a change first'); return; }
          ev.target.disabled = true; ev.target.textContent = 'Applying…';
          try {
            const { dashboard: upd } = await api.post('/api/dash/' + encodeURIComponent(dashboard.id) + '/refine', { prompt });
            toastOk(`Updated — ${upd.widgets.length} widgets`);
            m.close();
            reload();
          } catch (e) { toastErr(e.message); ev.target.disabled = false; ev.target.textContent = 'Apply'; }
        },
      }),
    ],
  });
  ta.focus();
}

// Editable raw spec (power users).
function editSpec(dashboard, reload) {
  const ta = el('textarea', { rows: 20, style: 'width:100%;font-family:monospace;font-size:12px' });
  ta.value = JSON.stringify(dashboard, null, 2);
  const m = modal({
    title: 'Edit spec (JSON)',
    wide: true,
    body: [el('p.muted', { text: 'Advanced — edit the raw dashboard spec. Saving replaces the whole spec; widget ids drive tracker data, so keep them stable.' }), el('div.field', {}, [ta])],
    footer: [
      el('button.btn', { text: 'Cancel', onclick: () => m.close() }),
      el('button.btn.btn-accent', {
        text: 'Save',
        onclick: async () => {
          let spec;
          try { spec = JSON.parse(ta.value); } catch (e) { toastErr('Invalid JSON: ' + e.message); return; }
          try { await api.put('/api/dash/' + encodeURIComponent(dashboard.id), spec); toastOk('Saved'); m.close(); reload(); }
          catch (e) { toastErr(e.message); }
        },
      }),
    ],
  });
}

// ── Widget renderers by type ───────────────────────────────────────────

function renderWidget(w, data, ctx) {
  switch (w.type) {
    case 'metric': return metricWidget(w, data);
    case 'gauge': return gaugeWidget(w, data);
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
  // Delta aggregation: { current, previous, changePct } → value + ▲/▼ pill.
  if (data && typeof data === 'object' && !Array.isArray(data) && 'changePct' in data) {
    const pct = data.changePct;
    const up = pct != null && pct >= 0;
    const pill = pct == null
      ? el('span.delta.flat', { text: 'new' })
      : el('span.delta' + (up ? '.up' : '.down'), { text: `${up ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%` });
    return el('div', {}, [el('div.metric-big', { text: fmtNumber(data.current, cfg) }), pill]);
  }
  let val = data;
  if (val && typeof val === 'object' && !Array.isArray(val)) val = val[cfg.field] ?? val.value ?? Object.values(val)[0];
  return el('div.metric-big', { text: fmtNumber(val, cfg) });
}

function gaugeWidget(w, data) {
  const cfg = w.config || {};
  const target = Number(cfg.target) || 0;
  let val = data;
  if (val && typeof val === 'object' && !Array.isArray(val)) val = val.current ?? val[cfg.field] ?? val.value ?? Object.values(val)[0];
  val = Number(val) || 0;
  const pct = target > 0 ? Math.min(100, Math.max(0, (val / target) * 100)) : 0;
  const bar = el('div.gauge-track', {}, [el('div.gauge-fill', { style: `width:${pct}%` })]);
  return el('div', {}, [
    el('div.gauge-head', {}, [
      el('span.metric-mid', { text: fmtNumber(val, cfg) }),
      el('span.muted', { text: target ? ` / ${fmtNumber(target, cfg)}` : '', style: 'font-size:13px' }),
    ]),
    bar,
    el('span.muted', { text: target ? `${pct.toFixed(0)}% of goal` : 'Set a target', style: 'font-size:11px' }),
  ]);
}

// Insight widget: on-demand AI read of the logged data.
function insightWidget(dashId, w) {
  const out = el('div.insight-body', {});
  const gen = el('button.btn.btn-sm.btn-accent', {
    text: '✨ Generate insight',
    onclick: async () => {
      mount(out, loading('Analysing…'));
      try {
        const { text } = await api.post(`/api/dash/${encodeURIComponent(dashId)}/insight/${encodeURIComponent(w.id)}`, {});
        mount(out, el('p', { text: text || 'No insight available.' }));
      } catch (e) { mount(out, errbox(e.message)); }
    },
  });
  return el('div', {}, [out, el('div.btn-row', { style: 'margin-top:8px' }, [gen])]);
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

  const fill = (values) => { for (const f of fields) if (values && f.name in values && values[f.name] != null) inputs[f.name].value = values[f.name]; };
  const submit = el('button.btn.btn-sm.btn-accent', {
    text: (w.config && w.config.submitLabel) || 'Save',
    onclick: async () => {
      const values = {};
      for (const f of fields) {
        const raw = inputs[f.name].value;
        if (raw === '') continue;
        values[f.name] = f.type === 'number' ? Number(raw) : raw;
      }
      try {
        await api.post(`/api/dash/${encodeURIComponent(dashId)}/data`, { widgetId: w.id, values });
        toastOk('Logged');
        for (const f of fields) inputs[f.name].value = '';
      } catch (e) { toastErr(e.message); }
    },
  });

  const btnRow = el('div.btn-row', { style: 'margin-top:6px' }, [submit, voiceButton(dashId, w, fill)]);
  return el('div', {}, [...rows, btnRow]);
}

// Reusable 🎤 button backed by the Web Speech API. Returns null where the
// browser has no speech recognition (button is simply omitted). Calls
// onText(transcript) when a phrase is recognised.
function micButton(onText, { label = '🎤 Speak', title = 'Speak' } = {}) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  let listening = false;
  const btn = el('button.btn.btn-sm', { type: 'button', title, text: label });
  btn.onclick = () => {
    if (listening) return;
    const rec = new SR();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    listening = true; btn.textContent = '● Listening…'; btn.classList.add('rec');
    rec.onresult = (ev) => { try { onText(ev.results[0][0].transcript); } catch (e) { toastErr(e.message); } };
    rec.onerror = (ev) => toastErr('Voice error: ' + (ev.error || 'unknown'));
    rec.onend = () => { listening = false; btn.textContent = label; btn.classList.remove('rec'); };
    try { rec.start(); } catch { listening = false; btn.textContent = label; btn.classList.remove('rec'); }
  };
  return btn;
}

// 🎤 on a tracker form: transcribe → backend maps text onto fields → prefill.
function voiceButton(dashId, w, fill) {
  return micButton(async (transcript) => {
    try {
      const { values } = await api.post(`/api/dash/${encodeURIComponent(dashId)}/parse-entry`, { widgetId: w.id, transcript });
      fill(values);
      toastOk(`Heard: "${transcript}"`);
    } catch (e) { toastErr(e.message); }
  }, { title: 'Speak an entry' });
}

function safeStringify(data) {
  try { return JSON.stringify(data, null, 2); } catch { return String(data); }
}
