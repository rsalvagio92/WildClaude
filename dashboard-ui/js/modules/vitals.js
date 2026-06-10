// System Vitals — CPU/RAM/disk/network, token & cost, system update, device controls.
import { api } from '../api.js';
import { el, mount, clear, asyncView, stat, card, badge, toast, toastErr, confirmDialog, fmtUsd, fmtTime, loading, errbox } from '../ui.js';

export default {
  async mount(view) {
    const root = el('div');
    mount(view, root);

    const vitalsCard = el('div');
    const tokensCard = el('div');
    const updateCard = el('div');
    const deviceCard = el('div');
    mount(root, vitalsCard, el('div', { style: 'height:14px' }), tokensCard,
      el('div', { style: 'height:14px' }), updateCard, el('div', { style: 'height:14px' }), deviceCard);

    // ── Vitals (auto-refresh every 5s) ──
    const renderVitals = async () => {
      try {
        const v = await api.get('/api/vitals');
        const p = v.process || {}, s = v.system || {};
        mount(vitalsCard, card('System Vitals', el('div.grid.grid-stat', {}, [
          stat((s.usedMemPct ?? '—') + '%', 'Memory used'),
          stat(p.rssMB != null ? p.rssMB + ' MB' : '—', 'Process RSS'),
          stat(p.heapUsedMB != null ? p.heapUsedMB + ' MB' : '—', 'Heap used'),
          stat(s.cpuCount ?? '—', 'CPU cores'),
          stat(s.loadAvg1m ?? '—', 'Load 1m'),
          stat(s.temperature || '—', 'Temp'),
          stat(s.disk ? (s.disk.usedPct || s.disk.used) : '—', 'Disk'),
          stat(p.uptimeMin != null ? p.uptimeMin + 'm' : '—', 'Uptime'),
          stat(p.nodeVersion || '—', 'Node'),
          stat(s.hostname || '—', 'Host'),
        ]), el('button.icon-btn', { text: '⟳', onclick: renderVitals })));
        if (Array.isArray(s.network) && s.network.length) {
          vitalsCard.querySelector('.card').appendChild(
            el('div.dim', { style: 'margin-top:10px;font-size:12px', text: 'Network: ' + s.network.map((n) => `${n.interface} ${n.ip}`).join(', ') }));
        }
      } catch (e) { mount(vitalsCard, card('System Vitals', errbox(e.message))); }
    };
    renderVitals();
    const timer = setInterval(renderVitals, 5000);

    // ── Tokens & cost ──
    asyncView(tokensCard, () => api.get('/api/tokens'), (t) => {
      const st = t.stats || {};
      const recent = t.recentUsage || [];
      return card('Token & Cost', [
        el('div.grid.grid-stat', {}, [
          stat(st.todayTurns ?? st.turns ?? 0, 'Turns today'),
          stat(fmtUsd(st.todayCost ?? st.totalCostUsd ?? 0), 'Cost today'),
          stat((st.totalInputTokens ?? 0).toLocaleString(), 'Input tokens'),
          stat((st.totalOutputTokens ?? 0).toLocaleString(), 'Output tokens'),
        ]),
        recent.length ? el('div.table-wrap', { style: 'margin-top:12px' }, [el('table', {}, [
          el('thead', {}, el('tr', {}, [el('th', { text: 'When' }), el('th', { text: 'Model' }), el('th', { text: 'In' }), el('th', { text: 'Out' }), el('th', { text: 'Cost' })])),
          el('tbody', {}, recent.slice(0, 12).map((r) => el('tr', {}, [
            el('td', { text: fmtTime(r.created_at) }),
            el('td', {}, [badge((r.model || '—').replace('claude-', ''))]),
            el('td', { text: (r.input_tokens ?? 0).toLocaleString() }),
            el('td', { text: (r.output_tokens ?? 0).toLocaleString() }),
            el('td', { text: fmtUsd(r.cost_usd) }),
          ]))),
        ])]) : null,
      ]);
    });

    // ── System update / downgrade ──
    const renderUpdate = async (branch) => {
      mount(updateCard, card('System Update', loading('Checking versions…')));
      try {
        const v = await api.get('/api/system/versions' + (branch ? `?branch=${encodeURIComponent(branch)}` : ''));
        const branchSel = el('select', { onchange: (e) => renderUpdate(e.target.value) },
          (v.branches || []).map((b) => el('option', { value: b, text: b, selected: b === v.requestedBranch })));
        const status = v.upToDate ? badge('up to date', 'ok')
          : v.isBranchSwitch ? badge('switch → ' + v.requestedBranch, 'warn')
          : badge(`${v.behindBy} behind`, 'warn');
        const body = [
          el('div.kv', {}, [
            el('dt', { text: 'Current' }), el('dd', { text: `${v.current} (${v.currentBranch})` }),
            el('dt', { text: 'Remote' }), el('dd', { text: `${v.remote || '—'} — ${v.remoteMessage || ''}` }),
            el('dt', { text: 'Status' }), el('dd', {}, [status, v.dirty ? badge(' dirty tree', 'err') : null]),
          ]),
          el('div.row', { style: 'margin-top:10px' }, [
            el('span.dim', { text: 'Branch:' }), branchSel,
            el('button.btn.btn-accent', {
              text: v.isBranchSwitch ? 'Switch & update' : 'Update', disabled: v.upToDate && !v.isBranchSwitch,
              onclick: () => confirmDialog(`Pull ${v.requestedBranch} and restart?`, async () => {
                await api.post('/api/system/upgrade', { branch: v.requestedBranch });
                toast('Update started — polling status…', 'warn');
                pollUpgrade();
              }, { danger: false, confirmText: 'Update' }),
            }),
          ]),
        ];
        if ((v.commits || []).length) {
          body.push(el('div.section-title', { text: 'Roll back to a commit' }));
          body.push(el('div.table-wrap', {}, [el('table', {}, [
            el('tbody', {}, v.commits.slice(0, 10).map((cm) => el('tr', {}, [
              el('td', {}, [badge(cm.hash)]),
              el('td', { text: cm.message }),
              el('td', { text: cm.date }),
              el('td', {}, [el('button.btn.btn-sm', {
                text: 'Downgrade',
                onclick: () => confirmDialog(`Check out ${cm.hash} and restart?`, async () => {
                  await api.post('/api/system/downgrade', { commit: cm.hash });
                  toast('Downgrade started', 'warn');
                }),
              })]),
            ]))),
          ])]));
        }
        mount(updateCard, card('System Update', body, el('button.icon-btn', { text: '⟳', onclick: () => renderUpdate(branch) })));
      } catch (e) { mount(updateCard, card('System Update', errbox(e.message))); }
    };
    const pollUpgrade = async () => {
      try {
        const s = await api.get('/api/system/upgrade/status');
        toast('Upgrade: ' + (s.message || s.status || 'running'), s.status === 'error' ? 'err' : '');
        if (s.status && !['done', 'error', 'idle'].includes(s.status)) setTimeout(pollUpgrade, 4000);
      } catch {}
    };
    renderUpdate();

    // ── Device controls ──
    mount(deviceCard, card('Device', el('div.btn-row', {}, [
      el('button.btn', { text: '↻ Restart service', onclick: () => confirmDialog('Restart the WildClaude service?', async () => {
        await api.post('/api/system/restart'); toast('Restart requested', 'warn');
      }) }),
      el('button.btn.btn-danger', { text: '⏻ Reboot device', onclick: () => confirmDialog('Reboot the whole device? This drops all connections.', async () => {
        await api.post('/api/system/reboot'); toast('Reboot requested', 'warn');
      }) }),
    ])));

    return () => clearInterval(timer);
  },
};
