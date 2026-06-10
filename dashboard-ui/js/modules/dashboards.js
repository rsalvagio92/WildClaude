// External Dashboards — connect to Vercel/Neon/Stripe/etc. + user-defined services.
import { api } from '../api.js';
import {
  el, mount, clear, escapeHtml, badge, card, empty, loading, errbox,
  modal, confirmDialog, toast, toastOk, toastErr, action, fmtTime, truncate,
} from '../ui.js';

export default {
  async mount(view) {
    const root = el('div');
    mount(view, root);
    renderAll(root);
  },
};

function renderAll(root) {
  const run = () => renderAll(root);

  const head = el('div.page-head', {}, [
    el('div', {}, [
      el('h3', { text: 'External Dashboards' }),
      el('p.muted', { text: 'Connect external service APIs and query them in one place.' }),
    ]),
    el('div.btn-row', {}, [
      el('button.btn.btn-accent', { text: '+ Add service', onclick: () => openAddService(run) }),
      el('button.icon-btn', { text: '⟳', onclick: run }),
    ]),
  ]);

  const grid = el('div.grid.grid-3');
  const detail = el('div', { style: 'margin-top:14px' });
  mount(root, head, grid, detail);
  mount(grid, loading('Loading services…'));

  api.get('/api/dashboards').then(({ services }) => {
    if (!services || !services.length) {
      mount(grid, empty('No services configured. Add one to get started.'));
      return;
    }
    mount(grid, ...services.map((s) => serviceCard(s, detail, run)));
  }).catch((e) => mount(grid, errbox(e.message)));
}

function serviceCard(s, detail, refresh) {
  const configured = !!s.configured;
  const isBuiltIn = s.source === 'built-in';

  const head = el('div.row', {}, [
    s.icon ? el('span', { html: looksLikeEntity(s.icon) ? s.icon : escapeHtml(s.icon), style: 'font-size:18px' }) : null,
    el('h3', { text: s.name || s.id, style: 'margin:0' }),
    configured ? badge('configured', 'ok') : badge('needs API key', 'warn'),
  ]);

  const btnRow = el('div.btn-row', { style: 'margin-top:10px' });
  if (configured) {
    btnRow.appendChild(el('button.btn.btn-sm.btn-accent', {
      text: 'Open',
      onclick: () => openService(s, detail),
    }));
  } else {
    btnRow.appendChild(el('span.muted', { text: `Set ${s.secretKey || 'its API key'} in Settings → Secrets`, style: 'font-size:12px' }));
  }
  if (!isBuiltIn) {
    btnRow.appendChild(el('button.btn.btn-sm.btn-danger', {
      text: 'Delete',
      onclick: () => confirmDialog(`Delete custom service "${s.name || s.id}"?`, () =>
        action(() => api.del('/api/dashboards/' + encodeURIComponent(s.id)), { ok: 'Service deleted', refresh }), { danger: true, confirmText: 'Delete' }),
    }));
  }

  return el('div.card', {}, [head, btnRow]);
}

function looksLikeEntity(s) {
  return /^&#?\w+;$/.test(String(s).trim());
}

// ── Service detail / endpoint browser ────────────────────────────────

function openService(s, detail) {
  const out = el('div', { style: 'margin-top:12px' });
  const endpoints = Array.isArray(s.endpoints) ? s.endpoints : [];

  const btnRow = el('div.btn-row');
  if (s.id === 'vercel') {
    btnRow.appendChild(el('button.btn.btn-sm.btn-accent', {
      text: 'Deployments', onclick: () => loadVercelDeployments(out),
    }));
  }
  for (const ep of endpoints) {
    btnRow.appendChild(el('button.btn.btn-sm', {
      text: ep.name || ep.id,
      onclick: () => loadEndpoint(s.id, ep.id, out),
    }));
  }
  if (!btnRow.children.length) {
    btnRow.appendChild(el('span.muted', { text: 'No endpoints defined for this service.' }));
  }

  mount(detail, card(s.name || s.id, [
    el('p.muted', { text: 'Pick an endpoint to query.' }),
    btnRow,
    out,
  ], el('button.icon-btn', { text: '✕', onclick: () => clear(detail) })));
}

function loadEndpoint(serviceId, endpointId, out) {
  mount(out, loading('Fetching…'));
  api.get('/api/dashboards/' + encodeURIComponent(serviceId) + '/' + encodeURIComponent(endpointId))
    .then(({ data }) => mount(out, renderData(data)))
    .catch((e) => mount(out, errbox(e.message)));
}

function renderData(data) {
  if (data == null) return empty('No data returned.');
  // Render arrays of flat objects as a table.
  if (Array.isArray(data) && data.length && typeof data[0] === 'object' && data[0] !== null) {
    return objectArrayTable(data);
  }
  return el('pre.block', { text: safeStringify(data), style: 'max-height:480px;overflow:auto' });
}

function objectArrayTable(rows) {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].slice(0, 8);
  return el('div.table-wrap', {}, [el('table', {}, [
    el('thead', {}, el('tr', {}, cols.map((c) => el('th', { text: c })))),
    el('tbody', {}, rows.slice(0, 50).map((r) => el('tr', {}, cols.map((c) => {
      const v = r[c];
      const text = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
      return el('td', { text: truncate(text, 80) });
    })))),
  ])]);
}

function safeStringify(data) {
  try { return JSON.stringify(data, null, 2); }
  catch { return String(data); }
}

// ── Vercel special-case ──────────────────────────────────────────────

