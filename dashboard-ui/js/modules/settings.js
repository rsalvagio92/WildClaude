// Settings — tabbed: Identity, Personality, Secrets, Profile, Verbosity, Import, System Info.
import { api } from '../api.js';
import {
  el, mount, clear, asyncView, badge, card, stat, modal, confirmDialog,
  toast, toastOk, toastErr, action, loading, empty, errbox, escapeHtml,
} from '../ui.js';

const TABS = [
  { id: 'identity', label: 'Identity' },
  { id: 'personality', label: 'Personality' },
  { id: 'secrets', label: 'Secrets' },
  { id: 'profile', label: 'Profile' },
  { id: 'verbosity', label: 'Verbosity' },
  { id: 'import', label: 'Import' },
  { id: 'pairing', label: '📱 Mobile' },
  { id: 'info', label: 'System Info' },
];

const THEMES = ['purple', 'blue', 'green', 'amber', 'rose', 'dark'];

// small form-field helper
const field = (label, control) => el('div.field', {}, [el('label', { text: label }), control]);

export default {
  async mount(view) {
    const root = el('div');
    mount(view, root);

    const head = el('div.page-head', {}, [
      el('div', {}, [el('h3', { text: 'Settings' }), el('p.muted', { text: 'Identity, personality, secrets and system' })]),
    ]);
    const tabs = el('div.tabs');
    const body = el('div', { style: 'margin-top:14px' });
    mount(root, head, tabs, body);

    let active = 'identity';
    const renderTabs = () => {
      mount(tabs, TABS.map((t) =>
        el('button.tab' + (t.id === active ? '.active' : ''), {
          text: t.label,
          onclick: () => { active = t.id; renderTabs(); RENDERERS[active](body); },
        })));
    };

    const RENDERERS = {
      identity: renderIdentity,
      personality: renderPersonality,
      secrets: renderSecrets,
      profile: renderProfile,
      verbosity: renderVerbosity,
      import: renderImport,
      pairing: renderPairing,
      info: renderInfo,
    };

    renderTabs();
    RENDERERS[active](body);
  },
};

// ── Identity ───────────────────────────────────────────────────────────
function renderIdentity(container) {
  asyncView(container, () => api.get('/api/info'), (info) => {
    const name = el('input', { value: info.botName || '' });
    const emoji = el('input', { value: info.botEmoji || '', style: 'max-width:80px' });
    const tagline = el('input', { value: info.botTagline || '' });
    let theme = info.botTheme || 'purple';

    const themeRow = el('div.btn-row');
    const renderThemes = () => {
      mount(themeRow, THEMES.map((t) =>
        el('button.btn.btn-sm' + (t === theme ? '.btn-accent' : ''), {
          text: t,
          onclick: () => { theme = t; document.documentElement.dataset.theme = t; renderThemes(); },
        })));
    };
    renderThemes();

    const save = el('button.btn.btn-accent', {
      text: 'Save',
      onclick: () => action(
        () => api.put('/api/config', { botIdentity: { name: name.value.trim(), emoji: emoji.value.trim(), tagline: tagline.value.trim(), theme } }),
        { ok: 'Identity saved' }),
    });

    return card('Bot Identity', [
      field('Name', name),
      field('Emoji', emoji),
      field('Tagline', tagline),
      field('Theme (click to preview)', themeRow),
      el('div.btn-row', { style: 'margin-top:12px' }, [save]),
    ]);
  });
}

