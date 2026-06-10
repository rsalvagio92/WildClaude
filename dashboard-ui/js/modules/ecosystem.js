// Skills & MCP — manage installed skills, browse/discover new ones, manage MCP.
import { api } from '../api.js';
import {
  el, mount, clear, escapeHtml, stat, badge, card, empty, loading, errbox,
  modal, confirmDialog, toast, toastOk, toastErr, action, truncate, fmtBytes, fmtUsd,
} from '../ui.js';

export default {
  async mount(view) {
    const root = el('div');
    mount(view, root);

    const head = el('div.page-head', {}, [
      el('div', {}, [
        el('h3', { text: 'Skills & MCP' }),
        el('p.muted', { text: 'Manage your installed skills, browse new ones, and configure MCP servers.' }),
      ]),
    ]);

    const tabsBar = el('div.tabs');
    const body = el('div', { style: 'margin-top:14px' });
    mount(root, head, tabsBar, body);

    let active = 'skills';
    const tabDefs = [
      { id: 'skills', label: 'Installed', render: renderSkills },
      { id: 'browse', label: 'Browse', render: renderBrowse },
      { id: 'mcp', label: 'MCP Servers', render: renderMcp },
    ];

    const select = (id) => {
      active = id;
      clear(tabsBar);
      for (const t of tabDefs) {
        tabsBar.appendChild(el('button.tab' + (t.id === active ? '.active' : ''), {
          text: t.label, onclick: () => select(t.id),
        }));
      }
      const def = tabDefs.find((t) => t.id === active);
      def.render(body);
    };
    select('skills');
  },
};

// ── Skills tab ───────────────────────────────────────────────────────

function renderSkills(container) {
  const run = () => renderSkills(container);

  const newBtn = el('button.btn.btn-accent', { text: '+ New skill', onclick: () => openSkillCreate(run) });
  const refreshBtn = el('button.icon-btn', { text: '⟳', onclick: run });
  const toolbar = el('div.btn-row', { style: 'margin-bottom:12px' }, [newBtn, refreshBtn]);

  const listWrap = el('div');
  mount(container, toolbar, listWrap);
  mount(listWrap, loading('Loading skills…'));

  api.get('/api/skills').then(({ skills }) => {
    if (!skills || !skills.length) {
      mount(listWrap, empty('No skills yet. Create one to get started.'));
      return;
    }
    const cards = skills
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => skillCard(s, run));
    mount(listWrap, el('div.grid.grid-3', {}, cards));
  }).catch((e) => mount(listWrap, errbox(e.message)));
}

function skillCard(s, refresh) {
  const isUser = s.source === 'user';
  const actions = [
    el('button.btn.btn-sm', { text: isUser ? 'View / edit' : 'View', onclick: () => openSkillView(s.name, refresh) }),
  ];
  if (isUser) {
    actions.push(el('button.btn.btn-sm.btn-danger', {
      text: 'Delete',
      onclick: () => confirmDialog(`Delete skill "${s.name}"? This removes your user copy.`, () =>
        action(() => api.del('/api/skills/' + encodeURIComponent(s.name)), { ok: 'Skill deleted', refresh }), { danger: true, confirmText: 'Delete' }),
    }));
  }
  return el('div.card', {}, [
    el('div.row', {}, [
      el('h3', { text: s.name, style: 'margin:0' }),
      badge(isUser ? 'user' : 'built-in', isUser ? 'accent' : ''),
    ]),
    el('p.muted', { text: s.description ? truncate(s.description, 160) : 'No description.', style: 'margin:8px 0' }),
    el('div.btn-row', {}, actions),
  ]);
}

function openSkillView(name, refresh) {
  const m = modal({ title: 'Skill: ' + name, body: loading('Loading…'), wide: true });
  api.get('/api/skills/' + encodeURIComponent(name)).then(({ content }) => {
    const ta = el('textarea', { rows: 22, style: 'width:100%;font-family:monospace;font-size:12px', value: content || '' });
    const saveBtn = el('button.btn.btn-accent', {
      text: 'Save',
      onclick: async () => {
        const v = ta.value.trim();
        if (!v) { toastErr('Content cannot be empty'); return; }
        try {
          await api.put('/api/skills/' + encodeURIComponent(name), { content: ta.value });
          toastOk('Skill saved (user override)');
          m.close();
          refresh && refresh();
        } catch (e) { toastErr(e.message); }
      },
    });
    mount(m.box.querySelector('.modal-body'),
      el('p.muted', { text: 'Editing a built-in skill saves a user override that takes priority.' }),
      el('div.field', {}, [ta]));
    const foot = m.box.querySelector('.modal-foot') || (() => {
      const f = el('div.modal-foot'); m.box.appendChild(f); return f;
    })();
    mount(foot, el('button.btn', { text: 'Cancel', onclick: () => m.close() }), saveBtn);
  }).catch((e) => mount(m.box.querySelector('.modal-body'), errbox(e.message)));
}

