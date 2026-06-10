// Automation — cron-driven automations + ad-hoc scheduled tasks.
import { api } from '../api.js';
import {
  el, mount, clear, asyncView, badge, card, modal,
  confirmDialog, toast, toastOk, toastErr, action, fmtTime, truncate, empty, loading, errbox,
} from '../ui.js';

const CRON_HINT = '0 9 * * * = daily 9am · */30 * * * * = every 30 min · 0 18 * * 0 = Sun 6pm';

export default {
  async mount(view) {
    const root = el('div');
    mount(view, root);

    const head = el('div.page-head', {}, [
      el('div', {}, [
        el('h3', { text: 'Automation' }),
        el('p.muted', { text: 'Scheduled prompts that run on a cron schedule.' }),
      ]),
      el('div.btn-row', {}, [
        el('button.btn.btn-accent', { text: '+ New automation', onclick: () => openNew(reloadAutomations) }),
      ]),
    ]);
    mount(root, head);

    const autoCard = el('div');
    const tasksCard = el('div');
    mount(root, autoCard, el('div', { style: 'height:14px' }), tasksCard);

    // ── Automations ──
    const reloadAutomations = () => renderAutomations();
    const renderAutomations = () => asyncView(autoCard, () => api.get('/api/automations?agent=main'), (data, rerun) => {
      const list = (data && data.automations) || [];
      if (!list.length) return card('Automations', empty('No automations configured.'));
      const rows = list.map((a) => automationRow(a, rerun));
      return card('Automations', el('div', {}, rows));
    });

    // ── Ad-hoc scheduled tasks ──
    const reloadTasks = () => renderTasks();
    const renderTasks = () => asyncView(tasksCard, () => api.get('/api/tasks'), (data, rerun) => {
      const tasks = (data && data.tasks) || [];
      if (!tasks.length) return card('Ad-hoc scheduled tasks', empty('No ad-hoc tasks scheduled.'));
      return card('Ad-hoc scheduled tasks', el('div.table-wrap', {}, [el('table', {}, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: 'Name' }), el('th', { text: 'Cron' }), el('th', { text: 'Status' }),
          el('th', { text: 'Next run' }), el('th', { text: 'Actions' }),
        ])),
        el('tbody', {}, tasks.map((t) => el('tr', {}, [
          el('td', { text: t.name || t.id }),
          el('td', {}, [el('code', { text: t.cron || '—' })]),
          el('td', {}, [badge(t.status || t.last_status || '—', statusKind(t.status || t.last_status))]),
          el('td', { text: t.next_run ? fmtTime(t.next_run) : '—' }),
          el('td', {}, [el('div.btn-row', {}, [
            el('button.btn.btn-sm', {
              text: 'Pause',
              onclick: () => action(() => api.post(`/api/tasks/${encodeURIComponent(t.id)}/pause`), { ok: 'Paused', refresh: rerun }),
            }),
            el('button.btn.btn-sm', {
              text: 'Resume',
              onclick: () => action(() => api.post(`/api/tasks/${encodeURIComponent(t.id)}/resume`), { ok: 'Resumed', refresh: rerun }),
            }),
            el('button.btn.btn-sm.btn-danger', {
              text: 'Delete',
              onclick: () => confirmDialog(`Delete scheduled task "${t.name || t.id}"?`, () =>
                action(() => api.del(`/api/tasks/${encodeURIComponent(t.id)}`), { ok: 'Deleted', refresh: rerun }),
                { danger: true, confirmText: 'Delete' }),
            }),
          ])]),
        ]))),
      ])]));
    });

    renderAutomations();
    renderTasks();
    return () => {};
  },
};

