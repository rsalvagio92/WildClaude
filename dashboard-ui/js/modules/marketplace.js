// Skill Marketplace — TokenJuice savings, curated picks, live agentskills.io search, budget gauge.
import { api } from '../api.js';
import {
  el, mount, clear, escapeHtml, stat, badge, card, empty, loading, errbox,
  toast, toastOk, toastErr, fmtBytes, fmtUsd, truncate,
} from '../ui.js';

export default {
  async mount(view) {
    const root = el('div');
    mount(view, root);

    const head = el('div.page-head', {}, [
      el('div', {}, [
        el('h3', { text: 'Skill Marketplace' }),
        el('p.muted', { text: 'Discover skills, track token savings, watch your budget.' }),
      ]),
    ]);

    const statsRow = el('div.grid-2');
    const tokenCard = el('div');
    const budgetCard = el('div');
    mount(statsRow, tokenCard, budgetCard);

    const curatedCard = el('div', { style: 'margin-top:14px' });
    const searchCard = el('div', { style: 'margin-top:14px' });

    mount(root, head, statsRow, curatedCard, searchCard);

    renderTokenJuice(tokenCard);
    renderBudget(budgetCard);
    renderCurated(curatedCard);
    renderSearch(searchCard);
  },
};

// ── TokenJuice savings ───────────────────────────────────────────────

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

// ── Budget gauge ─────────────────────────────────────────────────────

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

// ── Curated picks ────────────────────────────────────────────────────

function renderCurated(container) {
  mount(container, card('Curated picks', loading('Loading…')));
  api.get('/api/skill-marketplace/recommended').then(({ skills }) => {
    if (!skills || !skills.length) {
      mount(container, card('Curated picks', empty('No recommendations available.')));
      return;
    }
    const cards = skills.map((s) => curatedCard(s));
    mount(container, card('Curated picks', el('div.grid.grid-2', {}, cards),
      el('button.icon-btn', { text: '⟳', onclick: () => renderCurated(container) })));
  }).catch((e) => mount(container, card('Curated picks', errbox(e.message))));
}

function curatedCard(s) {
  const tags = (s.tags || (s.tag ? [s.tag] : [])).slice(0, 4);
  const installRef = s.install || (s.url ? '/skill_install ' + s.url : '');
  const nodes = [
    el('div.row', {}, [
      el('h3', { text: s.name, style: 'margin:0' }),
      ...tags.map((t) => badge(t, '')),
    ]),
    el('p.muted', { text: s.description ? truncate(s.description, 200) : '', style: 'margin:8px 0' }),
  ];
  if (s.why) nodes.push(el('p', { text: truncate(s.why, 220), style: 'font-size:12px;opacity:.85' }));

  const btnRow = el('div.btn-row');
  if (installRef) {
    btnRow.appendChild(el('button.btn.btn-sm.btn-accent', {
      text: 'Copy install command',
      onclick: () => copyText(installRef),
    }));
  }
  if (s.url) {
    btnRow.appendChild(el('a.btn.btn-sm.btn-ghost', { href: s.url, target: '_blank', rel: 'noopener', text: 'Source ↗' }));
  }
  nodes.push(btnRow);
  if (installRef) {
    nodes.push(el('pre.block', { text: installRef, style: 'margin-top:8px;font-size:11px;white-space:pre-wrap' }));
  }
  return el('div.card', {}, nodes);
}

// ── Live search (agentskills.io proxy) ───────────────────────────────

function renderSearch(container) {
  const input = el('input', { placeholder: 'Search agentskills.io…', type: 'text' });
  const results = el('div', { style: 'margin-top:12px' });

  const doSearch = async () => {
    const q = input.value.trim();
    mount(results, loading('Searching…'));
    try {
      const data = await api.get('/api/skill-marketplace?q=' + encodeURIComponent(q));
      if (data && data.error) {
        mount(results, el('div.errbox', { text: '⚠ Marketplace search unavailable: ' + data.error }));
        return;
      }
      const items = data.items || data.skills || [];
      if (!items.length) {
        mount(results, empty('No results. Try another query.'));
        return;
      }
      mount(results, el('div.grid.grid-2', {}, items.map((it) => searchResultCard(it))));
    } catch (e) {
      mount(results, errbox(e.message));
    }
  };

  const searchBtn = el('button.btn.btn-accent', { text: 'Search', onclick: doSearch });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });

  mount(container, card('Search skills', [
    el('div.row', {}, [el('div.grow', {}, [input]), searchBtn]),
    results,
  ]));
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
  if (installCmd) {
    btnRow.appendChild(el('button.btn.btn-sm.btn-accent', { text: 'Copy install command', onclick: () => copyText(installCmd) }));
  }
  if (it.url) {
    btnRow.appendChild(el('a.btn.btn-sm.btn-ghost', { href: it.url, target: '_blank', rel: 'noopener', text: 'Open ↗' }));
  }
  nodes.push(btnRow);
  if (installCmd) nodes.push(el('pre.block', { text: installCmd, style: 'margin-top:8px;font-size:11px;white-space:pre-wrap' }));
  return el('div.card', {}, nodes);
}

// ── Clipboard ────────────────────────────────────────────────────────

function copyText(text) {
  const done = () => toastOk('Copied to clipboard');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}

function fallbackCopy(text, done) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    done();
  } catch {
    toastErr('Copy failed — select the text manually.');
  }
}