function openSkillCreate(refresh) {
  const nameIn = el('input', { placeholder: 'my-skill', type: 'text' });
  const descIn = el('input', { placeholder: 'When this skill should activate', type: 'text' });
  const contentIn = el('textarea', { rows: 12, placeholder: 'Optional — leave blank to scaffold a template SKILL.md', style: 'width:100%;font-family:monospace;font-size:12px' });

  const m = modal({
    title: 'Create skill',
    body: [
      el('div.field', {}, [el('label', { text: 'Name' }), nameIn]),
      el('div.field', {}, [el('label', { text: 'Description' }), descIn]),
      el('div.field', {}, [el('label', { text: 'Content (optional)' }), contentIn]),
    ],
    footer: [
      el('button.btn', { text: 'Cancel', onclick: () => m.close() }),
      el('button.btn.btn-accent', {
        text: 'Create',
        onclick: async () => {
          const name = nameIn.value.trim();
          if (!name) { toastErr('Name is required'); return; }
          try {
            await api.post('/api/skills', { name, description: descIn.value.trim(), content: contentIn.value.trim() || undefined });
            toastOk('Skill created');
            m.close();
            refresh && refresh();
          } catch (e) { toastErr(e.message); }
        },
      }),
    ],
  });
}

// ── MCP tab ──────────────────────────────────────────────────────────

function renderMcp(container) {
  const run = () => renderMcp(container);
  const refreshBtn = el('button.icon-btn', { text: '⟳', onclick: run });
  const toolbar = el('div.btn-row', { style: 'margin-bottom:12px' }, [refreshBtn]);

  const wrap = el('div');
  mount(container, toolbar, wrap);
  mount(wrap, loading('Loading MCP servers…'));

  api.get('/api/mcp').then(({ installed, available }) => {
    const sections = [];

    // Installed
    sections.push(el('div.section-title', { text: `Installed (${(installed || []).length})` }));
    if (installed && installed.length) {
      sections.push(el('div.table-wrap', {}, [el('table', {}, [
        el('thead', {}, el('tr', {}, [el('th', { text: 'Server' }), el('th', { text: 'Command' }), el('th', { text: '' })])),
        el('tbody', {}, installed.map((srv) => el('tr', {}, [
          el('td', { text: srv.id }),
          el('td', {}, [el('code', { text: truncate(srv.command || '', 60) })]),
          el('td', {}, [el('button.btn.btn-sm.btn-danger', {
            text: 'Uninstall',
            onclick: () => confirmDialog(`Uninstall MCP server "${srv.id}"?`, () =>
              action(() => api.del('/api/mcp/' + encodeURIComponent(srv.id)), { ok: 'Uninstalled', refresh: run }), { danger: true, confirmText: 'Uninstall' }),
          })]),
        ]))),
      ])]));
    } else {
      sections.push(empty('No MCP servers installed yet.'));
    }

    // Available, grouped by category when present
    sections.push(el('div.section-title', { text: `Available (${(available || []).length})`, style: 'margin-top:18px' }));
    if (available && available.length) {
      const groups = new Map();
      for (const m of available) {
        const cat = m.category || 'Other';
        if (!groups.has(cat)) groups.set(cat, []);
        groups.get(cat).push(m);
      }
      const hasCategories = groups.size > 1 || !groups.has('Other');
      if (hasCategories) {
        for (const [cat, items] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
          sections.push(el('div.muted', { text: cat, style: 'margin:14px 0 6px;font-weight:600' }));
          sections.push(el('div.grid.grid-3', {}, items.map((m) => mcpCard(m, run))));
        }
      } else {
        sections.push(el('div.grid.grid-3', {}, available.map((m) => mcpCard(m, run))));
      }
    } else {
      sections.push(empty('Everything in the registry is already installed.'));
    }

    mount(wrap, ...sections);
  }).catch((e) => mount(wrap, errbox(e.message)));
}

