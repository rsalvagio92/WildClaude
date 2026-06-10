// Audit Log — full security/permission audit trail with blocked-only filter.
import { api } from '../api.js';
import {
  el, mount, card, badge, asyncView, empty, truncate, fmtTime,
} from '../ui.js';

export default {
  async mount(view) {
    let blockedOnly = false;

    const head = el('div.page-head', {}, [
      el('div', {}, [
        el('h3', { text: 'Audit Log' }),
        el('p.muted', { text: 'Security and permission events. Blocked actions are flagged.' }),
      ]),
    ]);

    const listCard = el('div');

    const render = () => {
      const path = '/api/audit-log?limit=200' + (blockedOnly ? '&blocked=true' : '');
      asyncView(listCard, () => api.get(path), (d, rerun) => {
        const entries = Array.isArray(d.entries) ? d.entries : [];

        const blockedCb = el('input', {
          type: 'checkbox',
          checked: blockedOnly,
          onchange: (e) => { blockedOnly = e.target.checked; render(); },
        });
        const controls = el('div.row', { style: 'gap:12px;align-items:center' }, [
          el('label.row', { style: 'gap:5px;align-items:center;font-size:12px' }, [
            blockedCb, el('span', { text: 'Blocked only' }),
          ]),
          el('button.icon-btn', { text: '⟳', onclick: rerun }),
        ]);

        if (!entries.length) {
          return card('Audit entries', empty(blockedOnly ? 'No blocked actions.' : 'No audit entries.'), controls);
        }

        return card('Audit entries', el('div.table-wrap', {}, [el('table', {}, [
          el('thead', {}, el('tr', {}, [
            el('th', { text: 'Time' }), el('th', { text: 'Agent' }),
            el('th', { text: 'Action' }), el('th', { text: 'Detail' }),
            el('th', { text: '' }),
          ])),
          el('tbody', {}, entries.map((e) => el('tr', {}, [
            el('td', { text: fmtTime(e.created_at) }),
            el('td', {}, [badge(e.agent_id || '—')]),
            el('td', { text: e.action || '—' }),
            el('td', { text: truncate(e.detail || '', 100) }),
            el('td', {}, [e.blocked ? badge('blocked', 'err') : null]),
          ]))),
        ])]), controls);
      });
    };
    render();

    mount(view, head, listCard);
  },
};