// ── Personality ────────────────────────────────────────────────────────
function renderPersonality(container) {
  asyncView(container, async () => {
    const [config, presetsRes] = await Promise.all([
      api.get('/api/personality'),
      api.get('/api/personality/presets'),
    ]);
    return { config, presets: presetsRes.presets || [] };
  }, ({ config, presets }, rerun) => {
    // form controls
    const presetSel = el('select');
    presets.forEach((p) => presetSel.appendChild(el('option', { value: p.id, text: p.name })));
    if (config.preset) presetSel.value = config.preset;

    const tone = selectFrom(['direct', 'friendly', 'formal', 'casual', 'warm'], config.tone || 'direct');
    const length = selectFrom(['brief', 'balanced', 'detailed'], config.responseLength || 'balanced');
    const language = selectFrom(['auto', 'en', 'it', 'es', 'de', 'fr', 'pt'], config.language || 'auto');
    const pushback = selectFrom(['gentle', 'normal', 'assertive'], config.pushback || 'normal');
    const humor = el('input', { type: 'range', min: 0, max: 10, value: config.humor ?? 2 });
    const humorVal = el('span.dim', { text: String(config.humor ?? 2) });
    humor.addEventListener('input', () => { humorVal.textContent = humor.value; });
    const emoji = el('input', { type: 'checkbox', checked: !!config.emoji });
    const customPrompt = el('textarea', { rows: 4, value: config.customPrompt || '' });

    presetSel.addEventListener('change', () => {
      const p = presets.find((x) => x.id === presetSel.value);
      if (!p) return;
      const c = p.config || {};
      tone.value = c.tone || 'direct';
      length.value = c.responseLength || 'balanced';
      language.value = c.language || 'auto';
      pushback.value = c.pushback || 'normal';
      humor.value = c.humor ?? 2; humorVal.textContent = String(c.humor ?? 2);
      emoji.checked = !!c.emoji;
      customPrompt.value = c.customPrompt || '';
    });

    const collect = () => ({
      preset: presetSel.value,
      tone: tone.value,
      responseLength: length.value,
      language: language.value,
      pushback: pushback.value,
      humor: Number(humor.value),
      emoji: emoji.checked,
      customPrompt: customPrompt.value,
    });

    const preview = el('button.btn', {
      text: 'Preview',
      onclick: async () => {
        try {
          const { text } = await api.post('/api/personality/preview', collect());
          modal({ title: 'Generated prompt', wide: true, body: el('pre.block', { text: text || '(empty)' }) });
        } catch (e) { toastErr(e.message); }
      },
    });
    const saveBtn = el('button.btn', { text: 'Save', onclick: () => action(() => api.put('/api/personality', collect()), { ok: 'Saved' }) });
    const applyBtn = el('button.btn.btn-accent', { text: 'Apply', onclick: () => action(() => api.post('/api/personality/apply', collect()), { ok: 'Active on next message' }) });

    // save-as-preset
    const newId = el('input', { placeholder: 'preset-id' });
    const newName = el('input', { placeholder: 'Name' });
    const newDesc = el('input', { placeholder: 'Description' });
    const savePreset = el('button.btn.btn-sm', {
      text: 'Save as preset',
      onclick: () => {
        const id = newId.value.trim();
        if (!id || !newName.value.trim()) { toastErr('id and name required'); return; }
        action(() => api.post('/api/personality/presets', { id, name: newName.value.trim(), description: newDesc.value.trim(), config: collect() }),
          { ok: 'Preset saved', refresh: rerun });
      },
    });

    // delete preset (user only)
    const selected = presets.find((p) => p.id === presetSel.value);
    const delBtn = el('button.btn.btn-sm.btn-danger', {
      text: 'Delete preset',
      disabled: !selected || selected.source === 'built-in',
      onclick: () => confirmDialog(`Delete preset "${presetSel.value}"?`, () =>
        action(() => api.del('/api/personality/presets/' + encodeURIComponent(presetSel.value)), { ok: 'Deleted', refresh: rerun })),
    });

    return [
      card('Personality', [
        field('Preset', presetSel),
        el('div.grid.grid-2', {}, [field('Tone', tone), field('Response length', length)]),
        el('div.grid.grid-2', {}, [field('Language', language), field('Pushback', pushback)]),
        field('Humor (0-10)', el('div.row', {}, [humor, humorVal])),
        field('Emoji', el('div.row', {}, [emoji, el('span.dim', { text: 'allow emoji in replies' })])),
        field('Custom prompt', customPrompt),
        el('div.btn-row', { style: 'margin-top:12px' }, [preview, saveBtn, applyBtn]),
      ]),
      card('Save / manage presets', [
        el('div.grid.grid-3', {}, [field('ID', newId), field('Name', newName), field('Description', newDesc)]),
        el('div.btn-row', { style: 'margin-top:10px' }, [savePreset, delBtn]),
      ]),
    ];
  });
}

function selectFrom(values, current) {
  const sel = el('select');
  values.forEach((v) => sel.appendChild(el('option', { value: v, text: v })));
  sel.value = current;
  return sel;
}

