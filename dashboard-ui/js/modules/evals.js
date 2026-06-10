// Evals — declarative agent test cases: list, run, inspect pass/fail per case.
import { api } from '../api.js';
import {
  el, mount, escapeHtml, asyncView, badge, card,
  toast, toastErr, modal, confirmDialog, action, empty, truncate, fmtTime, fmtAgo,
} from '../ui.js';
import { openYamlEditor, openYamlGenerate } from '../yaml-authoring.js';

const pctKind = (passed, total) => {
  if (!total) return '';
  const r = passed / total;
  return r === 1 ? 'ok' : r === 0 ? 'err' : 'warn';
};

const EVAL_TEMPLATE = `name: my-eval
description: What this eval checks
cases:
  - prompt: Ask the agent something representative.
    expect:
      contains: ["expected substring"]
      max_length: 2000
`;

export default {
  async mount(view) {
    const root = el('div');
    const listCard = el('div');
    const runsCard = el('div');
    mount(root, listCard, el('div', { style: 'height:14px' }), runsCard);

    const head = el('div.page-head', {}, [
      el('div', {}, [
        el('h3', { text: 'Evals' }),
        el('p.muted', { text: 'Declarative agent test cases — contains / tools / length assertions.' }),
      ]),
      el('div.btn-row', {}, [
        el('button.btn.btn-accent', { text: '✨ Describe an eval', onclick: () => openYamlGenerate({ kind: 'evals', label: 'an eval', placeholder: 'e.g. "Check the coach agent stays encouraging, gives 3 steps, and never gives medical advice"', reload: () => reloadList() }) }),
        el('button.btn', { text: '+ New', onclick: () => openYamlEditor({ kind: 'evals', content: EVAL_TEMPLATE, reload: () => reloadList() }) }),
        el('button.btn.btn-sm', { text: '⟳', onclick: () => { reloadList(); reloadRuns(); } }),
      ]),
    ]);
    mount(view, head, root);

    // ── Available evals ───────────────────────────────────────────────
    const reloadList = asyncView(listCard, () => api.get('/api/evals'), (data, rerun) => {
      const evals = data.evals || [];
      if (!evals.length) {
        return card('Available evals', empty('No evals defined. Add YAML files to USER_DATA_DIR/evals/.'));
      }
      const rows = evals.map((ev) => {
        const invalid = !!ev.error;
        const runBtn = el('button.btn.btn-sm.btn-accent', { text: 'Run', disabled: invalid });
        const spinner = el('span.spinner', { style: 'display:none;margin-left:8px;vertical-align:middle' });
        runBtn.addEventListener('click', async () => {
          runBtn.disabled = true;
          spinner.style.display = 'inline-block';
          try {
            const run = await api.post(`/api/evals/run/${encodeURIComponent(ev.name || ev.file)}`);
            const p = run.passed ?? 0, t = run.total ?? 0;
            toast(`"${ev.name}" — ${p}/${t} passed`, pctKind(p, t) === 'ok' ? 'ok' : pctKind(p, t) === 'err' ? 'err' : 'warn');
            reloadRuns();
            showRunDetail(ev.name, run);
          } catch (e) {
            toastErr(e.message || String(e));
          } finally {
            runBtn.disabled = invalid;
            spinner.style.display = 'none';
          }
        });
        const key = ev.name || ev.file;
        const editBtn = el('button.btn.btn-sm', { text: 'Edit', onclick: async () => {
          try { const { content } = await api.get('/api/evals/raw/' + encodeURIComponent(key)); openYamlEditor({ kind: 'evals', name: key, content, reload: () => reloadList() }); }
          catch (e) { toastErr(e.message); }
        } });
        const delBtn = el('button.btn.btn-sm.btn-danger', { text: '✕', title: 'Delete', onclick: () =>
          confirmDialog(`Delete eval "${key}"?`, () => action(() => api.del('/api/evals/' + encodeURIComponent(key)), { ok: 'Deleted', refresh: () => reloadList() }), { danger: true, confirmText: 'Delete' }) });
        return el('tr', {}, [
          el('td', {}, [
            el('div', { text: ev.name || '(unnamed)' }),
            ev.description ? el('div.dim', { style: 'font-size:12px', text: truncate(ev.description, 80) }) : null,
            invalid ? el('div.dim', { style: 'font-size:12px;color:var(--err,#e66)', text: '⚠ ' + ev.error }) : null,
          ]),
          el('td', {}, [badge(invalid ? '—' : `${ev.caseCount ?? '?'} cases`)]),
          el('td', { style: 'text-align:right;white-space:nowrap' }, [runBtn, spinner, el('span', { style: 'display:inline-block;width:6px' }), editBtn, delBtn]),
        ]);
      });
      return card('Available evals', el('div.table-wrap', {}, [el('table', {}, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: 'Eval' }), el('th', { text: 'Cases' }), el('th', { text: '' }),
        ])),
        el('tbody', {}, rows),
      ])]), el('button.icon-btn', { text: '⟳', onclick: rerun }));
    });

    // ── Recent runs ───────────────────────────────────────────────────
    const reloadRuns = asyncView(runsCard, () => api.get('/api/evals/runs?limit=20'), (data, rerun) => {
      const runs = data.runs || [];
      if (!runs.length) return card('Recent runs', empty('No runs yet — run an eval above.'));
      const rows = runs.map((r) => {
        const p = r.passed ?? 0, t = r.total ?? 0;
        return el('tr', {
          style: 'cursor:pointer',
          onclick: () => showRunDetail(r.evalId || r.id, r),
        }, [
          el('td', {}, [badge(`${p}/${t} passed`, pctKind(p, t))]),
          el('td', { text: r.evalId || r.id }),
          el('td', { text: fmtAgo(r.startedAt) }),
          el('td', { text: r.completedAt ? fmtTime(r.completedAt) : '—' }),
        ]);
      });
      return card('Recent runs', el('div.table-wrap', {}, [el('table', {}, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: 'Result' }), el('th', { text: 'Eval' }),
          el('th', { text: 'Started' }), el('th', { text: 'Finished' }),
        ])),
        el('tbody', {}, rows),
      ])]), el('button.icon-btn', { text: '⟳', onclick: rerun }));
    });

    // ── Run detail ────────────────────────────────────────────────────
    const showRunDetail = (name, run) => {
      const p = run.passed ?? 0, t = run.total ?? 0;
      const nodes = [
        el('div.row', {}, [
          badge(`${p}/${t} passed`, pctKind(p, t)),
          run.score != null ? el('span.dim', { text: `score ${(run.score * 100).toFixed(0)}%` }) : null,
          el('span.dim', { text: fmtTime(run.startedAt) }),
        ]),
      ];
      const details = run.details || [];
      if (!details.length) {
        nodes.push(empty('No case details recorded.'));
      } else {
        nodes.push(el('div.section-title', { text: 'Cases' }));
        for (const d of details) {
          const reasons = (d.reasons || []).filter(Boolean);
          nodes.push(el('div', { style: 'margin-bottom:14px' }, [
            el('div.row', {}, [
              badge(d.passed ? 'pass' : 'fail', d.passed ? 'ok' : 'err'),
              el('strong', { text: truncate(d.prompt || '(no prompt)', 100) }),
            ]),
            reasons.length
              ? el('div', { style: 'margin:4px 0' }, reasons.map((rsn) =>
                  el('div.dim', { style: 'font-size:12px;color:var(--err,#e66)', text: '✗ ' + rsn })))
              : null,
            (Array.isArray(d.toolsObserved) && d.toolsObserved.length)
              ? el('div.dim', { style: 'font-size:12px', text: 'tools: ' + d.toolsObserved.join(', ') })
              : null,
            d.response != null
              ? el('pre.block', { html: escapeHtml(truncate(String(d.response), 1200)) })
              : el('div.dim', { style: 'font-size:12px', text: 'no response' }),
          ]));
        }
      }
      modal({ title: 'Eval run — ' + (name || ''), body: nodes, wide: true });
    };
  },
};
