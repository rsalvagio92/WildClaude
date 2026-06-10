// Trace Inspector — cost breakdown + recent sessions + per-session timelines.
import { api } from '../api.js';
import {
  el, mount, clear, asyncView, stat, card, badge, modal,
  fmtUsd, fmtTime, fmtAgo, truncate, escapeHtml, loading, errbox, empty,
} from '../ui.js';

export default {
  async mount(view) {
    const head = el('div.page-head', {}, [
      el('div', {}, [
        el('h3', { text: 'Trace Inspector' }),
        el('p.muted', { text: 'Cost breakdown and per-session turn timelines.' }),
      ]),
    ]);

    const costCard = el('div');
    const sessionsCard = el('div');
    mount(view, head, costCard, el('div', { style: 'height:14px' }), sessionsCard);

    // ── Cost breakdown (7 / 30 day toggle) ──────────────────────────
    let days = 30;
    const renderCost = () => {
      asyncView(costCard, () => api.get(`/api/cost-breakdown?days=${days}`), (d) => {
        const byAgent = Array.isArray(d.byAgent) ? d.byAgent : [];
        const byDay = Array.isArray(d.byDay) ? d.byDay : [];
        const maxAgentCost = byAgent.reduce((m, a) => Math.max(m, a.costUsd || 0), 0) || 1;
        const maxDayCost = byDay.reduce((m, x) => Math.max(m, x.costUsd || 0), 0) || 1;

        const toggle = el('div.tabs', {}, [7, 30].map((n) =>
          el('div.tab' + (n === days ? ' active' : ''), {
            text: n + 'd',
            onclick: () => { if (n !== days) { days = n; renderCost(); } },
          })));

        const stats = el('div.grid.grid-stat', {}, [
          stat(fmtUsd(d.totalCostUsd ?? 0), `Total cost (${days}d)`),
          stat((d.totalTurns ?? 0).toLocaleString(), 'Total turns'),
          stat(byAgent.length, 'Agents'),
        ]);

        const agentBar = (a) => el('div', { style: 'margin:6px 0' }, [
          el('div.row', { style: 'justify-content:space-between;font-size:12px' }, [
            el('span', {}, [badge((a.agentId || 'main'))]),
            el('span.muted', { text: `${a.turns} turns · ${fmtUsd(a.costUsd)}` }),
          ]),
          el('div.bar', { style: 'margin-top:4px' }, [
            el('span', { style: `width:${Math.round(((a.costUsd || 0) / maxAgentCost) * 100)}%` }),
          ]),
        ]);

        const agentSection = byAgent.length
          ? el('div', {}, [el('div.section-title', { text: 'By agent' }), ...byAgent.map(agentBar)])
          : empty('No agent cost in this window.');

        const daySection = byDay.length
          ? el('div', {}, [
              el('div.section-title', { text: 'By day' }),
              el('div.table-wrap', {}, [el('table', {}, [
                el('thead', {}, el('tr', {}, [
                  el('th', { text: 'Day' }), el('th', { text: 'Turns' }),
                  el('th', { text: 'Cost' }), el('th', { text: '' }),
                ])),
                el('tbody', {}, byDay.map((x) => el('tr', {}, [
                  el('td', { text: x.day }),
                  el('td', { text: (x.turns ?? 0).toLocaleString() }),
                  el('td', { text: fmtUsd(x.costUsd) }),
                  el('td', { style: 'width:40%' }, [el('div.bar', {}, [
                    el('span', { style: `width:${Math.round(((x.costUsd || 0) / maxDayCost) * 100)}%` }),
                  ])]),
                ]))),
              ])]),
            ])
          : null;

        return card('Cost Breakdown', [stats, agentSection, daySection], toggle);
      });
    };
    renderCost();

    // ── Recent sessions ─────────────────────────────────────────────
    const renderSessions = () => {
      asyncView(sessionsCard, () => api.get('/api/traces?limit=25'), (d, rerun) => {
        const sessions = Array.isArray(d.sessions) ? d.sessions : [];
        const refresh = el('button.icon-btn', { text: '⟳', onclick: rerun });
        if (!sessions.length) return card('Recent Sessions', empty('No traced sessions yet.'), refresh);

        const rows = sessions.map((s) => {
          const id = s.sessionId || s.id || '';
          const t = s.totals || {};
          return el('tr', { style: 'cursor:pointer', onclick: () => openTrace(id) }, [
            el('td', {}, [el('code', { text: truncate(id, 14) })]),
            el('td', {}, [badge(s.agentId || 'main')]),
            el('td', { text: (t.turnCount ?? s.turns ?? 0) }),
            el('td', { text: ((t.inputTokens ?? 0) + (t.outputTokens ?? 0)).toLocaleString() }),
            el('td', { text: fmtUsd(t.costUsd ?? 0) }),
            el('td', { text: fmtAgo(s.lastActivity ?? s.startedAt) }),
          ]);
        });

        return card('Recent Sessions', el('div.table-wrap', {}, [el('table', {}, [
          el('thead', {}, el('tr', {}, [
            el('th', { text: 'Session' }), el('th', { text: 'Agent' }),
            el('th', { text: 'Turns' }), el('th', { text: 'Tokens' }),
            el('th', { text: 'Cost' }), el('th', { text: 'Last' }),
          ])),
          el('tbody', {}, rows),
        ])]), refresh);
      });
    };
    renderSessions();

    // ── Session detail timeline (modal) ─────────────────────────────
    function openTrace(sessionId) {
      const bodyHost = el('div', {}, [loading('Loading trace…')]);
      const m = modal({ title: 'Session trace', body: bodyHost, wide: true });
      api.get(`/api/traces/${encodeURIComponent(sessionId)}`).then((tr) => {
        const turns = Array.isArray(tr.turns) ? tr.turns : [];
        const t = tr.totals || {};
        const headline = el('div.grid.grid-stat', {}, [
          stat(t.turnCount ?? turns.length, 'Turns'),
          stat((t.inputTokens ?? 0).toLocaleString(), 'Input'),
          stat((t.outputTokens ?? 0).toLocaleString(), 'Output'),
          stat(fmtUsd(t.costUsd ?? 0), 'Cost'),
        ]);
        const meta = el('p.muted', {
          text: `${tr.agentId || 'main'} · ${fmtTime(tr.startedAt)} → ${fmtTime(tr.lastActivity)}`,
        });

        const timeline = turns.length
          ? el('div', {}, turns.map((turn) => {
              const u = turn.usage;
              const isUser = turn.role === 'user';
              const metaBits = [fmtTime(turn.created_at)];
              if (turn.model) metaBits.push(String(turn.model).replace('claude-', ''));
              if (u) {
                metaBits.push(`in ${u.inputTokens} / out ${u.outputTokens}`);
                if (u.costUsd) metaBits.push(fmtUsd(u.costUsd));
              }
              const tools = turn.tools || (turn.payload && turn.payload.tools);
              return el('div.card', { style: 'margin:8px 0;padding:10px' }, [
                el('div.row', { style: 'justify-content:space-between' }, [
                  badge(turn.role || '—', isUser ? 'accent' : 'ok'),
                  el('span.muted', { style: 'font-size:11px', text: metaBits.join(' · ') }),
                ]),
                el('div.pre.block', { style: 'margin-top:6px;white-space:pre-wrap', text: truncate(turn.content || '', 1200) }),
                Array.isArray(tools) && tools.length
                  ? el('div.row', { style: 'margin-top:6px;flex-wrap:wrap;gap:4px' }, tools.map((tl) => badge(String(tl), 'warn')))
                  : null,
              ]);
            }))
          : empty('No turns in this session.');

        mount(bodyHost, headline, meta, el('div.section-title', { text: 'Timeline' }), timeline);
      }).catch((e) => mount(bodyHost, errbox(e.message || String(e))));
      return m;
    }
  },
};