// ── Secrets ────────────────────────────────────────────────────────────
function renderSecrets(container) {
  const view = asyncView(container, () => api.get('/api/secrets'), (data) => {
    const secrets = data.secrets || [];

    const setModal = (key, isNew) => {
      const keyInput = el('input', { value: key || '', placeholder: 'SECRET_KEY' });
      if (!isNew) keyInput.readOnly = true;
      const valInput = el('input', { type: 'password', placeholder: 'value' });
      const m = modal({
        title: isNew ? 'Add secret' : 'Set ' + key,
        body: [isNew ? field('Key', keyInput) : null, field('Value', valInput)],
        footer: [
          el('button.btn', { text: 'Cancel', onclick: () => m.close() }),
          el('button.btn.btn-accent', {
            text: 'Save',
            onclick: () => {
              const k = (isNew ? keyInput.value.trim() : key);
              if (!k || !valInput.value) { toastErr('key and value required'); return; }
              m.close();
              action(() => api.post('/api/secrets/' + encodeURIComponent(k), { value: valInput.value }), { ok: 'Saved', refresh: view });
            },
          }),
        ],
      });
    };

    const addBtn = el('button.btn.btn-sm.btn-accent', { text: '+ Add secret', onclick: () => setModal('', true) });

    if (!secrets.length) {
      return card('Secrets', [empty('No secrets configured'), el('div.btn-row', { style: 'margin-top:10px' }, [addBtn])]);
    }

    const rows = secrets.map((s) => el('tr', {}, [
      el('td', { text: s.key }),
      el('td', {}, [s.set ? badge('set', 'ok') : badge('missing', 'warn')]),
      el('td', {}, [
        el('button.btn.btn-sm', { text: 'Set', onclick: () => setModal(s.key, false) }),
        el('button.btn.btn-sm.btn-danger', {
          text: 'Delete', disabled: !s.set,
          onclick: () => confirmDialog(`Delete secret ${s.key}?`, () =>
            action(() => api.del('/api/secrets/' + encodeURIComponent(s.key)), { ok: 'Deleted', refresh: view })),
        }),
      ]),
    ]));

    return card('Secrets',
      [
        el('div.table-wrap', {}, [el('table', {}, [
          el('thead', {}, el('tr', {}, [el('th', { text: 'Key' }), el('th', { text: 'Status' }), el('th', { text: 'Actions' })])),
          el('tbody', {}, rows),
        ])]),
      ],
      addBtn);
  });
}

// ── Profile ────────────────────────────────────────────────────────────
const PROFILE_DOMAINS = ['me', 'goals', 'health', 'finance', 'learning'];
function renderProfile(container) {
  asyncView(container, () => api.get('/api/profile'), (data) => {
    const profile = data.profile || {};
    let domain = 'me';
    const domainTabs = el('div.tabs');
    const editor = el('textarea', { rows: 16, style: 'width:100%' });

    const load = () => { editor.value = profile[domain] || ''; };
    const renderDomains = () => {
      mount(domainTabs, PROFILE_DOMAINS.map((d) =>
        el('button.tab' + (d === domain ? '.active' : ''), {
          text: d, onclick: () => { domain = d; renderDomains(); load(); },
        })));
    };
    renderDomains();
    load();

    const save = el('button.btn.btn-accent', {
      text: 'Save',
      onclick: () => {
        const content = editor.value;
        action(() => api.put('/api/profile/' + encodeURIComponent(domain), { content }), { ok: domain + ' saved' })
          .then(() => { profile[domain] = content; });
      },
    });

    // Life log: chat-derived + manual entries (newest first)
    const logHost = el('div');
    const loadLog = () => {
      asyncView(logHost, () => api.get('/api/life/log'), (d) => {
        const content = (d.content || '').trim();
        return content
          ? el('pre.block', { text: content.slice(0, 8000) })
          : empty('No life log entries yet');
      });
    };
    loadLog();
    const entryInput = el('textarea', { rows: 2, style: 'width:100%', placeholder: 'Add a note to the life log…' });
    const addEntry = el('button.btn', {
      text: 'Add entry',
      onclick: () => {
        const entry = entryInput.value.trim();
        if (!entry) return;
        action(() => api.post('/api/life/log', { entry }), { ok: 'Entry added' })
          .then(() => { entryInput.value = ''; loadLog(); });
      },
    });

    return el('div', {}, [
      card('Life Profile', [
        domainTabs,
        el('div.field', { style: 'margin-top:10px' }, [editor]),
        el('div.btn-row', { style: 'margin-top:10px' }, [save]),
      ]),
      card('Life Log', [
        el('div.field', {}, [entryInput]),
        el('div.btn-row', { style: 'margin-bottom:10px' }, [addEntry]),
        logHost,
      ]),
    ]);
  });
}

