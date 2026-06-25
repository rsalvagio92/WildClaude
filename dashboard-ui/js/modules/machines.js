// Fleet Control — manage connected secondary machines.
// Real-time telemetry cards, command dispatch, per-machine command history.
// Follows MODULE_CONTRACT: uses the ui.js design system (no Tailwind).
import { api } from '../api.js';
import {
  el, mount, card, badge, modal, confirmDialog,
  toast, toastOk, toastErr, action, modelSelect,
  fmtAgo, fmtTime, loading, errbox, empty,
} from '../ui.js';

const REFRESH_INTERVAL = 30_000;

export default {
  async mount(view, ctx) {
    let timer = null;
    let openHistory = null; // machineId whose history panel is expanded

    const grid = el('div.grid.grid-2');
    const head = el('div.page-head', {}, [
      el('div', {}, [
        el('h3', { text: 'Fleet Control' }),
        el('p.muted', { text: 'Live telemetry + remote control of secondary nodes' }),
      ]),
      el('button.btn.btn-sm', { text: '⟳ Refresh', onclick: () => render() }),
    ]);

    const root = el('div', {}, [head, grid]);
    mount(view, root);

    async function render() {
      try {
        const { machines = [] } = await api.get('/api/machines');
        if (!machines.length) {
          mount(grid, el('div.card', {}, [
            el('div', { style: 'text-align:center;padding:24px 8px' }, [
              el('div', { style: 'font-size:32px;margin-bottom:8px', text: '🖥️' }),
              el('p.muted', { text: 'No secondary machines connected.' }),
              el('p.muted', { style: 'font-size:12px;margin-top:4px',
                text: 'Set WILD_ROLE=secondary + WILD_PRIMARY_URL on remote nodes.' }),
            ]),
          ]));
          return;
        }
        mount(grid, machines.map(machineCard));
      } catch (e) {
        mount(grid, errbox(e.message || String(e)));
      }
    }

    function machineCard(m) {
      const t = m.telemetry || {};
      const online = m.status === 'online';

      const cpuPct  = t.cpuPercent != null ? Math.round(t.cpuPercent) : null;
      const ramPct  = t.ramTotal ? Math.round((t.ramUsed / t.ramTotal) * 100) : null;
      const diskPct = t.diskTotal ? Math.round((t.diskUsed / t.diskTotal) * 100) : null;
      const uptime  = t.uptime != null
        ? `${Math.floor(t.uptime / 3600)}h ${Math.floor((t.uptime % 3600) / 60)}m` : '—';

      const headRow = el('div.card-head', {}, [
        el('div.row', { style: 'gap:8px' }, [
          el('span', { style: `display:inline-block;width:9px;height:9px;border-radius:50%;background:${online ? 'var(--ok)' : 'var(--muted)'}` }),
          el('h3', { style: 'font-family:monospace', text: m.machineId }),
          m.version ? el('span.pill', { text: 'v' + m.version }) : null,
        ]),
        el('span.muted', { style: 'font-size:12px', text: fmtAgo(m.lastSeen) }),
      ]);

      const meters = el('div.grid.grid-stat', { style: 'gap:10px' }, [
        meter('CPU', cpuPct, 80),
        meter('RAM', ramPct, 80),
        meter('Disk', diskPct, 85),
      ]);

      const stats = el('div.row', { style: 'gap:16px;font-size:12px;margin-top:10px' }, [
        kv('Mem', m.memoryCount), kv('Sessions', m.sessionCount), kv('Uptime', uptime),
      ]);

      const err = m.lastError
        ? el('p', { style: 'color:var(--err);font-size:12px;margin-top:8px', text: 'Error: ' + m.lastError })
        : null;

      const actions = el('div.btn-row', { style: 'margin-top:12px;border-top:1px solid var(--border);padding-top:12px' }, [
        el('button.btn.btn-sm.btn-danger', { text: 'Restart',
          onclick: () => confirmDialog(`Restart ${m.machineId}? Bot offline ~10s.`,
            () => send(m.machineId, 'restart', {}), { confirmText: 'Restart' }) }),
        el('button.btn.btn-sm', { text: 'STT Provider', onclick: () => pickStt(m.machineId) }),
        el('button.btn.btn-sm', { text: 'Set Model', onclick: () => pickModel(m.machineId) }),
        el('button.btn.btn-sm.btn-ghost', { text: 'History', style: 'margin-left:auto',
          onclick: () => { openHistory = openHistory === m.machineId ? null : m.machineId; render(); } }),
      ]);

      const histPanel = openHistory === m.machineId ? historyPanel(m.machineId) : null;

      return card(null, [headRow, meters, stats, err, actions, histPanel]);
    }

    function meter(label, pct, warnAt) {
      const danger = pct != null && pct > warnAt;
      return el('div', {}, [
        el('div.row', { style: 'justify-content:space-between;font-size:11px;margin-bottom:4px' }, [
          el('span.muted', { text: label }),
          el('span', { style: danger ? 'color:var(--err)' : '', text: pct != null ? pct + '%' : '—' }),
        ]),
        el('div.bar', {}, [el('span', { style: `width:${pct ?? 0}%${danger ? ';background:var(--err)' : ''}` })]),
      ]);
    }

    function kv(k, v) {
      return el('span', {}, [el('span.muted', { text: k + ': ' }), el('span', { text: v ?? '—' })]);
    }

    function historyPanel(machineId) {
      const list = el('div', { style: 'margin-top:6px' }, [loading('Loading…')]);
      api.get(`/api/machines/${encodeURIComponent(machineId)}/commands?limit=30`)
        .then(({ commands = [] }) => {
          if (!commands.length) { mount(list, el('p.muted', { style: 'font-size:12px', text: 'No commands yet.' })); return; }
          mount(list, commands.map(c => {
            const kind = { pending: 'warn', sent: 'accent', acked: 'ok', failed: 'err' }[c.status] || '';
            return el('div.row', { style: 'gap:8px;font-size:12px;padding:5px 0;border-bottom:1px solid var(--border)' }, [
              el('span.muted', { style: 'width:62px;font-family:monospace', text: new Date((c.createdAt > 1e12 ? c.createdAt : c.createdAt * 1000)).toLocaleTimeString() }),
              el('span.pill', { text: c.type }),
              badge(c.status, kind),
              c.result ? el('span.muted', { style: 'margin-left:auto;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', title: c.result, text: c.result }) : null,
            ]);
          }));
        })
        .catch(e => mount(list, errbox(e.message)));
      return el('div', { style: 'margin-top:10px;border-top:1px solid var(--border);padding-top:8px' }, [
        el('div.muted', { style: 'font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px', text: 'Command History' }),
        list,
      ]);
    }

    async function send(machineId, type, payload) {
      await action(() => api.post(`/api/machines/${encodeURIComponent(machineId)}/command`, { type, payload }), {
        ok: `"${type}" queued for ${machineId}`,
        refresh: render,
      });
    }

    function pickStt(machineId) {
      const opts = ['auto', 'groq', 'local'];
      const m = modal({
        title: `STT Provider — ${machineId}`,
        body: el('div.btn-row', {}, opts.map(o =>
          el('button.btn', { text: o, onclick: () => { m.close(); send(machineId, 'set-stt-provider', { provider: o }); } }))),
        footer: el('button.btn', { text: 'Cancel', onclick: () => m.close() }),
      });
    }

    async function pickModel(machineId) {
      const sel = await modelSelect(null, {});
      const m = modal({
        title: `Default Model — ${machineId}`,
        body: el('div', {}, [sel]),
        footer: [
          el('button.btn', { text: 'Cancel', onclick: () => m.close() }),
          el('button.btn.btn-accent', { text: 'Apply', onclick: () => { m.close(); send(machineId, 'set-model', { model: sel.value }); } }),
        ],
      });
    }

    await render();
    timer = setInterval(render, REFRESH_INTERVAL);

    // Router uses the returned function as cleanup on navigate-away.
    return () => { if (timer) clearInterval(timer); };
  },
};