// ── One automation row ───────────────────────────────────────────────
function automationRow(a, rerun) {
  const toggle = el('input', {
    type: 'checkbox',
    checked: !!a.enabled,
    onchange: (e) => action(() => api.put(`/api/automations/${encodeURIComponent(a.id)}`, { enabled: e.target.checked }), {
      ok: e.target.checked ? 'Enabled' : 'Disabled', refresh: rerun,
    }),
  });

  return el('div.card', { style: 'margin-bottom:10px' }, [
    el('div.row', { style: 'justify-content:space-between;align-items:flex-start;gap:8px' }, [
      el('div', {}, [
        el('strong', { text: a.name || a.id }),
        a.description ? el('div.dim', { style: 'font-size:12px', text: truncate(a.description, 120) }) : null,
        el('div', { style: 'margin-top:4px' }, [el('code', { text: a.cron || '—' })]),
      ]),
      el('div.row', { style: 'gap:6px;flex-wrap:wrap;justify-content:flex-end;align-items:center' }, [
        a.source ? badge(a.source) : null,
        a.last_status ? badge('last: ' + a.last_status, statusKind(a.last_status)) : null,
        el('label.row', { style: 'gap:4px;align-items:center' }, [toggle, el('span.dim', { text: 'enabled' })]),
      ]),
    ]),
    el('div.row', { style: 'justify-content:space-between;align-items:center;margin-top:8px' }, [
      el('span.dim', { style: 'font-size:12px', text: 'Next: ' + (a.next_run ? fmtTime(a.next_run) : '—') }),
      el('div.row', { style: 'gap:6px' }, [
        el('button.btn.btn-sm', { text: 'Edit', onclick: () => openEdit(a, rerun) }),
        // Built-in automations can only be disabled, not deleted.
        a.source === 'user' ? el('button.btn.btn-sm.btn-danger', {
          text: 'Delete',
          onclick: () => confirmDialog(`Delete automation "${a.name || a.id}"?`, () =>
            action(() => api.del(`/api/automations/${encodeURIComponent(a.id)}`), { ok: 'Deleted', refresh: rerun }),
            { danger: true, confirmText: 'Delete' }),
        }) : null,
      ]),
    ]),
  ]);
}

// ── Edit automation modal ────────────────────────────────────────────
function openEdit(a, rerun) {
  const nameIn = el('input', { value: a.name || a.id });
  const cronIn = el('input', { value: a.cron || '' });
  const promptTa = el('textarea', { rows: 6, value: a.prompt || '', style: 'width:100%' });

  const m = modal({
    title: `Edit · ${a.name || a.id}`,
    wide: true,
    body: [
      el('div.field', {}, [el('label', { text: 'Name' }), nameIn]),
      el('div.field', {}, [el('label', { text: 'Cron' }), cronIn, el('div.dim', { style: 'font-size:11px;margin-top:4px', text: CRON_HINT })]),
      el('div.field', {}, [el('label', { text: 'Prompt' }), promptTa]),
    ],
    footer: [
      el('button.btn', { text: 'Cancel', onclick: () => m.close() }),
      el('button.btn.btn-accent', {
        text: 'Save',
        onclick: () => {
          const name = nameIn.value.trim();
          const cron = cronIn.value.trim();
          const prompt = promptTa.value.trim();
          if (!name) { toastErr('Name is required'); return; }
          if (!cron) { toastErr('Cron is required'); return; }
          action(() => api.put(`/api/automations/${encodeURIComponent(a.id)}`, { name, cron, prompt }), {
            ok: 'Saved', refresh: rerun,
          }).then(() => m.close());
        },
      }),
    ],
  });
}

// ── New automation modal ─────────────────────────────────────────────
function openNew(rerun) {
  const nameIn = el('input', { placeholder: 'Morning briefing' });
  const cronIn = el('input', { placeholder: '0 9 * * *' });
  const promptTa = el('textarea', { rows: 6, placeholder: 'What should run on this schedule?', style: 'width:100%' });

  const m = modal({
    title: 'New automation',
    wide: true,
    body: [
      el('div.field', {}, [el('label', { text: 'Name' }), nameIn]),
      el('div.field', {}, [el('label', { text: 'Cron' }), cronIn, el('div.dim', { style: 'font-size:11px;margin-top:4px', text: CRON_HINT })]),
      el('div.field', {}, [el('label', { text: 'Prompt' }), promptTa]),
    ],
    footer: [
      el('button.btn', { text: 'Cancel', onclick: () => m.close() }),
      el('button.btn.btn-accent', {
        text: 'Create',
        onclick: () => {
          const name = nameIn.value.trim();
          const cron = cronIn.value.trim();
          const prompt = promptTa.value.trim();
          if (!name) { toastErr('Name is required'); return; }
          if (!prompt) { toastErr('Prompt is required'); return; }
          if (!cron) { toastErr('Cron is required'); return; }
          action(() => api.post('/api/automations', { name, prompt, cron }), { ok: 'Automation created', refresh: rerun }).then(() => m.close());
        },
      }),
    ],
  });
}

function statusKind(s) {
  if (!s) return '';
  s = String(s).toLowerCase();
  if (s.includes('ok') || s.includes('success') || s.includes('complete') || s === 'done' || s === 'active') return 'ok';
  if (s.includes('fail') || s.includes('error')) return 'err';
  if (s.includes('disabled') || s.includes('not-installed') || s.includes('paused') || s.includes('pending')) return 'warn';
  return '';
}
