// Memory Palace — stats, browse/filter/search, pin/delete, detail modal,
// export, and a RAG / context-injection X-ray (keyword FTS vs semantic recall).
import { api, chatId } from '../api.js';
import {
  el, mount, clear, escapeHtml, asyncView, stat, badge, card, modal,
  confirmDialog, toast, toastOk, toastErr, action, loading, empty, errbox,
  fmtAgo, fmtTime, truncate,
} from '../ui.js';

// Safely parse a JSON-array string column into an array of strings.
function parseList(v) {
  if (Array.isArray(v)) return v;
  if (typeof v !== 'string' || !v.trim()) return [];
  try {
    const p = JSON.parse(v);
    return Array.isArray(p) ? p : [];
  } catch { return []; }
}

function impKind(imp) {
  const n = Number(imp) || 0;
  if (n >= 0.8) return 'ok';
  if (n >= 0.5) return 'accent';
  if (n >= 0.3) return 'warn';
  return '';
}

export default {
  async mount(view) {
    const cid = await chatId();
    const cidQ = encodeURIComponent(cid);

    const root = el('div');
    mount(view, root);

    const statsCard = el('div');
    const xrayCard = el('div');
    const browseCard = el('div');
    mount(root,
      statsCard,
      el('div', { style: 'height:14px' }), xrayCard,
      el('div', { style: 'height:14px' }), browseCard,
    );

    // ── Memory detail modal ──────────────────────────────────────────
    const showDetail = (m) => {
      const entities = parseList(m.entities);
      const topics = parseList(m.topics);
      modal({
        title: 'Memory #' + m.id,
        wide: true,
        body: [
          el('div.grid.grid-stat', {}, [
            stat((Number(m.importance) || 0).toFixed(2), 'Importance'),
            stat((Number(m.salience) || 0).toFixed(2), 'Salience'),
            stat(m.pinned ? '★ Pinned' : '—', 'Pinned'),
            stat(m.source || '—', 'Source'),
          ]),
          el('div.section-title', { text: 'Summary' }),
          el('div', { text: m.summary || '(no summary)' }),
          el('div.section-title', { text: 'Raw text' }),
          el('pre.block', { text: m.raw_text || '(empty)' }),
          topics.length ? el('div.section-title', { text: 'Topics' }) : null,
          topics.length ? el('div.row', {}, topics.map((t) => badge(t))) : null,
          entities.length ? el('div.section-title', { text: 'Entities' }) : null,
          entities.length ? el('div.row', {}, entities.map((e) => el('span.pill', { text: e }))) : null,
          el('div.kv', { style: 'margin-top:12px' }, [
            el('dt', { text: 'Created' }), el('dd', { text: fmtTime(m.created_at) }),
            el('dt', { text: 'Accessed' }), el('dd', { text: fmtTime(m.accessed_at) }),
            el('dt', { text: 'Agent' }), el('dd', { text: m.agent_id || '—' }),
          ]),
        ],
      });
    };

    // ── Stats card ───────────────────────────────────────────────────
    asyncView(statsCard, () => api.get(`/api/memories?chatId=${cidQ}`), (d) => {
      const s = d.stats || {};
      const avgImp = Number(s.avgImportance ?? 0);
      return card('Memory Palace', [
        el('div.grid.grid-stat', {}, [
          stat(s.total ?? 0, 'Total memories'),
          stat(s.pinned ?? 0, 'Pinned'),
          stat(avgImp.toFixed(2), 'Avg importance'),
          stat(s.consolidations ?? 0, 'Consolidations'),
        ]),
      ]);
    });

    // ── RAG / Context X-ray ──────────────────────────────────────────
    const renderXray = () => {
      const qInput = el('input.grow', {
        type: 'text',
        placeholder: 'Preview what a message would recall…',
        onkeydown: (e) => { if (e.key === 'Enter') runXray(); },
      });
      const runBtn = el('button.btn.btn-accent', { text: 'Preview recall' });
      const out = el('div', { style: 'margin-top:12px' });

      const runXray = async () => {
        const q = qInput.value.trim();
        if (!q) { mount(out, empty('Type a phrase to see what would be injected into the prompt.')); return; }
        runBtn.disabled = true;
        const prev = runBtn.textContent;
        runBtn.textContent = '…';
        mount(out, loading('Computing recall…'));
        try {
          const qe = encodeURIComponent(q);
          const [fts, sem] = await Promise.all([
            api.get(`/api/memories/list?chatId=${cidQ}&q=${qe}&sort=importance&limit=8`).catch(() => ({ memories: [] })),
            api.get(`/api/memory-search?q=${qe}`).catch(() => ({ byScope: {}, total: 0, semantic: false })),
          ]);

          const ftsMems = fts.memories || [];
          const ftsList = ftsMems.length
            ? el('div', {}, ftsMems.map((m) => el('div.card', { style: 'padding:8px 10px;margin-bottom:6px;cursor:pointer', onclick: () => showDetail(m) }, [
                el('div.row', {}, [badge((Number(m.importance) || 0).toFixed(2), impKind(m.importance)), el('span.grow', { text: truncate(m.summary || m.raw_text, 90) })]),
              ])))
            : empty('No keyword matches.');

          // Semantic results are MemoryBlocks grouped by scope.
          const byScope = sem.byScope || {};
          const blocks = [...(byScope.user || []), ...(byScope.session || []), ...(byScope.agent || [])];
          const semHead = el('div.row', {}, [
            el('span.section-title', { text: 'Semantic recall', style: 'margin:0' }),
            badge(sem.semantic ? 'embeddings' : 'keyword fallback', sem.semantic ? 'ok' : 'warn'),
          ]);
          const semList = blocks.length
            ? el('div', {}, blocks.map((b) => el('div.card', { style: 'padding:8px 10px;margin-bottom:6px' }, [
                el('div.row', {}, [badge(b.scope || 'block'), el('span.grow', { text: truncate(b.body || b.topic, 90) })]),
              ])))
            : empty('No semantic matches.');

          mount(out,
            el('p.muted', { text: 'This is the context-injection preview — these memories would be prepended to the prompt for a message like the one above.' }),
            el('div.grid.grid-2', {}, [
              el('div', {}, [el('div.section-title', { text: 'Keyword recall (FTS)' }), ftsList]),
              el('div', {}, [semHead, semList]),
            ]),
          );
        } catch (e) {
          mount(out, errbox(e.message || String(e)));
        } finally {
          runBtn.disabled = false;
          runBtn.textContent = prev;
        }
      };
      runBtn.addEventListener('click', runXray);

      mount(xrayCard, card('Context X-ray', [
        el('p.muted', { text: 'See exactly which memories a message would surface into the prompt.' }),
        el('div.row', {}, [qInput, runBtn]),
        out,
      ]));
    };
    renderXray();

    // ── Browse / filter / search ─────────────────────────────────────
    const state = { q: '', topic: '', sort: 'importance', pinned: false, limit: 40, offset: 0 };
    const listHost = el('div');
    let debounceTimer = null;

    const buildListUrl = () => {
      const p = new URLSearchParams();
      p.set('chatId', cid);
      if (state.q) p.set('q', state.q);
      if (state.topic) p.set('topic', state.topic);
      if (state.pinned) p.set('pinned', '1');
      p.set('sort', state.sort);
      p.set('limit', String(state.limit));
      p.set('offset', String(state.offset));
      return '/api/memories/list?' + p.toString();
    };

    let reloadList = () => {};

    const renderRows = (memories) => {
      if (!memories.length) return empty('No memories match these filters.');
      return el('div.table-wrap', {}, [el('table', {}, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: '' }),
          el('th', { text: 'Summary' }),
          el('th', { text: 'Imp' }),
          el('th', { text: 'Topics' }),
          el('th', { text: 'Created' }),
          el('th', { text: '' }),
        ])),
        el('tbody', {}, memories.map((m) => {
          const topics = parseList(m.topics);
          return el('tr', { style: 'cursor:pointer' }, [
            el('td', { text: m.pinned ? '★' : '', onclick: () => showDetail(m) }),
            el('td', { text: truncate(m.summary || m.raw_text, 80), onclick: () => showDetail(m) }),
            el('td', {}, [badge((Number(m.importance) || 0).toFixed(2), impKind(m.importance))]),
            el('td', { text: topics.slice(0, 3).join(', ') || '—', onclick: () => showDetail(m) }),
            el('td', { text: fmtAgo(m.created_at), onclick: () => showDetail(m) }),
            el('td', {}, [
              el('button.btn.btn-sm', {
                text: m.pinned ? 'Unpin' : 'Pin',
                onclick: (e) => {
                  e.stopPropagation();
                  action(() => api.post(`/api/memories/${m.id}/${m.pinned ? 'unpin' : 'pin'}`), {
                    ok: m.pinned ? 'Unpinned' : 'Pinned', refresh: reloadList,
                  });
                },
              }),
              el('button.btn.btn-sm.btn-danger', {
                text: 'Delete',
                onclick: (e) => {
                  e.stopPropagation();
                  confirmDialog(`Delete memory #${m.id}? This cannot be undone.`, () =>
                    action(() => api.del(`/api/memories/${m.id}`), { ok: 'Deleted', refresh: reloadList }));
                },
              }),
            ]),
          ]);
        })),
      ])]);
    };

    const loadList = () => {
      reloadList = asyncView(listHost, () => api.get(buildListUrl()), (d) => {
        const memories = d.memories || [];
        const total = d.total ?? memories.length;
        return el('div', {}, [
          el('p.muted', { text: `${memories.length}${total > memories.length ? ' of ' + total : ''} memories` }),
          renderRows(memories),
        ]);
      });
    };

    // Controls
    const search = el('input.grow', {
      type: 'text', placeholder: 'Search memories…',
      oninput: (e) => {
        state.q = e.target.value.trim();
        state.offset = 0;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(loadList, 400);
      },
    });
    const topicSel = el('select', {
      onchange: (e) => { state.topic = e.target.value; state.offset = 0; loadList(); },
    }, [el('option', { value: '', text: 'All topics' })]);
    const sortSel = el('select', {
      onchange: (e) => { state.sort = e.target.value; state.offset = 0; loadList(); },
    }, [
      el('option', { value: 'importance', text: 'Sort: importance' }),
      el('option', { value: 'salience', text: 'Sort: salience' }),
      el('option', { value: 'recent', text: 'Sort: recent' }),
    ]);
    const pinnedBtn = el('button.btn.btn-sm', { text: 'Pinned only' });
    pinnedBtn.addEventListener('click', () => {
      state.pinned = !state.pinned;
      state.offset = 0;
      pinnedBtn.className = 'btn btn-sm' + (state.pinned ? ' btn-accent' : '');
      loadList();
    });
    const exportBtn = el('button.btn.btn-sm', {
      text: 'Export JSON',
      onclick: async () => {
        try {
          const d = await api.get(`/api/memories/list?chatId=${cidQ}&limit=10000&sort=importance`);
          const blob = new Blob([JSON.stringify(d.memories || [], null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = el('a', { href: url, download: `memories-${cid}-${Date.now()}.json` });
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
          toastOk('Exported');
        } catch (e) { toastErr(e.message || String(e)); }
      },
    });

    mount(browseCard, card('Browse memories', [
      el('div.row', { style: 'flex-wrap:wrap;gap:8px' }, [search, topicSel, sortSel, pinnedBtn, exportBtn]),
      el('div', { style: 'height:10px' }),
      listHost,
    ]));

    // Populate topics dropdown (non-fatal).
    api.get(`/api/memories/topics?chatId=${cidQ}`).then((d) => {
      (d.topics || []).forEach((t) => topicSel.appendChild(
        el('option', { value: t.topic, text: `${t.topic} (${t.count})` })));
    }).catch(() => {});

    loadList();

    return () => clearTimeout(debounceTimer);
  },
};
