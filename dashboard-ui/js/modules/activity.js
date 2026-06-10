// Live Activity — SSE feed + audit trail + hive-mind delegation history.
import { api } from '../api.js';
import { onSSE } from '../sse.js';
import {
  el, mount, card, badge, stat, asyncView, empty, truncate,
  fmtTime, fmtAgo, escapeHtml,
} from '../ui.js';

export default {
  async mount(view) {
    const head = el('div.page-head', {}, [
      el('div', {}, [
        el('h3', { text: 'Live Activity' }),
        el('p.muted', { text: 'Real-time event stream, audit trail, and agent delegation history.' }),
      ]),
    ]);

    const liveCard = el('div');
    const auditCard = el('div');
    const hiveCard = el('div');
    mount(view, head, liveCard,
      el('div', { style: 'height:14px' }), auditCard,
      el('div', { style: 'height:14px' }), hiveCard);

    // ── Live SSE feed ───────────────────────────────────────────────
    const logBox = el('div.pre.block', {
      style: 'height:280px;overflow:auto;font-size:12px;line-height:1.5',
    });
    const placeholder = el('div.muted', { text: 'Waiting for events…' });
    logBox.appendChild(placeholder);

    const autoScroll = el('input', { type: 'checkbox', checked: true });
    const clearBtn = el('button.btn.btn-sm', {
      text: 'Clear', onclick: () => { logBox.replaceChildren(); },
    });
    const head2 = el('div.row', { style: 'gap:12px;align-items:center' }, [
      el('label.row', { style: 'gap:5px;align-items:center;font-size:12px' }, [autoScroll, el('span', { text: 'Auto-scroll' })]),
      clearBtn,
    ]);

    const describe = (type, data) => {
      if (!data || typeof data !== 'object') return '';
      if (data.content) return truncate(String(data.content), 100);
      if (data.description) return truncate(String(data.description), 100);
      if (type === 'processing') return data.processing ? 'processing started' : 'idle';
      const keys = Object.keys(data).filter((k) => k !== 'type');
      return keys.length ? truncate(JSON.stringify(data), 100) : '';
    };

    const append = (type, data) => {
      if (placeholder.parentNode) placeholder.remove();
      const kindMap = { error: 'err', processing: 'warn', assistant_message: 'ok', user_message: 'accent' };
      const line = el('div', { style: 'padding:2px 0;border-bottom:1px solid var(--bg-elev2)' }, [
        el('span.muted', { text: new Date().toLocaleTimeString() + ' ' }),
        badge(type, kindMap[type] || ''),
        el('span', { text: ' ' + describe(type, data) }),
      ]);
      logBox.appendChild(line);
      while (logBox.children.length > 500) logBox.removeChild(logBox.firstChild);
      if (autoScroll.checked) logBox.scrollTop = logBox.scrollHeight;
    };

    const unsub = onSSE('*', (type, data) => append(type, data));
    mount(liveCard, card('Live Feed', logBox, head2));

    // ── Audit trail ─────────────────────────────────────────────────
    const renderAudit = () => {
      asyncView(auditCard, () => api.get('/api/audit?limit=50'), (d, rerun) => {
        const entries = Array.isArray(d.entries) ? d.entries : [];
        const refresh = el('button.icon-btn', { text: '⟳', onclick: rerun });
        const headExtra = el('div.row', { style: 'gap:8px;align-items:center' }, [
          el('span.muted', { style: 'font-size:12px', text: `${d.total ?? entries.length} total` }),
          refresh,
        ]);
        if (!entries.length) return card('Audit Trail', empty('No audit entries.'), headExtra);
        return card('Audit Trail', el('div.table-wrap', {}, [el('table', {}, [
          el('thead', {}, el('tr', {}, [
            el('th', { text: 'Time' }), el('th', { text: 'Agent' }),
            el('th', { text: 'Action' }), el('th', { text: 'Status' }),
          ])),
          el('tbody', {}, entries.map((e) => el('tr', {}, [
            el('td', { text: fmtTime(e.created_at) }),
            el('td', {}, [badge(e.agent_id || '—')]),
            el('td', { text: truncate(e.action || '', 60) }),
            el('td', {}, [e.blocked ? badge('blocked', 'err') : badge('ok', 'ok')]),
          ]))),
        ])]), headExtra);
      });
    };
    renderAudit();

    // ── Hive Mind ───────────────────────────────────────────────────
    const renderHive = () => {
      asyncView(hiveCard, () => api.get('/api/hive-mind?limit=30'), (d, rerun) => {
        const entries = Array.isArray(d.entries) ? d.entries : [];
        const refresh = el('button.icon-btn', { text: '⟳', onclick: rerun });
        if (!entries.length) return card('Hive Mind', empty('No delegation history yet.'), refresh);
        return card('Hive Mind', el('div.table-wrap', {}, [el('table', {}, [
          el('thead', {}, el('tr', {}, [
            el('th', { text: 'Time' }), el('th', { text: 'Agent' }),
            el('th', { text: 'Action' }), el('th', { text: 'Summary' }),
          ])),
          el('tbody', {}, entries.map((e) => el('tr', {}, [
            el('td', { text: fmtAgo(e.created_at) }),
            el('td', {}, [badge(e.agent_id || '—')]),
            el('td', { text: e.action || '—' }),
            el('td', { text: truncate(e.summary || '', 80) }),
          ]))),
        ])]), refresh);
      });
    };
    renderHive();

    return () => unsub();
  },
};
