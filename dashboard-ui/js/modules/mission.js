// Mission Control — task queue: create, assign, cancel, reassign, delete; plus history.
import { api } from '../api.js';
import {
  el, mount, clear, escapeHtml, asyncView, badge, card, modal,
  confirmDialog, toast, toastOk, toastErr, action, fmtTime, fmtAgo, truncate, empty, loading, errbox,
} from '../ui.js';

const STATUSES = ['all', 'queued', 'running', 'completed', 'failed'];

export default {
  async mount(view) {
    const root = el('div');
    mount(view, root);

    // Load agent list once for the assignment dropdowns.
    let agentIds = [];
    try {
      const { agents } = await api.get('/api/agents');
      agentIds = (agents || []).map((a) => a.id);
    } catch { /* dropdowns will degrade to text */ }

    let statusFilter = 'all';

    const tasksCard = el('div');
    const historyCard = el('div');
    mount(root, tasksCard, el('div', { style: 'height:14px' }), historyCard);

    const reloadTasks = () => renderTasks();
    const renderTasks = () => asyncView(tasksCard, () => {
      const qs = statusFilter && statusFilter !== 'all' ? `?status=${encodeURIComponent(statusFilter)}` : '';
      return api.get('/api/mission/tasks' + qs);
    }, (data, rerun) => {
      const tasks = (data && data.tasks) || [];

      const statusSel = el('select', {
        onchange: (e) => { statusFilter = e.target.value; rerun(); },
      }, STATUSES.map((s) => el('option', { value: s, text: s, selected: s === statusFilter })));

      const head = el('div.page-head', {}, [
        el('div', {}, [
          el('h3', { text: 'Mission Control' }),
          el('p.muted', { text: `${tasks.length} task(s)${statusFilter !== 'all' ? ' · ' + statusFilter : ''}` }),
        ]),
        el('div.btn-row', {}, [
          el('div.row', { style: 'gap:6px;align-items:center' }, [el('span.dim', { text: 'Status:' }), statusSel]),
          el('button.btn.btn-sm', {
            text: 'Auto-assign all',
            onclick: () => action(() => api.post('/api/mission/tasks/auto-assign-all'), { refresh: rerun })
              .then((r) => toastOk(`Assigned ${(r && r.assigned) || 0} task(s)`)),
          }),
          el('button.btn.btn-accent', { text: '+ New mission', onclick: () => openNew(agentIds, rerun) }),
        ]),
      ]);

      const body = tasks.length
        ? el('div', {}, tasks.map((t) => taskRow(t, agentIds, rerun)))
        : empty('No tasks. Create one with “New mission”.');

      return el('div', {}, [head, body]);
    });

    // ── History section ──
    const renderHistory = () => asyncView(historyCard, () => api.get('/api/mission/history?limit=30'), (data) => {
      const tasks = (data && (data.tasks || data.history)) || (Array.isArray(data) ? data : []);
      if (!tasks.length) return card('History', empty('No completed missions yet.'));
      return card('History', el('div.table-wrap', {}, [el('table', {}, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: 'Title' }), el('th', { text: 'Agent' }), el('th', { text: 'Status' }), el('th', { text: 'When' }),
        ])),
        el('tbody', {}, tasks.map((t) => el('tr', {}, [
          el('td', { text: truncate(t.title || t.id, 60) }),
          el('td', { text: t.assigned_agent || 'auto' }),
          el('td', {}, [badge(t.status || '—', statusKind(t.status))]),
          el('td', { text: t.completed_at ? fmtAgo(t.completed_at) : (t.created_at ? fmtAgo(t.created_at) : '—') }),
        ]))),
      ])]));
    });

    renderTasks();
    renderHistory();
    return () => {};
  },
};