// ── Verbosity ──────────────────────────────────────────────────────────
const VERBOSITY_FLAGS = [
  ['showTools', 'Show tool activity (reading file, running command)'],
  ['showSubAgents', 'Show sub-agent start/complete'],
  ['showRouting', 'Show routing decision (model + latency)'],
  ['showMemory', 'Show new-memory notifications'],
  ['showProgress', 'Show progress updates during long tasks'],
];
function renderVerbosity(container) {
  asyncView(container, () => api.get('/api/verbosity'), (cfg) => {
    const level = selectFrom(['minimal', 'normal', 'detailed', 'debug'], cfg.level || 'normal');
    const checks = {};
    const checkRows = VERBOSITY_FLAGS.map(([key, label]) => {
      const cb = el('input', { type: 'checkbox', checked: !!cfg[key] });
      checks[key] = cb;
      return el('label.row', { style: 'cursor:pointer;gap:8px' }, [cb, el('span', { text: label })]);
    });

    const save = el('button.btn.btn-accent', {
      text: 'Save',
      onclick: () => {
        const out = { level: level.value };
        for (const [key] of VERBOSITY_FLAGS) out[key] = checks[key].checked;
        action(() => api.put('/api/verbosity', out), { ok: 'Saved' });
      },
    });

    return card('Verbosity', [
      field('Level', level),
      el('div.field', {}, [el('label', { text: 'Detail toggles' }), el('div', { style: 'display:flex;flex-direction:column;gap:6px' }, checkRows)]),
      el('div.btn-row', { style: 'margin-top:12px' }, [save]),
    ]);
  });
}

// ── Import ─────────────────────────────────────────────────────────────
function renderImport(container) {
  const view = asyncView(container, () => api.get('/api/import/sources'), (data) => {
    const sources = data.sources || [];

    const importAll = el('button.btn.btn-accent', {
      text: 'Import all detected',
      disabled: !sources.length,
      onclick: () => confirmDialog('Import all detected sources?', async () => {
        try {
          const r = await api.post('/api/import/auto', {});
          toastOk(`Imported ${r.totalMemories ?? 0} memories, ${r.totalFiles ?? 0} files`);
        } catch (e) { toastErr(e.message); }
      }, { danger: false, confirmText: 'Import' }),
    });

    const sourceList = sources.length
      ? el('div', {}, sources.map((s) => el('div.row', { style: 'padding:4px 0' }, [
          el('div.grow', { text: typeof s === 'string' ? s : (s.name || s.type || s.path || JSON.stringify(s)) }),
          (s && s.path) ? el('span.dim', { text: s.path, style: 'font-size:12px' }) : null,
        ])))
      : empty('No importable sources detected');

    // import specific file
    const pathInput = el('input', { placeholder: '/path/to/export.db|.json|.md', style: 'flex:1' });
    const typeInput = el('input', { placeholder: 'type (optional)', style: 'max-width:160px' });
    const fileBtn = el('button.btn', {
      text: 'Import file',
      onclick: async () => {
        const p = pathInput.value.trim();
        if (!p) { toastErr('path required'); return; }
        try {
          const r = await api.post('/api/import/file', { path: p, type: typeInput.value.trim() || undefined });
          toastOk(`Imported ${r.memoriesImported ?? 0} memories, ${r.filesImported ?? 0} files`);
        } catch (e) { toastErr(e.message); }
      },
    });

    return [
      card('Detected sources', [sourceList, el('div.btn-row', { style: 'margin-top:10px' }, [importAll, el('button.btn.btn-sm.btn-ghost', { text: 'Rescan', onclick: view })])]),
      card('Import a specific file', [
        el('div.row', {}, [el('div.grow', {}, [pathInput]), typeInput, fileBtn]),
      ]),
    ];
  });
}