function mcpCard(m, refresh) {
  const needsSecrets = Array.isArray(m.secrets) ? m.secrets.length > 0 : !!m.requiresSecrets;
  return el('div.card', {}, [
    el('div.row', {}, [
      el('h3', { text: m.name || m.id, style: 'margin:0' }),
      needsSecrets ? badge('needs secret', 'warn') : null,
    ]),
    el('p.muted', { text: m.description ? truncate(m.description, 150) : '', style: 'margin:8px 0' }),
    el('div.btn-row', {}, [el('button.btn.btn-sm.btn-accent', {
      text: 'Install',
      onclick: () => installMcp(m, refresh),
    })]),
  ]);
}

async function installMcp(m, refresh) {
  try {
    const res = await api.post('/api/mcp/' + encodeURIComponent(m.id) + '/install', {});
    if (res && res.installed) {
      const missing = res.missingSecrets || [];
      if (missing.length) {
        toast(`${res.name || m.id} installed, but needs secrets: ${missing.join(', ')}. Set them in Settings → Secrets, then re-install.`, 'warn', 6000);
      } else {
        toastOk(`${res.name || m.id} installed`);
      }
    } else {
      toastErr(`Could not install ${m.id} (not in registry).`);
    }
    refresh && refresh();
  } catch (e) {
    toastErr(e.message);
  }
}

// ── Browse tab (discover skills + token savings + budget) ─────────────

function renderBrowse(container) {
  const statsRow = el('div.grid.grid-2');
  const tokenCard = el('div');
  const budgetCard = el('div');
  mount(statsRow, tokenCard, budgetCard);
  const curated = el('div', { style: 'margin-top:14px' });
  const search = el('div', { style: 'margin-top:14px' });
  mount(container, statsRow, curated, search);
  renderTokenJuice(tokenCard);
  renderBudget(budgetCard);
  renderCurated(curated);
  renderSearch(search);
}

function renderTokenJuice(container) {
  mount(container, card('TokenJuice savings', loading('Loading…')));
  api.get('/api/tokenjuice').then((s) => {
    const ratioPct = Math.round((s.ratio || 0) * 100);
    mount(container, card('TokenJuice savings', [
      el('div.grid.grid-stat', {}, [
        stat(fmtBytes(s.bytesIn), 'Bytes in'),
        stat(fmtBytes(s.bytesOut), 'Bytes out'),
        stat((s.estTokensSaved || 0).toLocaleString(), 'Tokens saved'),
        stat(ratioPct + '%', 'Reduction'),
        stat(fmtUsd(s.dollarsSaved || 0), 'Est. saved'),
      ]),
    ], el('button.icon-btn', { text: '⟳', onclick: () => renderTokenJuice(container) })));
  }).catch((e) => mount(container, card('TokenJuice savings', errbox(e.message))));
}

function renderBudget(container) {
  mount(container, card('Monthly budget', loading('Loading…')));
  api.get('/api/budget').then((b) => {
    if (b && b.enabled === false) {
      mount(container, card('Monthly budget', [
        el('p.muted', { text: 'No budget cap set. Set MONTHLY_BUDGET_USD to enable alerts and auto-downgrade.' }),
        el('div.grid.grid-stat', {}, [
          stat(fmtUsd(b.spentUsd || 0), 'Spent (API)'),
          b.equivalentUsd != null ? stat(fmtUsd(b.equivalentUsd), 'Equivalent (sub)') : null,
        ]),
      ], el('button.icon-btn', { text: '⟳', onclick: () => renderBudget(container) })));
      return;
    }
    const ratioPct = Math.min(100, Math.round((b.ratio || 0) * 100));
    const barColor = ratioPct >= 100 ? 'var(--err, #e5484d)' : ratioPct >= 80 ? 'var(--warn, #f5a623)' : '';
    const bar = el('div.bar', { style: 'margin:10px 0' }, [
      el('span', { style: `width:${ratioPct}%` + (barColor ? `;background:${barColor}` : '') }),
    ]);
    mount(container, card('Monthly budget', [
      el('div.grid.grid-stat', {}, [
        stat(fmtUsd(b.spentUsd || 0), 'Spent (API)'),
        b.equivalentUsd != null ? stat(fmtUsd(b.equivalentUsd), 'Equivalent (sub)') : null,
        stat(fmtUsd(b.budgetUsd || 0), 'Budget'),
        stat(ratioPct + '%', 'Used'),
      ]),
      bar,
    ], el('button.icon-btn', { text: '⟳', onclick: () => renderBudget(container) })));
  }).catch((e) => mount(container, card('Monthly budget', errbox(e.message))));
}