// ── One task row ─────────────────────────────────────────────────────
function taskRow(t, agentIds, rerun) {
  const open = () => openDetail(t);

  const reassignSel = el('select', {
    onchange: (e) => {
      const v = e.target.value;
      if (!v) return;
      action(() => api.patch(`/api/mission/tasks/${encodeURIComponent(t.id)}`, { assigned_agent: v }), {
        ok: `Reassigned → ${v}`, refresh: rerun,
      });
    },
  }, [
    el('option', { value: '', text: 'Reassign…' }),
    ...agentIds.map((id) => el('option', { value: id, text: id, selected: id === t.assigned_agent })),
  ]);

  const titleLine = el('div.row', { style: 'justify-content:space-between;align-items:flex-start;gap:8px' }, [
    el('div', { style: 'cursor:pointer', onclick: open }, [
      el('strong', { text: t.title || t.id }),
      el('div.dim', { style: 'font-size:12px', text: truncate(t.prompt || '', 100) }),
    ]),
    el('div.row', { style: 'gap:4px;flex-wrap:wrap;justify-content:flex-end' }, [
      badge(t.status || '—', statusKind(t.status)),
      badge('p' + (t.priority ?? 0)),
      badge(t.assigned_agent || 'unassigned', t.assigned_agent ? 'accent' : 'warn'),
    ]),
  ]);

  const actions = el('div.btn-row', { style: 'margin-top:8px' }, [
    el('button.btn.btn-sm', {
      text: 'Cancel',
      onclick: () => action(() => api.post(`/api/mission/tasks/${encodeURIComponent(t.id)}/cancel`), { ok: 'Cancelled', refresh: rerun }),
    }),
    !t.assigned_agent ? el('button.btn.btn-sm', {
      text: 'Auto-assign',
      onclick: () => action(() => api.post(`/api/mission/tasks/${encodeURIComponent(t.id)}/auto-assign`), { refresh: rerun })
        .then((r) => toastOk(`Assigned → ${(r && r.assigned_agent) || '?'}`)),
    }) : null,
    reassignSel,
    el('button.btn.btn-sm.btn-danger', {
      text: 'Delete',
      onclick: () => confirmDialog(`Delete mission "${t.title || t.id}"?`, () =>
        action(() => api.del(`/api/mission/tasks/${encodeURIComponent(t.id)}`), { ok: 'Deleted', refresh: rerun }),
        { danger: true, confirmText: 'Delete' }),
    }),
  ]);

  return el('div.card', { style: 'margin-bottom:10px' }, [titleLine, actions]);
}

// ── Task detail modal ────────────────────────────────────────────────
function openDetail(t) {
  const body = [
    el('div.kv', {}, [
      el('dt', { text: 'Status' }), el('dd', {}, [badge(t.status || '—', statusKind(t.status))]),
      el('dt', { text: 'Agent' }), el('dd', { text: t.assigned_agent || 'unassigned' }),
      el('dt', { text: 'Priority' }), el('dd', { text: String(t.priority ?? 0) }),
      el('dt', { text: 'Created' }), el('dd', { text: t.created_at ? fmtTime(t.created_at) : '—' }),
    ]),
    el('div.section-title', { text: 'Prompt' }),
    el('pre.pre.block', { text: t.prompt || '—' }),
  ];
  if (t.result) {
    body.push(el('div.section-title', { text: 'Result' }));
    body.push(el('pre.pre.block', { text: String(t.result) }));
  }
  if (t.error) {
    body.push(el('div.section-title', { text: 'Error' }));
    body.push(el('div.errbox', { text: String(t.error) }));
  }
  modal({ title: t.title || t.id, body, wide: true });
}

// ── New mission modal ────────────────────────────────────────────────
function openNew(agentIds, rerun) {
  const titleIn = el('input', { placeholder: 'Mission title' });
  const promptTa = el('textarea', { rows: 6, placeholder: 'What should the agent do?', style: 'width:100%' });
  const agentSel = el('select', {}, [
    el('option', { value: '', text: 'auto / unassigned' }),
    ...agentIds.map((id) => el('option', { value: id, text: id })),
  ]);
  const prioRange = el('input', { type: 'range', min: 0, max: 10, value: 0, style: 'width:100%' });
  const prioLabel = el('span.dim', { text: 'Priority: 0' });
  prioRange.addEventListener('input', () => { prioLabel.textContent = 'Priority: ' + prioRange.value; });

  const m = modal({
    title: 'New mission',
    wide: true,
    body: [
      el('div.field', {}, [el('label', { text: 'Title' }), titleIn]),
      el('div.field', {}, [el('label', { text: 'Prompt' }), promptTa]),
      el('div.grid.grid-2', {}, [
        el('div.field', {}, [el('label', { text: 'Assign to' }), agentSel]),
        el('div.field', {}, [el('label', {}, [prioLabel]), prioRange]),
      ]),
    ],
    footer: [
      el('button.btn', { text: 'Cancel', onclick: () => m.close() }),
      el('button.btn.btn-accent', {
        text: 'Create',
        onclick: () => {
          const title = titleIn.value.trim();
          const prompt = promptTa.value.trim();
          if (!title) { toastErr('Title is required'); return; }
          if (!prompt) { toastErr('Prompt is required'); return; }
          const payload = { title, prompt, priority: Number(prioRange.value) };
          if (agentSel.value) payload.assigned_agent = agentSel.value;
          action(() => api.post('/api/mission/tasks', payload), { ok: 'Mission created', refresh: rerun }).then(() => m.close());
        },
      }),
    ],
  });
}

function statusKind(s) {
  if (!s) return '';
  s = String(s).toLowerCase();
  if (s.includes('complete') || s === 'done' || s.includes('success')) return 'ok';
  if (s.includes('fail') || s.includes('error') || s.includes('cancel')) return 'err';
  if (s.includes('run')) return 'accent';
  if (s.includes('queue') || s.includes('pending')) return 'warn';
  return '';
}