// ── System Info ────────────────────────────────────────────────────────
// ── Mobile pairing ───────────────────────────────────────────────────────
function renderPairing(container) {
  let selectedUrl = null; // chosen address; null = let the server pick the best
  asyncView(container, async () => {
    const qs = selectedUrl ? '?url=' + encodeURIComponent(selectedUrl) : '';
    return api.get('/api/pairing' + qs);
  }, (data, rerun) => {
    selectedUrl = data.url;

    const copyBtn = (label, text) => el('button.btn.btn-sm', {
      text: 'Copia',
      onclick: async () => {
        try { await navigator.clipboard.writeText(text); toastOk(label + ' copiato'); }
        catch { toastErr('Copia non riuscita'); }
      },
    });
    const codeRow = (label, text) => el('div.field', {}, [
      el('label', { text: label }),
      el('div.row', { style: 'gap:8px;align-items:center' }, [
        el('code', { text, style: 'flex:1;overflow:auto;white-space:nowrap;padding:6px 8px;background:var(--surface,#16161f);border-radius:8px' }),
        copyBtn(label, text),
      ]),
    ]);

    const qr = el('div', {
      style: 'background:#fff;padding:12px;border-radius:12px;width:max-content;max-width:100%;margin:8px auto',
      html: data.qrSvg,
    });

    const addr = (data.candidates && data.candidates.length > 1)
      ? field('Indirizzo server', el('select.input', {
          onchange: (e) => { selectedUrl = e.target.value; rerun(); },
        }, data.candidates.map((u) => el('option', { value: u, text: u, selected: u === data.url }))))
      : codeRow('Indirizzo server', data.url);

    const isHttp = String(data.url || '').startsWith('http://');

    return card('📱 Accoppia l\'app mobile', [
      el('p.muted', { text: 'Apri WildClaude sul telefono → Connetti un server → inquadra questo QR. In alternativa, copia URL e token per l\'inserimento manuale.' }),
      qr,
      addr,
      codeRow('Token', data.token),
      codeRow('Deep link', data.deepLink),
      isHttp
        ? el('p.muted', { style: 'margin-top:10px', text: '⚠️ Connessione HTTP in chiaro: l\'APK release la accetta solo con cleartext abilitato (già attivo in questa build). Per il microfono/voce serve HTTPS.' })
        : el('p.muted', { style: 'margin-top:10px', text: 'ℹ️ HTTPS self-signed: l\'app potrebbe rifiutare il certificato finché il cert pinning non è attivo. Usa un cert valido (Tailscale/reverse proxy) se la connessione fallisce.' }),
    ], el('button.icon-btn', { text: '⟳', onclick: rerun }));
  });
}

function renderInfo(container) {
  asyncView(container, async () => {
    const [info, health] = await Promise.all([api.get('/api/info'), api.get('/api/health')]);
    return { info, health };
  }, ({ info, health }, rerun) => {
    const conn = (label, ok) => el('div.row', { style: 'gap:8px' }, [el('span.dim', { text: label }), ok ? badge('connected', 'ok') : badge('off', '')]);
    return card('System Info', [
      el('div.grid.grid-stat', {}, [
        stat(info.botName || '—', 'Bot name'),
        stat(info.botUsername ? '@' + info.botUsername : '—', 'Username'),
        stat(info.pid ?? '—', 'PID'),
        stat(info.agentId || '—', 'Agent ID'),
        stat((health.model || '—').replace('claude-', ''), 'Model'),
        stat((health.contextPct ?? 0) + '%', 'Context used'),
        stat(health.turns ?? 0, 'Turns'),
        stat(health.sessionAge || '—', 'Session age'),
      ]),
      el('div.row', { style: 'margin-top:12px;gap:16px;flex-wrap:wrap' }, [
        conn('Telegram', health.telegramConnected),
        conn('WhatsApp', health.waConnected),
        conn('Slack', health.slackConnected),
      ]),
    ], el('button.icon-btn', { text: '⟳', onclick: rerun }));
  });
}
