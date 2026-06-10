// Daily Journal — recent conversation turns rendered as a readable timeline.
import { api, chatId } from '../api.js';
import {
  el, mount, asyncView, badge, card, modal, truncate, fmtTime, empty,
} from '../ui.js';

export default {
  async mount(view) {
    const cid = await chatId();
    const cidQ = encodeURIComponent(cid);

    const root = el('div');
    mount(view, root);

    const listHost = el('div');
    let reload = () => {};

    const head = el('div.page-head', {}, [
      el('div', {}, [
        el('h3', { text: 'Daily Journal' }),
        el('p.muted', { text: 'Recent conversation, newest first.' }),
      ]),
      el('button.btn.btn-sm', { text: '⟳ Refresh', onclick: () => reload() }),
    ]);

    const showFull = (t) => {
      modal({
        title: (t.role === 'user' ? 'You' : 'WildClaude') + ' · ' + fmtTime(t.created_at),
        wide: true,
        body: [
          t.model ? el('div.row', {}, [badge(String(t.model).replace('claude-', ''))]) : null,
          el('pre.block', { text: t.content || '(empty)' }),
        ],
      });
    };

    reload = asyncView(listHost, () => api.get(`/api/agents/main/conversation?chatId=${cidQ}&limit=20`), (d) => {
      const turns = d.turns || [];
      if (!turns.length) return empty('No conversation yet.');
      return el('div.timeline', {}, turns.map((t) => {
        const isUser = t.role === 'user';
        const content = t.content || '';
        const clipped = content.length > 280;
        const row = el('div.card', { style: 'padding:10px 12px;margin-bottom:8px;cursor:pointer', onclick: () => showFull(t) }, [
          el('div.row', { style: 'gap:8px;align-items:center' }, [
            badge(isUser ? 'you' : 'assistant', isUser ? 'accent' : 'ok'),
            t.model ? badge(String(t.model).replace('claude-', '')) : null,
            el('span.grow', {}),
            el('span.muted', { style: 'font-size:12px', text: fmtTime(t.created_at) }),
          ]),
          el('div', { style: 'margin-top:6px;white-space:pre-wrap', text: truncate(content, 280) }),
          clipped ? el('span.muted', { style: 'font-size:12px', text: 'Click to expand…' }) : null,
        ]);
        return row;
      }));
    });

    mount(root, head, listHost);
  },
};
