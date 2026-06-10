// Knowledge Wiki — durable, topic-keyed articles distilled from your memories,
// recalled automatically when their topic comes up in chat. Layered on
// memory_blocks. Drafts (curator suggestions) await approval.
import { api } from '../api.js';
import {
  el, mount, clear, escapeHtml, badge, card, empty, loading, errbox,
  modal, confirmDialog, toastOk, toastErr, action, fmtTime, truncate,
} from '../ui.js';

export default {
  async mount(view) {
    const root = el('div');
    mount(view, root);
    render(root);
  },
};

function render(root) {
  const run = () => render(root);
  const head = el('div.page-head', {}, [
    el('div', {}, [
      el('h3', { text: 'Knowledge Wiki' }),
      el('p.muted', { text: 'Durable articles about you and your world. Mentioned topics are recalled into chat automatically. Editable and expandable any time.' }),
    ]),
    el('div.btn-row', {}, [
      el('button.btn.btn-accent', { text: '✨ Distill a topic', onclick: () => openDistill(run) }),
      el('button.btn', { text: '+ New article', onclick: () => openEditor({ reload: run }) }),
      el('button.btn.btn-sm', { text: 'Run curation', title: 'Scan recent memories for new article topics', onclick: () => action(() => api.post('/api/wiki/curate', {}), { ok: 'Curation queued', refresh: run }) }),
      el('button.icon-btn', { text: '⟳', onclick: run }),
    ]),
  ]);
  const draftsWrap = el('div');
  const grid = el('div.grid.grid-2', { style: 'margin-top:14px' });
  mount(root, head, draftsWrap, grid);
  mount(grid, loading('Loading articles…'));

  api.get('/api/wiki?includeDrafts=true').then(({ articles }) => {
    const drafts = (articles || []).filter((a) => a.draft);
    const published = (articles || []).filter((a) => !a.draft);

    // Suggestions (drafts) — approve/discard.
    clear(draftsWrap);
    if (drafts.length) {
      draftsWrap.appendChild(card(`Suggested articles (${drafts.length})`, [
        el('p.muted', { text: 'Drafted from recurring topics in your important memories. Approve to publish (and start recalling), or discard.', style: 'font-size:12px' }),
        el('div.grid.grid-2', {}, drafts.map((a) => draftCard(a, run))),
      ]));
    }

    if (!published.length) {
      mount(grid, empty('No articles yet. Distill a topic, write one, or run curation to draft from your memories.'));
      return;
    }
    mount(grid, ...published.map((a) => articleCard(a, run)));
  }).catch((e) => mount(grid, errbox(e.message)));
}

function articleCard(a, reload) {
  return el('div.card', {}, [
    el('div.row', {}, [
      el('span', { text: '📄', style: 'font-size:16px' }),
      el('h3', { text: a.topic, style: 'margin:0;flex:1' }),
      a.pinned ? badge('pinned', 'accent') : null,
    ]),
    el('p.muted', { text: truncate(a.body.replace(/\s+/g, ' '), 160), style: 'margin:8px 0;font-size:13px' }),
    el('p.muted', { text: 'updated ' + fmtTime(a.updatedAt), style: 'font-size:11px' }),
    el('div.btn-row', {}, [
      el('button.btn.btn-sm.btn-accent', { text: 'Open / edit', onclick: () => openEditor({ article: a, reload }) }),
      el('button.btn.btn-sm', { text: '✨ Expand', title: 'Pull in new facts from memories', onclick: () => action(() => api.post('/api/wiki/distill', { topic: a.topic, publish: true }), { ok: 'Expanded', refresh: reload }) }),
      el('button.btn.btn-sm.btn-danger', { text: 'Delete', onclick: () => confirmDialog(`Delete article "${a.topic}"?`, () => action(() => api.del('/api/wiki/' + a.id), { ok: 'Deleted', refresh: reload }), { danger: true, confirmText: 'Delete' }) }),
    ]),
  ]);
}

function draftCard(a, reload) {
  return el('div.card', { style: 'border-color: var(--accent)' }, [
    el('div.row', {}, [el('span', { text: '📝', style: 'font-size:16px' }), el('h3', { text: a.topic, style: 'margin:0;flex:1' }), badge('draft', 'warn')]),
    el('p.muted', { text: truncate(a.body.replace(/\s+/g, ' '), 160), style: 'margin:8px 0;font-size:13px' }),
    el('div.btn-row', {}, [
      el('button.btn.btn-sm.btn-accent', { text: '✓ Approve', onclick: () => action(() => api.post(`/api/wiki/${a.id}/approve`, {}), { ok: 'Published', refresh: reload }) }),
      el('button.btn.btn-sm', { text: 'Review', onclick: () => openEditor({ article: a, reload }) }),
      el('button.btn.btn-sm.btn-danger', { text: 'Discard', onclick: () => action(() => api.del('/api/wiki/' + a.id), { ok: 'Discarded', refresh: reload }) }),
    ]),
  ]);
}

function openEditor({ article, reload }) {
  const isEdit = !!article;
  const topicIn = el('input', { type: 'text', placeholder: 'Topic / title', value: article ? article.topic : '' });
  const bodyIn = el('textarea', { rows: 18, style: 'width:100%;font-family:monospace;font-size:13px', value: article ? article.body : '' });
  const m = modal({
    title: isEdit ? `Edit: ${article.topic}` : 'New article',
    wide: true,
    body: [
      el('div.field', {}, [el('label', { text: 'Topic (this is what triggers recall in chat)' }), topicIn]),
      el('div.field', {}, [el('label', { text: 'Article (Markdown)' }), bodyIn]),
    ],
    footer: [
      el('button.btn', { text: 'Cancel', onclick: () => m.close() }),
      el('button.btn.btn-accent', {
        text: 'Save',
        onclick: async () => {
          const topic = topicIn.value.trim();
          const body = bodyIn.value.trim();
          if (!topic || !body) { toastErr('Topic and body required'); return; }
          try {
            if (isEdit) await api.put('/api/wiki/' + article.id, { topic, body });
            else await api.post('/api/wiki', { topic, body });
            toastOk('Saved');
            m.close();
            reload && reload();
          } catch (e) { toastErr(e.message); }
        },
      }),
    ],
  });
  topicIn.focus();
}

function openDistill(reload) {
  const topicIn = el('input', { type: 'text', placeholder: 'e.g. "WildClaude", a project name, a person…' });
  const m = modal({
    title: '✨ Distill an article',
    body: [
      el('p.muted', { text: 'WildClaude reads what it knows about this topic (memories + notes) and drafts an article you can review.' }),
      el('div.field', {}, [el('label', { text: 'Topic' }), topicIn]),
    ],
    footer: [
      el('button.btn', { text: 'Cancel', onclick: () => m.close() }),
      el('button.btn.btn-accent', {
        text: 'Distill',
        onclick: async (ev) => {
          const topic = topicIn.value.trim();
          if (!topic) { toastErr('Enter a topic'); return; }
          ev.target.disabled = true; ev.target.textContent = 'Reading…';
          try {
            const { article } = await api.post('/api/wiki/distill', { topic });
            toastOk(`Drafted "${article.topic}"`);
            m.close();
            reload && reload();
          } catch (e) { toastErr(e.message); ev.target.disabled = false; ev.target.textContent = 'Distill'; }
        },
      }),
    ],
  });
  topicIn.focus();
}
