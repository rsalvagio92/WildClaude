// Agent Hub — grid of agent cards grouped by lane; model + prompt editing, lifecycle, drill-downs.
import { api, chatId } from '../api.js';
import {
  el, mount, clear, escapeHtml, asyncView, stat, badge, card, modal,
  confirmDialog, toast, toastOk, toastErr, action, modelSelect, fmtUsd, fmtTime, truncate, empty, loading, errbox,
} from '../ui.js';

const LANES = ['build', 'review', 'domain', 'coordination', 'life'];
const LANE_LABELS = {
  build: 'Build', review: 'Review', domain: 'Domain', coordination: 'Coordination', life: 'Life', '': 'Other',
};

export default {
  async mount(view) {
    const cid = await chatId();
    const root = el('div');
    mount(view, root);

    const reload = () => render();
    const render = () => asyncView(root, () => api.get('/api/agents'), (data, rerun) => {
      const agents = (data && data.agents) || [];

      // ── Page head with global controls ──
      const head = el('div.page-head', {}, [
        el('div', {}, [
          el('h3', { text: 'Agent Hub' }),
          el('p.muted', { text: `${agents.length} agents across ${LANES.length} lanes` }),
        ]),
        el('div.btn-row', {}, [
          el('button.btn.btn-accent', { text: '+ New agent', onclick: () => openCreate(rerun) }),
        ]),
      ]);

      // ── Set-all-models control ──
      const setAllWrap = el('div.row', { style: 'gap:8px;align-items:center' });
      const setAllBtn = el('button.btn.btn-sm', { text: 'Set all models' });
      let setAllValue = null;
      modelSelect(null, {
        onchange: (e) => { setAllValue = e.target.value; },
      }).then((sel) => {
        setAllValue = sel.value;
        setAllWrap.appendChild(el('span.dim', { text: 'Apply to every agent:' }));
        setAllWrap.appendChild(sel);
        setAllWrap.appendChild(setAllBtn);
      });
      setAllBtn.addEventListener('click', () => {
        if (!setAllValue) return;
        confirmDialog(`Set ALL agents to ${setAllValue.replace('claude-', '')}?`, () =>
          action(() => api.patch('/api/agents/model', { model: setAllValue }), {
            refresh: rerun,
          }).then((r) => toastOk(`Updated ${(r && r.updated && r.updated.length) || 0} agents`)),
          { danger: false, confirmText: 'Set all' });
      });
      const setAllCard = card('Bulk model', [setAllWrap]);

      // ── Group by lane ──
      const byLane = new Map();
      for (const a of agents) {
        const lane = LANES.includes(a.lane) ? a.lane : '';
        if (!byLane.has(lane)) byLane.set(lane, []);
        byLane.get(lane).push(a);
      }
      const orderedLanes = [...LANES.filter((l) => byLane.has(l)), ...(byLane.has('') ? [''] : [])];

      const sections = orderedLanes.map((lane) => {
        const cards = byLane.get(lane).map((a) => agentCard(a, cid, rerun));
        return el('div', { style: 'margin-top:18px' }, [
          el('div.section-title', { text: LANE_LABELS[lane] || lane }),
          el('div.grid.grid-2', {}, cards),
        ]);
      });

      if (!agents.length) {
        return el('div', {}, [head, setAllCard, empty('No agents found.')]);
      }
      return el('div', {}, [head, setAllCard, ...sections]);
    });

    render();
    return () => {};
  },
};

