// Projects — containers that bundle everything WildClaude needs to work on a
// repo/app: description, repos, environment notes, secret references (names
// only), links, a markdown knowledge base, and project-scoped dashboards.
// The container is both human-browsable and injected into the assistant as a
// reference (see /api/projects/:id/reference).
import { api } from '../api.js';
import {
  el, mount, clear, escapeHtml, badge, card, empty, loading, errbox,
  modal, confirmDialog, toastOk, toastErr, action, fmtTime, truncate,
} from '../ui.js';
import { openGenerate } from './builder.js';

export default {
  async mount(view, params) {
    const root = el('div');
    mount(view, root);
    if (params && params.id) openProject(root, params.id);
    else renderIndex(root);
  },
};

// ── Index ──────────────────────────────────────────────────────────────

function renderIndex(root) {
  const run = () => renderIndex(root);
  const head = el('div.page-head', {}, [
    el('div', {}, [
      el('h3', { text: 'Projects' }),
      el('p.muted', { text: 'Containers for the repos and apps you manage — context, secrets, knowledge, and dashboards in one place. The assistant uses the active project as a reference.' }),
    ]),
    el('div.btn-row', {}, [
      el('button.btn.btn-accent', { text: '+ New project', onclick: () => openCreate(run) }),
      el('button.icon-btn', { text: '⟳', onclick: run }),
    ]),
  ]);
  const grid = el('div.grid.grid-2');
  mount(root, head, grid);
  mount(grid, loading('Loading projects…'));

  api.get('/api/projects').then(({ projects }) => {
    if (!projects || !projects.length) { mount(grid, empty('No projects yet. Create one to give the assistant a working context.')); return; }
    mount(grid, ...projects.map((p) => projectCard(p, root, run)));
  }).catch((e) => mount(grid, errbox(e.message)));
}

function projectCard(p, root, refresh) {
  const head = el('div.row', {}, [
    el('span', { html: escapeHtml(p.icon || '📦'), style: 'font-size:20px' }),
    el('h3', { text: p.name, style: 'margin:0' }),
    p.status && p.status !== 'active' ? badge(p.status, 'warn') : badge('active', 'ok'),
  ]);
  const desc = p.description ? el('p.muted', { text: truncate(p.description, 130), style: 'font-size:13px' }) : null;
  const meta = el('p.muted', {
    text: `${(p.repos || []).length} repos · ${(p.secretRefs || []).length} secrets · updated ${fmtTime(p.updatedAt)}`,
    style: 'font-size:12px',
  });
  const btnRow = el('div.btn-row', { style: 'margin-top:10px' }, [
    el('button.btn.btn-sm.btn-accent', { text: 'Open', onclick: () => openProject(root, p.id) }),
    el('button.btn.btn-sm.btn-danger', {
      text: 'Delete',
      onclick: () => confirmDialog(`Delete project "${p.name}" and its knowledge base?`, () =>
        action(() => api.del('/api/projects/' + encodeURIComponent(p.id)), { ok: 'Deleted', refresh }), { danger: true, confirmText: 'Delete' }),
    }),
  ]);
  return el('div.card', {}, [head, desc, meta, btnRow]);
}

// ── Create ──────────────────────────────────────────────────────────────

function openCreate(refresh) {
  const nameIn = el('input', { placeholder: 'My App', type: 'text' });
  const iconIn = el('input', { placeholder: '📦', type: 'text' });
  const descIn = el('textarea', { rows: 3, style: 'width:100%', placeholder: 'What this project is, its goals, current focus…' });
  const m = modal({
    title: '+ New project',
    body: [
      el('div.field', {}, [el('label', { text: 'Name' }), nameIn]),
      el('div.field', {}, [el('label', { text: 'Icon (emoji)' }), iconIn]),
      el('div.field', {}, [el('label', { text: 'Description' }), descIn]),
    ],
    footer: [
      el('button.btn', { text: 'Cancel', onclick: () => m.close() }),
      el('button.btn.btn-accent', {
        text: 'Create',
        onclick: async () => {
          const name = nameIn.value.trim();
          if (!name) { toastErr('Name required'); return; }
          try {
            await api.post('/api/projects', { name, icon: iconIn.value.trim() || undefined, description: descIn.value.trim() || undefined });
            toastOk('Project created');
            m.close();
            refresh && refresh();
          } catch (e) { toastErr(e.message); }
        },
      }),
    ],
  });
}