function renderCurated(container) {
  mount(container, card('Curated picks', loading('Loading…')));
  api.get('/api/skill-marketplace/recommended').then(({ skills }) => {
    if (!skills || !skills.length) {
      mount(container, card('Curated picks', empty('No recommendations available.')));
      return;
    }
    mount(container, card('Curated picks', el('div.grid.grid-2', {}, skills.map((s) => curatedCard(s))),
      el('button.icon-btn', { text: '⟳', onclick: () => renderCurated(container) })));
  }).catch((e) => mount(container, card('Curated picks', errbox(e.message))));
}

function curatedCard(s) {
  const tags = (s.tags || (s.tag ? [s.tag] : [])).slice(0, 4);
  const installRef = s.install || (s.url ? '/skill_install ' + s.url : '');
  const nodes = [
    el('div.row', {}, [el('h3', { text: s.name, style: 'margin:0' }), ...tags.map((t) => badge(t, ''))]),
    el('p.muted', { text: s.description ? truncate(s.description, 200) : '', style: 'margin:8px 0' }),
  ];
  if (s.why) nodes.push(el('p', { text: truncate(s.why, 220), style: 'font-size:12px;opacity:.85' }));
  const btnRow = el('div.btn-row');
  if (installRef) btnRow.appendChild(el('button.btn.btn-sm.btn-accent', { text: 'Copy install command', onclick: () => copyText(installRef) }));
  if (s.url) btnRow.appendChild(el('a.btn.btn-sm.btn-ghost', { href: s.url, target: '_blank', rel: 'noopener', text: 'Source ↗' }));
  nodes.push(btnRow);
  if (installRef) nodes.push(el('pre.block', { text: installRef, style: 'margin-top:8px;font-size:11px;white-space:pre-wrap' }));
  return el('div.card', {}, nodes);
}

function renderSearch(container) {
  const input = el('input', { placeholder: 'Search agentskills.io…', type: 'text' });
  const results = el('div', { style: 'margin-top:12px' });
  const doSearch = async () => {
    const q = input.value.trim();
    mount(results, loading('Searching…'));
    try {
      const data = await api.get('/api/skill-marketplace?q=' + encodeURIComponent(q));
      if (data && data.error) { mount(results, el('div.errbox', { text: '⚠ Marketplace search unavailable: ' + data.error })); return; }
      const items = data.items || data.skills || [];
      if (!items.length) { mount(results, empty('No results. Try another query.')); return; }
      mount(results, el('div.grid.grid-2', {}, items.map((it) => searchResultCard(it))));
    } catch (e) { mount(results, errbox(e.message)); }
  };
  const searchBtn = el('button.btn.btn-accent', { text: 'Search', onclick: doSearch });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
  mount(container, card('Discover skills', [el('div.row', {}, [el('div.grow', {}, [input]), searchBtn]), results]));
}

function searchResultCard(it) {
  const name = it.name || it.title || it.id || 'skill';
  const ref = it.install || it.url || it.ref || it.id || '';
  const installCmd = ref ? (String(ref).startsWith('/skill_install') ? ref : '/skill_install ' + ref) : '';
  const nodes = [
    el('h3', { text: name, style: 'margin:0' }),
    el('p.muted', { text: it.description ? truncate(it.description, 180) : '', style: 'margin:8px 0' }),
  ];
  const btnRow = el('div.btn-row');
  if (installCmd) btnRow.appendChild(el('button.btn.btn-sm.btn-accent', { text: 'Copy install command', onclick: () => copyText(installCmd) }));
  if (it.url) btnRow.appendChild(el('a.btn.btn-sm.btn-ghost', { href: it.url, target: '_blank', rel: 'noopener', text: 'Open ↗' }));
  nodes.push(btnRow);
  if (installCmd) nodes.push(el('pre.block', { text: installCmd, style: 'margin-top:8px;font-size:11px;white-space:pre-wrap' }));
  return el('div.card', {}, nodes);
}

function copyText(text) {
  const done = () => toastOk('Copied to clipboard');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else { fallbackCopy(text, done); }
}

function fallbackCopy(text, done) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    done();
  } catch { toastErr('Copy failed — select the text manually.'); }
}