function loadVercelDeployments(out) {
  mount(out, loading('Loading deployments…'));
  // The richer /vercel/deployments route requires a projectId. The generic
  // endpoint route lists recent deployments without one, so use that.
  api.get('/api/dashboards/vercel/deployments')
    .then(({ data }) => renderVercelDeployments(data, out))
    .catch((e) => mount(out, errbox(e.message + ' — the recent-deployments view needs a projectId; pick a project endpoint instead.')));
}

function renderVercelDeployments(data, out) {
  const deployments = (data && (data.deployments || data)) || [];
  const list = Array.isArray(deployments) ? deployments : [];
  if (!list.length) { mount(out, empty('No deployments found.')); return; }
  const rows = list.slice(0, 20).map((d) => el('tr', {}, [
    el('td', { text: d.name || d.uid || d.id || '—' }),
    el('td', {}, [badge(d.state || d.readyState || '—', (d.state || d.readyState) === 'READY' ? 'ok' : 'warn')]),
    el('td', { text: d.url ? truncate(d.url, 40) : '—' }),
    el('td', { text: d.created ? fmtTime(d.created) : '—' }),
    el('td', {}, [el('button.btn.btn-sm', {
      text: 'Logs',
      onclick: () => loadVercelLogs(d.uid || d.id, out),
    })]),
  ]));
  mount(out, el('div.table-wrap', {}, [el('table', {}, [
    el('thead', {}, el('tr', {}, [el('th', { text: 'Name' }), el('th', { text: 'State' }), el('th', { text: 'URL' }), el('th', { text: 'Created' }), el('th', { text: '' })])),
    el('tbody', {}, rows),
  ])]));
}

function loadVercelLogs(deploymentId, out) {
  if (!deploymentId) { toastErr('No deployment id'); return; }
  const m = modal({ title: 'Deployment logs', body: loading('Fetching logs…'), wide: true });
  api.get('/api/dashboards/vercel/deployment/' + encodeURIComponent(deploymentId) + '/logs')
    .then(({ data }) => {
      const lines = Array.isArray(data) ? data : [];
      const body = lines.length
        ? el('pre.block', { text: lines.map((l) => (l.text != null ? l.text : JSON.stringify(l))).join('\n'), style: 'max-height:60vh;overflow:auto;font-size:12px' })
        : empty('No log lines.');
      mount(m.box.querySelector('.modal-body'), body);
    })
    .catch((e) => mount(m.box.querySelector('.modal-body'), errbox(e.message)));
}

// ── Add custom service ───────────────────────────────────────────────

function openAddService(refresh) {
  const idIn = el('input', { placeholder: 'my-api', type: 'text' });
  const nameIn = el('input', { placeholder: 'My API', type: 'text' });
  const iconIn = el('input', { placeholder: '🔌 (emoji or HTML entity)', type: 'text' });
  const baseUrlIn = el('input', { placeholder: 'https://api.example.com', type: 'text' });
  const secretIn = el('input', { placeholder: 'MY_API_KEY', type: 'text' });
  const authSel = el('select', {}, [
    el('option', { value: 'Bearer', text: 'Bearer (Authorization: Bearer <token>)' }),
    el('option', { value: 'token', text: 'token (Authorization: token <token>)' }),
    el('option', { value: 'Basic', text: 'Basic (base64)' }),
  ]);
  const endpointsIn = el('textarea', {
    rows: 8,
    style: 'width:100%;font-family:monospace;font-size:12px',
    placeholder: '[\n  { "id": "list", "name": "List items", "path": "/v1/items" }\n]',
  });

  const m = modal({
    title: 'Add custom service',
    wide: true,
    body: [
      el('div.field', {}, [el('label', { text: 'ID (slug)' }), idIn]),
      el('div.field', {}, [el('label', { text: 'Name' }), nameIn]),
      el('div.field', {}, [el('label', { text: 'Icon (optional)' }), iconIn]),
      el('div.field', {}, [el('label', { text: 'Base URL' }), baseUrlIn]),
      el('div.field', {}, [el('label', { text: 'Secret key (stored in Secrets)' }), secretIn]),
      el('div.field', {}, [el('label', { text: 'Auth header' }), authSel]),
      el('div.field', {}, [el('label', { text: 'Endpoints (JSON array)' }), endpointsIn]),
    ],
    footer: [
      el('button.btn', { text: 'Cancel', onclick: () => m.close() }),
      el('button.btn.btn-accent', {
        text: 'Add service',
        onclick: async () => {
          const id = idIn.value.trim();
          const name = nameIn.value.trim();
          const baseUrl = baseUrlIn.value.trim();
          if (!id || !name || !baseUrl) { toastErr('id, name and baseUrl are required'); return; }
          let endpoints = [];
          const raw = endpointsIn.value.trim();
          if (raw) {
            try {
              endpoints = JSON.parse(raw);
              if (!Array.isArray(endpoints)) throw new Error('must be an array');
            } catch (err) { toastErr('Endpoints must be a valid JSON array: ' + err.message); return; }
          }
          try {
            await api.post('/api/dashboards', {
              id, name,
              icon: iconIn.value.trim() || undefined,
              secretKey: secretIn.value.trim() || undefined,
              baseUrl,
              authHeader: authSel.value,
              endpoints,
            });
            toastOk('Service added — set its secret in Settings → Secrets');
            m.close();
            refresh && refresh();
          } catch (e) { toastErr(e.message); }
        },
      }),
    ],
  });
}