// ── Single agent card ───────────────────────────────────────────────
function agentCard(a, cid, rerun) {
  const isMain = a.id === 'main';
  const head = el('div.row', { style: 'justify-content:space-between;align-items:flex-start;gap:8px' }, [
    el('div', {}, [
      el('h3', { text: a.name || a.id, style: 'margin:0' }),
      el('div.dim', { style: 'font-size:12px', text: a.id }),
    ]),
    el('div.row', { style: 'gap:4px;flex-wrap:wrap;justify-content:flex-end' }, [
      a.lane ? badge(a.lane, 'accent') : null,
      a.running ? badge('running', 'ok') : badge('idle'),
    ]),
  ]);

  const desc = el('p.muted', { style: 'margin:8px 0', text: truncate(a.description || '—', 140) });

  const stats = el('div.row', { style: 'gap:14px;margin:6px 0' }, [
    el('span.dim', { text: `${a.todayTurns ?? 0} turns today` }),
    el('span.dim', { text: fmtUsd(a.todayCost ?? 0) + ' today' }),
  ]);

  // Per-card model dropdown
  const modelWrap = el('div.field', {}, [el('label', { text: 'Model' })]);
  modelSelect(a.model, {
    onchange: (e) => action(() => api.patch(`/api/agents/${encodeURIComponent(a.id)}/model`, { model: e.target.value }), {
      ok: `Model → ${e.target.value.replace('claude-', '')}`,
    }),
  }).then((sel) => modelWrap.appendChild(sel));

  // Drill-down actions
  const drillRow = el('div.btn-row', { style: 'margin-top:8px' }, [
    el('button.btn.btn-sm', { text: 'Conversation', onclick: () => openConversation(a, cid) }),
    el('button.btn.btn-sm', { text: 'Tasks', onclick: () => openTasks(a) }),
    el('button.btn.btn-sm', { text: 'Tokens', onclick: () => openTokens(a) }),
    a.lane ? el('button.btn.btn-sm', { text: 'Edit prompt', onclick: () => openEditPrompt(a, rerun) }) : null,
  ]);

  // Lifecycle actions (non-main only)
  const lifeRow = !isMain ? el('div.btn-row', { style: 'margin-top:6px' }, [
    el('button.btn.btn-sm', {
      text: 'Activate',
      onclick: () => action(() => api.post(`/api/agents/${encodeURIComponent(a.id)}/activate`), { ok: 'Activated', refresh: rerun }),
    }),
    el('button.btn.btn-sm', {
      text: 'Deactivate',
      onclick: () => action(() => api.post(`/api/agents/${encodeURIComponent(a.id)}/deactivate`), { ok: 'Deactivated', refresh: rerun }),
    }),
    el('button.btn.btn-sm.btn-danger', {
      text: 'Delete',
      onclick: () => confirmDialog(`Delete agent "${a.id}" entirely? This removes its files and service.`, () =>
        action(() => api.del(`/api/agents/${encodeURIComponent(a.id)}/full`), { ok: 'Deleted', refresh: rerun }),
        { danger: true, confirmText: 'Delete' }),
    }),
  ]) : null;

  return el('div.card', {}, [head, desc, stats, modelWrap, drillRow, lifeRow]);
}

// ── Conversation modal ──────────────────────────────────────────────
function openConversation(a, cid) {
  const body = el('div', {}, [loading('Loading conversation…')]);
  modal({ title: `${a.name || a.id} · Recent conversation`, body, wide: true });
  api.get(`/api/agents/${encodeURIComponent(a.id)}/conversation?chatId=${encodeURIComponent(cid)}&limit=6`)
    .then(({ turns }) => {
      if (!turns || !turns.length) { mount(body, empty('No conversation yet.')); return; }
      const list = turns.map((t) => el('div.bubble.' + (t.role === 'user' ? 'user' : 'assistant'), {
        style: 'margin-bottom:8px',
        html: escapeHtml(t.content || ''),
      }, [
        (t.created_at || t.model) ? el('div.bubble-meta', {
          text: [t.role, t.model && t.model.replace('claude-', ''), t.created_at && fmtTime(t.created_at)].filter(Boolean).join(' · '),
        }) : null,
      ]));
      mount(body, ...list);
    })
    .catch((e) => mount(body, errbox(e.message)));
}

// ── Tasks modal ─────────────────────────────────────────────────────
function openTasks(a) {
  const body = el('div', {}, [loading('Loading tasks…')]);
  modal({ title: `${a.name || a.id} · Scheduled tasks`, body, wide: true });
  api.get(`/api/agents/${encodeURIComponent(a.id)}/tasks`)
    .then(({ tasks }) => {
      if (!tasks || !tasks.length) { mount(body, empty('No tasks for this agent.')); return; }
      mount(body, el('div.table-wrap', {}, [el('table', {}, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: 'Name' }), el('th', { text: 'Cron' }), el('th', { text: 'Status' }),
          el('th', { text: 'Last run' }), el('th', { text: 'Next run' }),
        ])),
        el('tbody', {}, tasks.map((t) => el('tr', {}, [
          el('td', { text: t.name || t.id }),
          el('td', {}, [el('code', { text: t.cron || '—' })]),
          el('td', {}, [badge(t.status || t.last_status || '—', statusKind(t.last_status || t.status))]),
          el('td', { text: t.last_run ? fmtTime(t.last_run) : '—' }),
          el('td', { text: t.next_run ? fmtTime(t.next_run) : '—' }),
        ]))),
      ])]));
    })
    .catch((e) => mount(body, errbox(e.message)));
}

// ── Tokens modal ────────────────────────────────────────────────────
function openTokens(a) {
  const body = el('div', {}, [loading('Loading token stats…')]);
  modal({ title: `${a.name || a.id} · Token usage`, body });
  api.get(`/api/agents/${encodeURIComponent(a.id)}/tokens`)
    .then((s) => {
      mount(body, el('div.grid.grid-stat', {}, [
        stat(s.todayTurns ?? 0, 'Turns today'),
        stat(fmtUsd(s.todayCost ?? 0), 'Cost today'),
        stat((s.totalTurns ?? s.turns ?? 0).toLocaleString(), 'Total turns'),
        stat(fmtUsd(s.totalCost ?? s.totalCostUsd ?? 0), 'Total cost'),
        stat((s.totalInputTokens ?? 0).toLocaleString(), 'Input tokens'),
        stat((s.totalOutputTokens ?? 0).toLocaleString(), 'Output tokens'),
      ]));
    })
    .catch((e) => mount(body, errbox(e.message)));
}

