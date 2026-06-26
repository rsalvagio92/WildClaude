// Fleet Control — rich telemetry cards, sparklines, bulk actions, alert thresholds.
// Follows MODULE_CONTRACT: uses ui.js design system (no Tailwind), returns cleanup fn.
import { api } from '../api.js';
import {
  el, mount, card, badge, modal, confirmDialog,
  toast, toastOk, toastErr, action, modelSelect,
  fmtAgo, loading, errbox, empty,
} from '../ui.js';

const REFRESH_INTERVAL = 15_000;
const ALERT_CPU = 85;
const ALERT_RAM = 85;
const ALERT_DISK = 90;

export default {
  async mount(view, ctx) {
    let timer = null;
    let countdown = REFRESH_INTERVAL / 1000;
    let countdownTimer = null;
    let expanded = null;   // machineId of expanded detail panel
    let activeTab = {};    // machineId → tab key

    // ── Layout ───────────────────────────────────────────────────────────────

    const summaryBar = el('div.row', { style: 'gap:16px;align-items:center;flex-wrap:wrap;padding:10px 0 4px' });
    const bulkRow = el('div.row', { style: 'gap:8px;margin-left:auto;flex-wrap:wrap' });
    const grid = el('div', { style: 'display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(340px,1fr))' });
    const refreshLabel = el('span.muted', { style: 'font-size:11px', text: 'Refresh in 15s' });

    const head = el('div.page-head', {}, [
      el('div', {}, [
        el('h3', { text: 'Fleet Control' }),
        el('p.muted', { text: 'Live telemetry, remote control, telemetry history' }),
      ]),
      el('div.row', { style: 'gap:8px;align-items:center' }, [
        refreshLabel,
        el('button.btn.btn-sm', { text: '⟳', onclick: () => render() }),
      ]),
    ]);

    const root = el('div', {}, [head, summaryBar, bulkRow, grid]);
    mount(view, root);

    // ── Countdown ─────────────────────────────────────────────────────────────

    function startCountdown() {
      if (countdownTimer) clearInterval(countdownTimer);
      countdown = REFRESH_INTERVAL / 1000;
      countdownTimer = setInterval(() => {
        countdown = Math.max(0, countdown - 1);
        refreshLabel.textContent = countdown > 0 ? `Refresh in ${countdown}s` : 'Refreshing…';
      }, 1000);
    }

    // ── Sparkline (inline SVG) ────────────────────────────────────────────────

    function sparkline(points, color = 'var(--accent)') {
      if (!points || points.length < 2) {
        const s = el('span.muted', { style: 'font-size:10px', text: '—' });
        return s;
      }
      const max = Math.max(...points, 1);
      const W = 72, H = 24;
      const pts = points.map((v, i) => {
        const x = (i / (points.length - 1)) * W;
        const y = H - (v / max) * H;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.setAttribute('width', W);
      svg.setAttribute('height', H);
      svg.style.cssText = 'display:block;overflow:visible';
      const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      poly.setAttribute('points', pts);
      poly.setAttribute('fill', 'none');
      poly.setAttribute('stroke', color);
      poly.setAttribute('stroke-width', '1.8');
      poly.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(poly);
      return svg;
    }

    // ── Summary bar ───────────────────────────────────────────────────────────

    function renderSummary(machines, summary) {
      const { total, online, offline, avgCpu } = summary || {};
      const cpuColor = (avgCpu || 0) > ALERT_CPU ? 'var(--err)' : 'inherit';
      mount(summaryBar, [
        el('span', { style: 'font-size:13px' }, [
          el('strong', { text: String(total ?? machines.length) }),
          el('span.muted', { text: ' machines' }),
        ]),
        el('span', {}, [
          badge(String(online ?? machines.filter(m => m.status === 'online').length) + ' online', 'ok'),
        ]),
        offline > 0 ? el('span', {}, [badge(String(offline) + ' offline', 'err')]) : null,
        el('span', { style: 'font-size:12px' }, [
          el('span.muted', { text: 'Avg CPU ' }),
          el('span', { style: `color:${cpuColor}`, text: avgCpu != null ? avgCpu + '%' : '—' }),
        ]),
      ]);
      mount(bulkRow, [
        el('span.muted', { style: 'font-size:11px;line-height:28px', text: 'Bulk:' }),
        el('button.btn.btn-sm', { text: '⟳ Sync All', onclick: () => bulkCmd('sync-memories', 'Sync memories on all machines?') }),
        el('button.btn.btn-sm', { text: '↑ Upgrade All', onclick: () => bulkCmd('upgrade', 'Run blue-green upgrade on ALL machines?') }),
        el('button.btn.btn-sm', { text: '⚡ Reload Skills', onclick: () => bulkCmd('reload-skills', 'Reload skills on all machines?') }),
        el('button.btn.btn-sm.btn-danger', { text: '↺ Restart All', onclick: () =>
          confirmDialog('Restart ALL secondary machines? Each will be offline ~10s.', () => bulkCmd('restart', null, true),
            { confirmText: 'Restart All', danger: true }) }),
      ]);
    }

    async function bulkCmd(type, confirmMsg, alreadyConfirmed = false) {
      const go = async () => {
        await action(() => api.post('/api/machines/command-all', { type, payload: {} }), {
          ok: `"${type}" queued on all machines`,
          refresh: render,
        });
      };
      if (alreadyConfirmed || !confirmMsg) { go(); return; }
      confirmDialog(confirmMsg, go, { confirmText: 'Proceed' });
    }

    // ── Machine card ──────────────────────────────────────────────────────────

    async function machineCard(m, history) {
      const t = m.telemetry || {};
      const online = m.status === 'online';

      const cpuPct  = t.cpuPercent != null ? Math.round(t.cpuPercent) : null;
      const ramPct  = t.ramTotal ? Math.round((t.ramUsed / t.ramTotal) * 100) : null;
      const diskPct = t.diskTotal ? Math.round((t.diskUsed / t.diskTotal) * 100) : null;
      const uptimeFmt = t.uptime != null
        ? `${Math.floor(t.uptime / 86400)}d ${Math.floor((t.uptime % 86400) / 3600)}h`
        : '—';

      const alertCpu  = cpuPct  != null && cpuPct  > ALERT_CPU;
      const alertRam  = ramPct  != null && ramPct  > ALERT_RAM;
      const alertDisk = diskPct != null && diskPct > ALERT_DISK;
      const hasAlert  = alertCpu || alertRam || alertDisk;

      // CPU/RAM sparklines from history
      const cpuHistory  = (history || []).map(h => h.telemetry?.cpuPercent ?? 0);
      const ramHistory  = (history || []).map(h => h.telemetry?.ramTotal
        ? Math.round((h.telemetry.ramUsed / h.telemetry.ramTotal) * 100) : 0);

      const isExpanded = expanded === m.machineId;
      const tab = activeTab[m.machineId] || 'overview';

      // ── Card header ──

      const dot = el('span', { style: `display:inline-block;width:9px;height:9px;border-radius:50%;flex-shrink:0;background:${online ? 'var(--ok)' : 'var(--muted)'}` });
      const headRow = el('div.card-head', { style: 'flex-wrap:wrap;gap:6px' }, [
        el('div.row', { style: 'gap:8px;flex:1;min-width:0' }, [
          dot,
          el('h3', { style: 'font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', text: m.machineId }),
          m.version ? badge('v' + m.version, '') : null,
          hasAlert ? badge('⚠', 'warn') : null,
        ]),
        el('div.row', { style: 'gap:6px;align-items:center' }, [
          el('span.muted', { style: 'font-size:11px', text: fmtAgo(m.lastSeen) }),
          el('button.btn.btn-sm.btn-ghost', {
            text: isExpanded ? '▲ Collapse' : '▼ Details',
            onclick: () => {
              expanded = isExpanded ? null : m.machineId;
              if (!isExpanded) activeTab[m.machineId] = activeTab[m.machineId] || 'overview';
              render();
            },
          }),
        ]),
      ]);

      // ── Telemetry meters row ──

      function meter(label, pct, warnAt, historyPts) {
        const danger = pct != null && pct > warnAt;
        const col = danger ? 'var(--err)' : pct != null && pct > warnAt * 0.8 ? 'var(--warn, #f59e0b)' : 'var(--accent)';
        return el('div', { style: 'flex:1;min-width:80px' }, [
          el('div.row', { style: 'justify-content:space-between;font-size:11px;margin-bottom:3px' }, [
            el('span.muted', { text: label }),
            el('span', { style: `color:${danger ? 'var(--err)' : 'inherit'}`, text: pct != null ? pct + '%' : '—' }),
          ]),
          el('div.bar', {}, [el('span', { style: `width:${pct ?? 0}%;background:${col}` })]),
          el('div', { style: 'margin-top:4px' }, [sparkline(historyPts, col)]),
        ]);
      }

      const meters = el('div.row', { style: 'gap:12px;margin-top:10px;align-items:flex-start' }, [
        meter('CPU', cpuPct, ALERT_CPU, cpuHistory),
        meter('RAM', ramPct, ALERT_RAM, ramHistory),
        meter('Disk', diskPct, ALERT_DISK, []),
      ]);

      // ── Stats strip ──

      const loadStr = t.loadAverage != null ? t.loadAverage.toFixed(2) : '—';
      const ramStr  = t.ramUsed != null && t.ramTotal != null
        ? `${Math.round(t.ramUsed / 1024 * 10) / 10}/${Math.round(t.ramTotal / 1024 * 10) / 10}GB`
        : '—';

      const statsRow = el('div.row', { style: 'gap:14px;font-size:11px;margin-top:10px;flex-wrap:wrap' }, [
        kv('Mem', m.memoryCount),
        kv('Sessions', m.sessionCount),
        kv('Uptime', uptimeFmt),
        kv('Load', loadStr),
        kv('RAM', ramStr),
        m.primaryUrl ? kv('Primary', m.primaryUrl.replace('http://', '').replace(':3141', '')) : null,
      ]);

      const errBadge = m.lastError
        ? el('p', { style: 'color:var(--err);font-size:11px;margin-top:6px', text: '✕ ' + m.lastError.slice(0, 100) })
        : null;

      // ── Quick action buttons ──

      const quickActions = el('div.btn-row', { style: 'margin-top:12px;border-top:1px solid var(--border);padding-top:10px;flex-wrap:wrap' }, [
        el('button.btn.btn-sm', { text: '⟳ Sync', title: 'Sync memories from primary',
          onclick: () => send(m.machineId, 'sync-memories', {}) }),
        el('button.btn.btn-sm', { text: '↑ Upgrade', title: 'Blue-green upgrade',
          onclick: () => confirmDialog(`Run blue-green upgrade on ${m.machineId}?`,
            () => send(m.machineId, 'upgrade', {}), { confirmText: 'Upgrade' }) }),
        el('button.btn.btn-sm', { text: '⚡ Skills', title: 'Reload skills',
          onclick: () => send(m.machineId, 'reload-skills', {}) }),
        el('button.btn.btn-sm', { text: '⬡ Model', onclick: () => pickModel(m.machineId) }),
        el('button.btn.btn-sm', { text: 'STT', onclick: () => pickStt(m.machineId) }),
        el('button.btn.btn-sm.btn-danger', { text: '↺ Restart', style: 'margin-left:auto',
          onclick: () => confirmDialog(`Restart ${m.machineId}? Bot offline ~10s.`,
            () => send(m.machineId, 'restart', {}), { confirmText: 'Restart' }) }),
      ]);

      // ── Expanded detail panel ──

      let detailPanel = null;
      if (isExpanded) {
        const tabs = ['overview', 'history', 'actions'];
        const tabBar = el('div.row', { style: 'gap:4px;margin-bottom:10px;border-bottom:1px solid var(--border);padding-bottom:6px' },
          tabs.map(t2 => el('button.btn.btn-sm', {
            text: t2.charAt(0).toUpperCase() + t2.slice(1),
            style: tab === t2 ? 'background:var(--accent);color:#fff' : '',
            onclick: () => { activeTab[m.machineId] = t2; render(); },
          })));

        let tabContent;
        if (tab === 'overview') {
          tabContent = overviewTab(m, t, cpuHistory, ramHistory, uptimeFmt);
        } else if (tab === 'history') {
          tabContent = historyTab(m.machineId);
        } else {
          tabContent = actionsTab(m);
        }
        detailPanel = el('div', { style: 'margin-top:10px;border-top:1px solid var(--border);padding-top:10px' }, [tabBar, tabContent]);
      }

      return card(null, [headRow, meters, statsRow, errBadge, quickActions, detailPanel]);
    }

    // ── Overview tab ─────────────────────────────────────────────────────────

    function overviewTab(m, t, cpuHistory, ramHistory, uptimeFmt) {
      const rows = [
        ['Machine ID', m.machineId],
        ['Status', m.status],
        ['Version', m.version || '—'],
        ['Last seen', m.lastSeen ? new Date(m.lastSeen).toLocaleString() : '—'],
        ['Primary URL', m.primaryUrl || '— (this is primary)'],
        ['System uptime', uptimeFmt],
        ['CPU load avg', t.loadAverage != null ? t.loadAverage.toFixed(2) : '—'],
        ['RAM total', t.ramTotal ? `${Math.round(t.ramTotal / 1024 * 10) / 10} GB` : '—'],
        ['Disk total', t.diskTotal ? `${Math.round(t.diskTotal / 1024)} GB` : '—'],
        ['Sessions', m.sessionCount ?? '—'],
        ['Memories', m.memoryCount ?? '—'],
      ];

      const tbl = el('table', { style: 'width:100%;border-collapse:collapse;font-size:12px' },
        rows.map(([k, v]) => el('tr', {}, [
          el('td', { style: 'padding:3px 10px 3px 0;color:var(--muted);white-space:nowrap;width:120px', text: k }),
          el('td', { style: 'padding:3px 0;word-break:break-all', text: String(v) }),
        ])));

      const cpuSpark = el('div', { style: 'margin-top:12px' }, [
        el('div.muted', { style: 'font-size:11px;margin-bottom:4px', text: `CPU history (last ${cpuHistory.length} snapshots)` }),
        sparklineBig(cpuHistory, ALERT_CPU),
      ]);
      const ramSpark = el('div', { style: 'margin-top:8px' }, [
        el('div.muted', { style: 'font-size:11px;margin-bottom:4px', text: `RAM % history` }),
        sparklineBig(ramHistory, ALERT_RAM),
      ]);

      return el('div', {}, [tbl, cpuSpark, ramSpark]);
    }

    function sparklineBig(points, warnAt) {
      if (!points || points.length < 2) return el('p.muted', { style: 'font-size:11px', text: 'Not enough data yet.' });
      const max = Math.max(...points, 1);
      const W = 280, H = 48;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', H);
      svg.style.cssText = 'display:block;overflow:visible;max-width:100%';

      // Warn zone fill
      if (warnAt) {
        const yWarn = H - (warnAt / 100) * H;
        const fill = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        fill.setAttribute('x', '0'); fill.setAttribute('y', String(yWarn));
        fill.setAttribute('width', W); fill.setAttribute('height', String(H - yWarn));
        fill.setAttribute('fill', 'rgba(239,68,68,0.08)');
        svg.appendChild(fill);
      }

      const pts = points.map((v, i) => {
        const x = (i / (points.length - 1)) * W;
        const y = H - (v / max) * H;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');

      const lastVal = points[points.length - 1];
      const color = lastVal > warnAt ? 'var(--err)' : 'var(--accent)';

      const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      poly.setAttribute('points', pts);
      poly.setAttribute('fill', 'none');
      poly.setAttribute('stroke', color);
      poly.setAttribute('stroke-width', '2');
      poly.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(poly);

      // Last value dot
      const lastPt = pts.split(' ').at(-1)?.split(',');
      if (lastPt) {
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', lastPt[0]); dot.setAttribute('cy', lastPt[1]);
        dot.setAttribute('r', '3'); dot.setAttribute('fill', color);
        svg.appendChild(dot);
      }

      return svg;
    }

    // ── History tab ───────────────────────────────────────────────────────────

    function historyTab(machineId) {
      const list = el('div', {}, [loading('Loading command history…')]);
      api.get(`/api/machines/${encodeURIComponent(machineId)}/commands?limit=50`)
        .then(({ commands = [] }) => {
          if (!commands.length) { mount(list, el('p.muted', { style: 'font-size:12px', text: 'No commands yet.' })); return; }
          mount(list, [
            el('div.row', { style: 'gap:8px;font-size:10px;color:var(--muted);padding:0 0 4px;border-bottom:1px solid var(--border)' }, [
              el('span', { style: 'width:60px', text: 'Time' }),
              el('span', { style: 'width:90px', text: 'Command' }),
              el('span', { style: 'width:60px', text: 'Status' }),
              el('span', { text: 'Result' }),
            ]),
            ...commands.map(c => {
              const kind = { pending: 'warn', sent: 'accent', acked: 'ok', failed: 'err' }[c.status] || '';
              const ts = new Date((c.createdAt > 1e12 ? c.createdAt : c.createdAt * 1000));
              return el('div.row', { style: 'gap:8px;font-size:11px;padding:4px 0;border-bottom:1px solid var(--border);flex-wrap:wrap' }, [
                el('span.muted', { style: 'width:60px;font-family:monospace', text: ts.toLocaleTimeString() }),
                el('span.pill', { style: 'width:90px', text: c.type }),
                badge(c.status, kind),
                c.result ? el('span.muted', { style: 'font-size:10px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', title: c.result, text: c.result }) : null,
              ]);
            }),
          ]);
        })
        .catch(e => mount(list, errbox(e.message)));
      return list;
    }

    // ── Actions tab ───────────────────────────────────────────────────────────

    function actionsTab(m) {
      const mid = m.machineId;
      const section = (title, btns) => el('div', { style: 'margin-bottom:14px' }, [
        el('div.muted', { style: 'font-size:10px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px', text: title }),
        el('div.btn-row', { style: 'flex-wrap:wrap' }, btns),
      ]);

      return el('div', {}, [
        section('Process', [
          el('button.btn.btn-sm.btn-danger', { text: '↺ Restart bot',
            onclick: () => confirmDialog(`Restart WildClaude on ${mid}?`,
              () => send(mid, 'restart', {}), { confirmText: 'Restart' }) }),
          el('button.btn.btn-sm', { text: '↑ Upgrade (blue-green)',
            onclick: () => confirmDialog(`Run blue-green upgrade on ${mid}?\nBot stays live during build. Only ~5s downtime.`,
              () => send(mid, 'upgrade', {}), { confirmText: 'Upgrade' }) }),
          el('button.btn.btn-sm', { text: '🔬 Health check',
            onclick: () => send(mid, 'run-health-check', {}) }),
        ]),
        section('Memory & Skills', [
          el('button.btn.btn-sm', { text: '⟳ Sync memories',
            onclick: () => send(mid, 'sync-memories', {}) }),
          el('button.btn.btn-sm', { text: '⚡ Reload skills',
            onclick: () => send(mid, 'reload-skills', {}) }),
          el('button.btn.btn-sm', { text: '🗑 Clear cache',
            onclick: () => confirmDialog(`Clear cache on ${mid}?`, () => send(mid, 'clear-cache', {})) }),
        ]),
        section('Configuration', [
          el('button.btn.btn-sm', { text: '⬡ Set model', onclick: () => pickModel(mid) }),
          el('button.btn.btn-sm', { text: 'STT provider', onclick: () => pickStt(mid) }),
        ]),
        section('Message', [
          el('button.btn.btn-sm', { text: '📢 Broadcast message', onclick: () => broadcastModal(mid) }),
        ]),
      ]);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function kv(k, v) {
      return el('span', { style: 'white-space:nowrap' }, [
        el('span.muted', { text: k + ': ' }),
        el('span', { text: v ?? '—' }),
      ]);
    }

    async function send(machineId, type, payload) {
      await action(() => api.post(`/api/machines/${encodeURIComponent(machineId)}/command`, { type, payload }), {
        ok: `"${type}" queued → ${machineId}`,
        refresh: render,
      });
    }

    function pickStt(machineId) {
      const opts = ['auto', 'groq', 'local'];
      const m = modal({
        title: `STT Provider — ${machineId}`,
        body: el('div', { style: 'display:grid;gap:8px' }, [
          el('p.muted', { style: 'font-size:12px', text: 'auto = Groq first, local fallback. local = whisper-cpp (requires WHISPER_MODEL_PATH).' }),
          el('div.btn-row', {}, opts.map(o =>
            el('button.btn', { text: o, onclick: () => { m.close(); send(machineId, 'set-stt-provider', { provider: o }); } }))),
        ]),
        footer: el('button.btn', { text: 'Cancel', onclick: () => m.close() }),
      });
    }

    async function pickModel(machineId) {
      const sel = await modelSelect(null, {});
      const m = modal({
        title: `Default Model — ${machineId}`,
        body: el('div', {}, [
          el('p.muted', { style: 'font-size:12px;margin-bottom:8px', text: 'Sets the default model for new sessions on this machine.' }),
          sel,
        ]),
        footer: [
          el('button.btn', { text: 'Cancel', onclick: () => m.close() }),
          el('button.btn.btn-accent', { text: 'Apply', onclick: () => { m.close(); send(machineId, 'set-model', { model: sel.value }); } }),
        ],
      });
    }

    function broadcastModal(machineId) {
      const input = el('textarea', { style: 'width:100%;height:80px;resize:vertical;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:8px;color:inherit;font-size:13px' });
      const m = modal({
        title: `Broadcast → ${machineId}`,
        body: el('div', {}, [
          el('p.muted', { style: 'font-size:12px;margin-bottom:8px', text: 'Send a text message to this machine (logged, no Telegram reply).' }),
          input,
        ]),
        footer: [
          el('button.btn', { text: 'Cancel', onclick: () => m.close() }),
          el('button.btn.btn-accent', { text: 'Send', onclick: () => {
            const msg = input.value.trim();
            if (!msg) { toastErr('Empty message'); return; }
            m.close();
            send(machineId, 'broadcast', { message: msg });
          }}),
        ],
      });
      setTimeout(() => input.focus(), 50);
    }

    // ── Main render ───────────────────────────────────────────────────────────

    async function render() {
      startCountdown();
      try {
        const [{ machines = [] }, summary, historyMap] = await Promise.all([
          api.get('/api/machines'),
          api.get('/api/machines/summary').catch(() => ({})),
          (async () => {
            if (!expanded) return {};
            const { history } = await api.get(`/api/machines/${encodeURIComponent(expanded)}/telemetry-history?limit=24`).catch(() => ({ history: [] }));
            return { [expanded]: history };
          })(),
        ]);

        renderSummary(machines, summary);

        if (!machines.length) {
          mount(grid, el('div.card', { style: 'grid-column:1/-1' }, [
            empty('No secondary machines connected.', 'Set WILD_ROLE=secondary + WILD_PRIMARY_URL on remote nodes.'),
          ]));
          return;
        }

        // Render all cards — expanded one gets history, others get [] for sparklines
        const cards = await Promise.all(machines.map(m => machineCard(m, historyMap[m.machineId] || [])));
        mount(grid, cards);
      } catch (e) {
        mount(grid, errbox(e.message || String(e)));
      }
    }

    await render();
    timer = setInterval(render, REFRESH_INTERVAL);

    return () => {
      if (timer) clearInterval(timer);
      if (countdownTimer) clearInterval(countdownTimer);
    };
  },
};
