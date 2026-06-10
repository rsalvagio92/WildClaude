// Workflows — declarative YAML DAGs: list, run, inspect runs.
import { api } from '../api.js';
import {
  el, mount, clear, escapeHtml, asyncView, badge, card,
  toast, toastErr, modal, empty, loading, errbox, fmtTime, fmtAgo, truncate,
} from '../ui.js';

const statusKind = (s) => ({
  completed: 'ok', failed: 'err', running: 'warn', skipped: 'warn', pending: '',
}[s] || '');

export default {
  async mount(view) {
    const root = el('div');
    const listCard = el('div');
    const runsCard = el('div');
    mount(root, listCard, el('div', { style: 'height:14px' }), runsCard);

    const head = el('div.page-head', {}, [
      el('div', {}, [
        el('h3', { text: 'Workflows' }),
        el('p.muted', { text: 'Declarative YAML DAGs in your data dir — run multi-step agent pipelines.' }),
      ]),
      el('button.btn.btn-sm', { text: '⟳ Refresh', onclick: () => { reloadList(); reloadRuns(); } }),
    ]);
    mount(view, head, root);

    // ── Available workflows ───────────────────────────────────────────
    const reloadList = asyncView(listCard, () => api.get('/api/workflows'), (data, rerun) => {
      const workflows = data.workflows || [];
      if (!workflows.length) {
        return card('Available workflows', empty('No workflows defined. Add YAML files to USER_DATA_DIR/workflows/.'));
      }
      const rows = workflows.map((w) => {
        const invalid = !!w.error;
        const runBtn = el('button.btn.btn-sm.btn-accent', { text: 'Run', disabled: invalid });
        const spinner = el('span.spinner', { style: 'display:none;margin-left:8px;vertical-align:middle' });
        runBtn.addEventListener('click', async () => {
          runBtn.disabled = true;
          spinner.style.display = 'inline-block';
          try {
            const run = await api.post(`/api/workflows/run/${encodeURIComponent(w.name || w.file)}`);
            toast(`Workflow "${w.name}" ${run.status || 'done'}`, run.status === 'failed' ? 'err' : 'ok');
            reloadRuns();
            showRunDetail(run);
          } catch (e) {
            toastErr(e.message || String(e));
          } finally {
            runBtn.disabled = invalid;
            spinner.style.display = 'none';
          }
        });
        return el('tr', {}, [
          el('td', {}, [
            el('div', { text: w.name || '(unnamed)' }),
            w.description ? el('div.dim', { style: 'font-size:12px', text: truncate(w.description, 80) }) : null,
            invalid ? el('div.dim', { style: 'font-size:12px;color:var(--err,#e66)', text: '⚠ ' + w.error }) : null,
          ]),
          el('td', {}, [badge(invalid ? '—' : `${w.stepCount ?? '?'} steps`)]),
          el('td', { style: 'text-align:right;white-space:nowrap' }, [runBtn, spinner]),
        ]);
      });
      return card('Available workflows', el('div.table-wrap', {}, [el('table', {}, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: 'Workflow' }), el('th', { text: 'Steps' }), el('th', { text: '' }),
        ])),
        el('tbody', {}, rows),
      ])]), el('button.icon-btn', { text: '⟳', onclick: rerun }));
    });

    // ── Recent runs ───────────────────────────────────────────────────
    const reloadRuns = asyncView(runsCard, () => api.get('/api/workflows/runs?limit=20'), (data, rerun) => {
      const runs = data.runs || [];
      if (!runs.length) return card('Recent runs', empty('No runs yet — run a workflow above.'));
      const rows = runs.map((r) => el('tr', {
        style: 'cursor:pointer',
        onclick: () => openRun(r.id),
      }, [
        el('td', {}, [badge(r.status || '—', statusKind(r.status))]),
        el('td', { text: r.workflowId || r.id }),
        el('td', { text: fmtAgo(r.startedAt) }),
        el('td', { text: r.completedAt ? fmtTime(r.completedAt) : '—' }),
      ]));
      return card('Recent runs', el('div.table-wrap', {}, [el('table', {}, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: 'Status' }), el('th', { text: 'Workflow' }),
          el('th', { text: 'Started' }), el('th', { text: 'Finished' }),
        ])),
        el('tbody', {}, rows),
      ])]), el('button.icon-btn', { text: '⟳', onclick: rerun }));
    });

    // ── Run detail ────────────────────────────────────────────────────
    const openRun = async (id) => {
      const { box } = modal({ title: 'Workflow run', body: loading('Loading run…'), wide: true });
      const bodyEl = box.querySelector('.modal-body');
      try {
        const run = await api.get(`/api/workflows/runs/${encodeURIComponent(id)}`);
        mount(bodyEl, renderRunDetail(run));
      } catch (e) {
        mount(bodyEl, errbox(e.message || String(e)));
      }
    };

    const showRunDetail = (run) => {
      const { box } = modal({ title: 'Workflow run', body: renderRunDetail(run), wide: true });
      void box;
    };

    const renderRunDetail = (run) => {
      const nodes = [
        el('div.row', {}, [
          badge(run.status || '—', statusKind(run.status)),
          el('span.dim', { text: 'Started ' + fmtTime(run.startedAt) }),
          run.completedAt ? el('span.dim', { text: '· Finished ' + fmtTime(run.completedAt) }) : null,
        ]),
      ];
      if (run.error) nodes.push(errbox(run.error));

      const steps = Object.entries(run.stepState || {});
      if (!steps.length) {
        nodes.push(empty('No step state recorded.'));
      } else {
        nodes.push(el('div.section-title', { text: 'Steps' }));
        for (const [stepId, st] of steps) {
          const out = st.output != null ? String(st.output) : (st.error != null ? String(st.error) : '');
          nodes.push(el('div', { style: 'margin-bottom:12px' }, [
            el('div.row', {}, [badge(st.status || '—', statusKind(st.status)), el('strong', { text: stepId })]),
            out ? el('pre.block', { html: escapeHtml(out) }) : el('div.dim', { style: 'font-size:12px', text: 'no output' }),
          ]));
        }
      }
      if (run.result != null && run.result !== '') {
        nodes.push(el('div.section-title', { text: 'Final result' }));
        nodes.push(el('pre.block', { html: escapeHtml(String(run.result)) }));
      }
      return nodes;
    };
  },
};