// ── Detail ──────────────────────────────────────────────────────────────

function openProject(root, id) {
  clear(root);
  const head = el('div.page-head', {}, [
    el('div', {}, [el('h3', { text: 'Loading…' })]),
    el('div.btn-row', {}, [el('button.btn', { text: '← All projects', onclick: () => renderIndex(root) })]),
  ]);
  const body = el('div');
  mount(root, head, body);
  mount(body, loading('Loading project…'));

  const reload = () => openProject(root, id);

  api.get('/api/projects/' + encodeURIComponent(id)).then(({ project, knowledge }) => {
    mount(head,
      el('div', {}, [el('h3', { text: `${project.icon || '📦'} ${project.name}` }), project.description ? el('p.muted', { text: project.description, style: 'font-size:13px' }) : null]),
      el('div.btn-row', {}, [
        el('button.btn.btn-sm', { text: 'Edit', onclick: () => openEdit(project, reload) }),
        el('button.btn.btn-sm', { text: '👁 Reference', onclick: () => previewReference(id) }),
        el('button.btn', { text: '← All projects', onclick: () => renderIndex(root) }),
      ]),
    );
    clear(body);
    body.appendChild(overviewCard(project));
    body.appendChild(knowledgeCard(project, knowledge || [], reload));
    body.appendChild(dashboardsCard(project));
  }).catch((e) => mount(body, errbox(e.message)));
}

function overviewCard(p) {
  const sections = [];
  if (p.repos && p.repos.length) {
    sections.push(el('div', {}, [
      el('h4', { text: 'Repositories', style: 'margin:6px 0' }),
      el('ul.clean-list', {}, p.repos.map((r) => el('li', {}, [
        el('strong', { text: r.name }),
        r.branch ? el('span.muted', { text: ` [${r.branch}]` }) : null,
        r.url ? el('div.muted', { text: r.url, style: 'font-size:12px' }) : null,
        r.path ? el('div.muted', { text: 'local: ' + r.path, style: 'font-size:12px' }) : null,
      ]))),
    ]));
  }
  if (p.envNotes) sections.push(el('div', {}, [el('h4', { text: 'Environment', style: 'margin:6px 0' }), el('div.note-body', { text: p.envNotes })]));
  if (p.secretRefs && p.secretRefs.length) {
    sections.push(el('div', {}, [
      el('h4', { text: 'Secrets used (names only)', style: 'margin:6px 0' }),
      el('div.btn-row', {}, p.secretRefs.map((s) => badge(s, ''))),
      el('p.muted', { text: 'Set values in Settings → Secrets. Values are never stored in the project.', style: 'font-size:11px;margin-top:6px' }),
    ]));
  }
  if (p.links && p.links.length) {
    sections.push(el('div', {}, [
      el('h4', { text: 'Links', style: 'margin:6px 0' }),
      el('ul.clean-list', {}, p.links.map((l) => el('li', {}, [el('a', { href: l.url, target: '_blank', rel: 'noopener', text: l.label || l.url })]))),
    ]));
  }
  if (!sections.length) sections.push(empty('No details yet — use Edit to add repos, environment notes, secrets, and links.'));
  return card('Overview', sections);
}

// ── Knowledge base ────────────────────────────────────────────────────