// ── Edit prompt modal ───────────────────────────────────────────────
function openEditPrompt(a, rerun) {
  const body = el('div', {}, [loading('Loading agent definition…')]);
  const m = modal({ title: `Edit · ${a.name || a.id}`, body, wide: true });
  api.get(`/api/agents/${encodeURIComponent(a.id)}/prompt`)
    .then((data) => {
      const ta = el('textarea', { rows: 18, value: data.fullContent || '', style: 'width:100%;font-family:monospace;font-size:12px' });
      const modelWrap = el('div.field', {}, [el('label', { text: 'Model' })]);
      let modelVal = data.model || a.model;
      modelSelect(modelVal, { onchange: (e) => { modelVal = e.target.value; } }).then((sel) => modelWrap.appendChild(sel));

      const laneSel = el('select', {}, LANES.map((l) =>
        el('option', { value: l, text: l, selected: l === (data.lane || a.lane) })));
      const laneWrap = el('div.field', {}, [el('label', { text: 'Lane' }), laneSel]);

      const saveBtn = el('button.btn.btn-accent', {
        text: 'Save',
        onclick: () => {
          if (!ta.value.trim()) { toastErr('Content cannot be empty'); return; }
          action(() => api.put(`/api/agents/${encodeURIComponent(a.id)}/prompt`, {
            content: ta.value, model: modelVal, lane: laneSel.value,
          }), { ok: 'Saved', refresh: rerun }).then(() => m.close());
        },
      });
      mount(body,
        el('div.grid.grid-2', {}, [modelWrap, laneWrap]),
        el('div.field', {}, [el('label', { text: 'Full definition (markdown + frontmatter)' }), ta]),
        el('div.btn-row', { style: 'justify-content:flex-end;margin-top:10px' }, [
          el('button.btn', { text: 'Cancel', onclick: () => m.close() }),
          saveBtn,
        ]),
      );
    })
    .catch((e) => mount(body, errbox(e.message)));
}

// ── Create agent modal ──────────────────────────────────────────────
function openCreate(rerun) {
  const idIn = el('input', { placeholder: 'agent-id (lowercase-dashes)' });
  const nameIn = el('input', { placeholder: 'Display name' });
  const descIn = el('input', { placeholder: 'When to use this agent…' });
  const laneSel = el('select', {}, LANES.map((l) => el('option', { value: l, text: l, selected: l === 'domain' })));
  const promptTa = el('textarea', { rows: 8, placeholder: '# Role\nYou are a …', style: 'width:100%;font-family:monospace;font-size:12px' });
  const modelWrap = el('div.field', {}, [el('label', { text: 'Model' })]);
  let modelVal = null;
  modelSelect(null, { onchange: (e) => { modelVal = e.target.value; } }).then((sel) => { modelVal = sel.value; modelWrap.appendChild(sel); });

  const m = modal({
    title: 'New registry agent',
    wide: true,
    body: [
      el('div.grid.grid-2', {}, [
        el('div.field', {}, [el('label', { text: 'ID' }), idIn]),
        el('div.field', {}, [el('label', { text: 'Name' }), nameIn]),
      ]),
      el('div.field', {}, [el('label', { text: 'Description' }), descIn]),
      el('div.grid.grid-2', {}, [
        el('div.field', {}, [el('label', { text: 'Lane' }), laneSel]),
        modelWrap,
      ]),
      el('div.field', {}, [el('label', { text: 'System prompt' }), promptTa]),
    ],
    footer: [
      el('button.btn', { text: 'Cancel', onclick: () => m.close() }),
      el('button.btn.btn-accent', {
        text: 'Create',
        onclick: () => {
          const id = idIn.value.trim();
          if (!id) { toastErr('ID is required'); return; }
          action(() => api.post('/api/agents/registry', {
            id,
            name: nameIn.value.trim() || id,
            description: descIn.value.trim(),
            model: modelVal,
            lane: laneSel.value,
            systemPrompt: promptTa.value,
          }), { ok: 'Agent created', refresh: rerun }).then(() => m.close());
        },
      }),
    ],
  });
}

function statusKind(s) {
  if (!s) return '';
  s = String(s).toLowerCase();
  if (s.includes('ok') || s.includes('success') || s.includes('complete') || s === 'done') return 'ok';
  if (s.includes('fail') || s.includes('error')) return 'err';
  if (s.includes('disabled') || s.includes('not-installed') || s.includes('pending') || s.includes('queued')) return 'warn';
  return '';
}
