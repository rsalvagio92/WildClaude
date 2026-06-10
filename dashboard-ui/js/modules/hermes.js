// Hermes Lab — budget, semantic memory search, fine-tune pipeline, agent self-improvement.
import { api } from '../api.js';
import {
  el, mount, clear, card, badge, stat, asyncView, action, confirmDialog,
  empty, loading, errbox, truncate, fmtUsd, escapeHtml, toast, toastErr,
} from '../ui.js';

export default {
  async mount(view) {
    const head = el('div.page-head', {}, [
      el('div', {}, [
        el('h3', { text: 'Hermes Lab' }),
        el('p.muted', { text: 'Budget, knowledge search, fine-tuning, and agent self-improvement.' }),
      ]),
    ]);

    const budgetCard = el('div');
    const memCard = el('div');
    const ftCard = el('div');
    const aiCard = el('div');
    mount(view, head,
      budgetCard, el('div', { style: 'height:14px' }),
      memCard, el('div', { style: 'height:14px' }),
      ftCard, el('div', { style: 'height:14px' }),
      aiCard);

    // ── Budget ──────────────────────────────────────────────────────
    const renderBudget = () => {
      asyncView(budgetCard, () => api.get('/api/budget'), (b, rerun) => {
        const refresh = el('button.icon-btn', { text: '⟳', onclick: rerun });
        const ratio = Number(b.ratio) || 0;
        const pct = Math.round(ratio * 100);
        const barKind = ratio >= 1 ? 'var(--danger, #e5484d)' : ratio >= 0.8 ? 'var(--warn, #f5a623)' : 'var(--accent)';
        const stats = [
          stat(fmtUsd(b.spentUsd ?? 0), 'Spent (API)'),
          b.equivalentUsd != null ? stat(fmtUsd(b.equivalentUsd), 'Equivalent') : null,
          stat(b.enabled ? fmtUsd(b.budgetUsd ?? 0) : 'off', 'Monthly budget'),
          stat(pct + '%', 'Used'),
          stat((b.turns ?? 0).toLocaleString(), 'Turns'),
        ].filter(Boolean);
        const gauge = b.enabled
          ? el('div.bar', { style: 'margin-top:12px' }, [
              el('span', { style: `width:${Math.min(100, pct)}%;background:${barKind}` }),
            ])
          : el('p.muted', { style: 'margin-top:10px', text: 'No monthly budget set (MONTHLY_BUDGET_USD).' });
        return card(`Budget — ${b.monthKey || ''}`, [el('div.grid.grid-stat', {}, stats), gauge], refresh);
      });
    };
    renderBudget();

    // ── Semantic memory search ──────────────────────────────────────
    const searchInput = el('input', { placeholder: 'Search what I know…', style: 'flex:1' });
    const resultsHost = el('div', {}, [empty('Enter a query to search memory blocks.')]);
    const doSearch = async () => {
      const q = searchInput.value.trim();
      if (!q) { mount(resultsHost, empty('Enter a query to search memory blocks.')); return; }
      mount(resultsHost, loading('Searching…'));
      try {
        const r = await api.get(`/api/memory-search?q=${encodeURIComponent(q)}`);
        const byScope = r.byScope || {};
        const sections = [];
        const head = el('div.row', { style: 'gap:8px;align-items:center' }, [
          el('span.muted', { text: `${r.total ?? 0} block(s)` }),
          badge(r.semantic ? 'semantic' : 'keyword', r.semantic ? 'accent' : ''),
        ]);
        sections.push(head);
        for (const scope of ['user', 'session', 'agent']) {
          const blocks = Array.isArray(byScope[scope]) ? byScope[scope] : [];
          if (!blocks.length) continue;
          sections.push(el('div.section-title', { text: scope }));
          sections.push(el('div', {}, blocks.map((bl) => el('div.card', { style: 'margin:6px 0;padding:10px' }, [
            el('div.row', { style: 'justify-content:space-between' }, [
              el('strong', { text: bl.topic || '(untitled)' }),
              el('span.muted', { style: 'font-size:11px', text: bl.owner || '' }),
            ]),
            el('div', { style: 'margin-top:4px;font-size:13px', text: truncate(bl.body || '', 240) }),
          ]))));
        }
        if (sections.length === 1) sections.push(empty('No matches.'));
        mount(resultsHost, sections);
      } catch (e) { mount(resultsHost, errbox(e.message || String(e))); }
    };
    searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
    mount(memCard, card('Knowledge Search', [
      el('div.row', { style: 'gap:8px' }, [
        searchInput,
        el('button.btn.btn-accent', { text: 'Search', onclick: doSearch }),
      ]),
      resultsHost,
    ]));

    // ── Fine-tune ───────────────────────────────────────────────────
    const renderFt = () => {
      asyncView(ftCard, () => api.get('/api/finetune/estimate?days=30'), (est, rerun) => {
        const refresh = el('button.icon-btn', { text: '⟳', onclick: rerun });
        const pairs = est.pairCount ?? est.pairs ?? 0;
        const stats = el('div.grid.grid-stat', {}, [
          stat(pairs.toLocaleString(), 'Training pairs'),
          stat((est.trainTokens ?? 0).toLocaleString(), 'Train tokens'),
          stat(fmtUsd(est.estTrainCostUsd ?? 0), 'Est. train cost'),
          stat(`${est.days ?? 30}d`, 'Window'),
        ]);
        const buildBtn = el('button.btn', {
          text: 'Build dataset',
          onclick: () => action(() => api.post('/api/finetune/build', { days: 30 }), {})
            .then((r) => toast(`Wrote ${r.pairs} pairs → ${r.outputPath}`, 'ok'))
            .catch(() => {}),
        });
        return card('Fine-tune', [stats, el('div.btn-row', { style: 'margin-top:10px' }, [buildBtn])], refresh);
      });
    };
    renderFt();

    // ── Agent self-improvement ──────────────────────────────────────
    const renderAi = () => {
      asyncView(aiCard, () => api.get('/api/agent-improve'), (d, rerun) => {
        const struggling = Array.isArray(d.struggling) ? d.struggling : [];
        const proposals = Array.isArray(d.pendingProposals) ? d.pendingProposals : [];

        const runBtn = el('button.btn.btn-accent', {
          text: 'Run cycle',
          onclick: () => action(() => api.post('/api/agent-improve/run'), {})
            .then((r) => { toast(`${(r.proposals || []).length} proposal(s) generated`, 'ok'); rerun(); })
            .catch(() => {}),
        });
        const head = el('div.row', { style: 'gap:8px;align-items:center' }, [
          runBtn, el('button.icon-btn', { text: '⟳', onclick: rerun }),
        ]);

        const body = [];

        body.push(el('div.section-title', { text: 'Struggling agents' }));
        body.push(struggling.length
          ? el('div.table-wrap', {}, [el('table', {}, [
              el('thead', {}, el('tr', {}, [
                el('th', { text: 'Agent' }), el('th', { text: 'Failure rate' }), el('th', { text: 'Tasks' }),
              ])),
              el('tbody', {}, struggling.map((s) => el('tr', {}, [
                el('td', {}, [badge(s.agentId || '—')]),
                el('td', {}, [badge(`${Math.round((s.failureRate || 0) * 100)}%`, 'err')]),
                el('td', { text: `${s.failedTasks ?? 0}/${s.totalTasks ?? 0}` }),
              ]))),
            ])])
          : empty('No struggling agents (≥30% failure over 7d).'));

        body.push(el('div.section-title', { text: 'Pending proposals' }));
        if (!proposals.length) {
          body.push(empty('No pending proposals.'));
        } else {
          body.push(el('div', {}, proposals.map((p) => {
            const fname = (p.proposalPath || '').split(/[\\/]/).pop() || p.proposalPath;
            return el('div.card', { style: 'margin:6px 0;padding:10px' }, [
              el('div.row', { style: 'justify-content:space-between;align-items:center' }, [
                el('div', {}, [
                  el('strong', { text: p.agentId || '—' }),
                  p.failureRate ? badge(`${Math.round(p.failureRate * 100)}%`, 'warn') : null,
                  el('div.muted', { style: 'font-size:11px', text: fname }),
                ]),
                el('div.btn-row', {}, [
                  el('button.btn.btn-sm.btn-accent', {
                    text: 'Accept',
                    onclick: () => confirmDialog(`Apply proposal for ${p.agentId}?`, () =>
                      action(() => api.post('/api/agent-improve/accept', { proposalPath: p.proposalPath, agentId: p.agentId }),
                        { ok: 'Proposal accepted', refresh: rerun }), { danger: false, confirmText: 'Accept' }),
                  }),
                  el('button.btn.btn-sm.btn-danger', {
                    text: 'Discard',
                    onclick: () => confirmDialog(`Discard proposal for ${p.agentId}?`, () =>
                      action(() => api.post('/api/agent-improve/discard', { proposalPath: p.proposalPath }),
                        { ok: 'Proposal discarded', refresh: rerun }), { confirmText: 'Discard' }),
                  }),
                ]),
              ]),
            ]);
          })));
        }

        return card('Agent Self-Improvement', body, head);
      });
    };
    renderAi();
  },
};