function knowledgeCard(p, knowledge, reload) {
  const list = knowledge.length
    ? el('ul.clean-list', {}, knowledge.map((doc) => el('li', {}, [
        el('span', { text: '📄 ' }),
        el('a', { href: 'javascript:void 0', text: doc.file, onclick: () => openKbEditor(p.id, doc.file, reload) }),
        el('span.muted', { text: ` · ${(doc.bytes / 1024).toFixed(1)} KB · ${fmtTime(doc.updatedAt)}`, style: 'font-size:11px' }),
        el('button.btn.btn-sm.btn-danger', {
          text: '✕', style: 'margin-left:8px',
          onclick: () => confirmDialog(`Delete "${doc.file}"?`, () =>
            action(() => api.del(`/api/projects/${encodeURIComponent(p.id)}/knowledge/${encodeURIComponent(doc.file)}`), { ok: 'Deleted', refresh: reload }), { danger: true, confirmText: 'Delete' }),
        }),
      ])))
    : empty('No knowledge docs yet. Add architecture notes, runbooks, conventions — the assistant reads these as project context.');
  return card('Knowledge base', [
    list,
    el('div.btn-row', { style: 'margin-top:10px' }, [el('button.btn.btn-sm.btn-accent', { text: '+ New doc', onclick: () => openKbEditor(p.id, '', reload) })]),
  ]);
}

function openKbEditor(projectId, file, reload) {
  const nameIn = el('input', { type: 'text', placeholder: 'architecture.md', value: file || '' });
  const contentArea = el('textarea', { rows: 18, style: 'width:100%;font-family:monospace;font-size:13px' });
  const m = modal({
    title: file ? `Edit ${file}` : 'New knowledge doc',
    wide: true,
    body: [
      file ? null : el('div.field', {}, [el('label', { text: 'File name (.md)' }), nameIn]),
      el('div.field', {}, [el('label', { text: 'Markdown' }), contentArea]),
    ],
    footer: [
      el('button.btn', { text: 'Cancel', onclick: () => m.close() }),
      el('button.btn.btn-accent', {
        text: 'Save',
        onclick: async () => {
          const name = (file || nameIn.value.trim());
          if (!name) { toastErr('File name required'); return; }
          try {
            await api.put(`/api/projects/${encodeURIComponent(projectId)}/knowledge/${encodeURIComponent(name)}`, { content: contentArea.value });
            toastOk('Saved');
            m.close();
            reload && reload();
          } catch (e) { toastErr(e.message); }
        },
      }),
    ],
  });
  if (file) {
    api.get(`/api/projects/${encodeURIComponent(projectId)}/knowledge/${encodeURIComponent(file)}`)
      .then(({ content }) => { contentArea.value = content || ''; })
      .catch((e) => toastErr(e.message));
  }
}

// ── Project-scoped dashboards ───────────────────────────────────────────

function dashboardsCard(p) {
  const box = el('div');
  const listBox = el('div');
  mount(box, listBox, el('div.btn-row', { style: 'margin-top:10px' }, [
    el('button.btn.btn-sm.btn-accent', { text: '✨ Describe a dashboard', onclick: () => openGenerate(() => loadList(), { projectId: p.id }) }),
    el('button.btn.btn-sm', { text: '+ From template', onclick: () => templateScoped(p.id, () => loadList()) }),
  ]));

  const loadList = () => {
    mount(listBox, loading('Loading dashboards…'));
    api.get('/api/dash?projectId=' + encodeURIComponent(p.id)).then(({ dashboards }) => {
      if (!dashboards || !dashboards.length) { mount(listBox, empty('No dashboards scoped to this project yet.')); return; }
      mount(listBox, el('ul.clean-list', {}, dashboards.map((d) => el('li', {}, [
        el('a', { href: '#/builder?id=' + encodeURIComponent(d.id), text: `${d.icon || '📊'} ${d.title}` }),
        el('span.muted', { text: ` · ${(d.widgets || []).length} widgets`, style: 'font-size:11px' }),
      ]))));
    }).catch((e) => mount(listBox, errbox(e.message)));
  };
  loadList();
  return card('Dashboards', [box]);
}

function templateScoped(projectId, refresh) {
  const m = modal({ title: '+ From template', wide: true, body: loading('Loading…') });
  const body = m.box.querySelector('.modal-body');
  api.get('/api/dash/templates').then(({ templates }) => {
    mount(body, el('div.grid.grid-2', {}, (templates || []).map((t) => el('div.card', {}, [
      el('div.row', {}, [el('span', { html: escapeHtml(t.icon || '📊'), style: 'font-size:18px' }), el('h3', { text: t.title, style: 'margin:0' })]),
      el('p.muted', { text: t.description || '', style: 'font-size:12px' }),
      el('button.btn.btn-sm.btn-accent', { text: 'Use this', onclick: () => action(() => api.post('/api/dash', { templateId: t.id, projectId }), { ok: 'Created', refresh: () => { m.close(); refresh && refresh(); } }) }),
    ]))));
  }).catch((e) => mount(body, errbox(e.message)));
}

// ── Edit metadata ─────────────────────────────────────────────────────

function openEdit(p, reload) {
  const nameIn = el('input', { type: 'text', value: p.name || '' });
  const iconIn = el('input', { type: 'text', value: p.icon || '' });
  const statusSel = el('select', {}, ['active', 'paused', 'archived'].map((s) => {
    const o = el('option', { value: s, text: s }); if (s === (p.status || 'active')) o.selected = true; return o;
  }));
  const descIn = el('textarea', { rows: 3, style: 'width:100%', value: p.description || '' });
  const envIn = el('textarea', { rows: 6, style: 'width:100%;font-family:monospace;font-size:12px', value: p.envNotes || '' });
  const reposIn = el('textarea', { rows: 5, style: 'width:100%;font-family:monospace;font-size:12px', placeholder: '[{"name":"api","url":"https://github.com/…","branch":"main","path":"/srv/api"}]', value: p.repos && p.repos.length ? JSON.stringify(p.repos, null, 2) : '' });
  const secretsIn = el('input', { type: 'text', placeholder: 'STRIPE_KEY, GITHUB_TOKEN', value: (p.secretRefs || []).join(', ') });
  const linksIn = el('textarea', { rows: 3, style: 'width:100%;font-family:monospace;font-size:12px', placeholder: '[{"label":"Repo","url":"https://…"}]', value: p.links && p.links.length ? JSON.stringify(p.links, null, 2) : '' });

  const m = modal({
    title: `Edit ${p.name}`,
    wide: true,
    body: [
      el('div.field', {}, [el('label', { text: 'Name' }), nameIn]),
      el('div.field', {}, [el('label', { text: 'Icon' }), iconIn]),
      el('div.field', {}, [el('label', { text: 'Status' }), statusSel]),
      el('div.field', {}, [el('label', { text: 'Description' }), descIn]),
      el('div.field', {}, [el('label', { text: 'Environment notes (markdown)' }), envIn]),
      el('div.field', {}, [el('label', { text: 'Repositories (JSON array)' }), reposIn]),
      el('div.field', {}, [el('label', { text: 'Secret references (comma-separated names)' }), secretsIn]),
      el('div.field', {}, [el('label', { text: 'Links (JSON array)' }), linksIn]),
    ],
    footer: [
      el('button.btn', { text: 'Cancel', onclick: () => m.close() }),
      el('button.btn.btn-accent', {
        text: 'Save',
        onclick: async () => {
          let repos, links;
          try { repos = reposIn.value.trim() ? JSON.parse(reposIn.value) : []; } catch { toastErr('Repos must be valid JSON'); return; }
          try { links = linksIn.value.trim() ? JSON.parse(linksIn.value) : []; } catch { toastErr('Links must be valid JSON'); return; }
          const secretRefs = secretsIn.value.split(',').map((s) => s.trim()).filter(Boolean);
          try {
            await api.put('/api/projects/' + encodeURIComponent(p.id), {
              name: nameIn.value.trim(), icon: iconIn.value.trim(), status: statusSel.value,
              description: descIn.value.trim(), envNotes: envIn.value, repos, secretRefs, links,
            });
            toastOk('Saved'); m.close(); reload && reload();
          } catch (e) { toastErr(e.message); }
        },
      }),
    ],
  });
}

function previewReference(id) {
  const m = modal({ title: 'Assistant reference', wide: true, body: loading('Building…') });
  const body = m.box.querySelector('.modal-body');
  api.get('/api/projects/' + encodeURIComponent(id) + '/reference')
    .then(({ reference }) => mount(body, [
      el('p.muted', { text: 'This is the context block injected into the assistant when this project is active.', style: 'font-size:12px' }),
      el('pre.block', { text: reference, style: 'max-height:60vh;overflow:auto;font-size:12px;white-space:pre-wrap' }),
    ]))
    .catch((e) => mount(body, errbox(e.message)));
}
