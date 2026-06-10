// File Explorer — browse User Data / Project / System roots, preview & download files.
import { api, ticketUrl } from '../api.js';

// Trigger a ticket-authed download without putting the raw token in the URL.
async function download(path, filename) {
  try {
    const url = await ticketUrl(path);
    const a = document.createElement('a');
    a.href = url; a.download = filename || '';
    document.body.appendChild(a); a.click(); a.remove();
  } catch (e) { /* surfaced by caller toast if needed */ }
}
import { el, mount, clear, asyncView, badge, toast, toastErr, loading, empty, errbox, fmtBytes, fmtTime } from '../ui.js';

const ROOTS = [
  { key: 'data', label: 'User Data' },
  { key: 'project', label: 'Project' },
  { key: 'system', label: 'System' },
];

export default {
  async mount(view) {
    // ── State ──
    const state = {
      root: 'data',
      path: '',
      base: '', // absolute path for system root
    };

    const root = el('div');
    mount(view, root);

    const head = el('div.page-head', {}, [
      el('div', {}, [el('h3', { text: 'File Explorer' }), el('p.muted', { text: 'Browse data, code and system files' })]),
    ]);

    // Root tabs
    const tabs = el('div.tabs');
    const sysPathRow = el('div.row', { style: 'margin:8px 0' });
    const sysInput = el('input', { placeholder: '/absolute/path', value: '/', style: 'flex:1' });
    sysPathRow.append(
      el('span.dim', { text: 'Path:' }),
      el('div.grow', {}, [sysInput]),
      el('button.btn.btn-sm', { text: 'Go', onclick: () => { state.base = sysInput.value.trim(); state.path = ''; render(); } }),
    );

    const breadcrumb = el('div.row', { style: 'margin:6px 0;flex-wrap:wrap;gap:4px' });
    const listPane = el('div.grow');
    const previewPane = el('div.grow', {}, [empty('Select a file to preview')]);
    const split = el('div.split', {}, [listPane, previewPane]);

    mount(root, head, tabs, sysPathRow, breadcrumb, split);

    const renderTabs = () => {
      mount(tabs, ROOTS.map((r) =>
        el('button.tab' + (r.key === state.root ? '.active' : ''), {
          text: r.label,
          onclick: () => {
            if (r.key === state.root) return;
            state.root = r.key;
            state.path = '';
            state.base = r.key === 'system' ? (sysInput.value.trim() || '/') : '';
            render();
          },
        })));
      sysPathRow.style.display = state.root === 'system' ? '' : 'none';
    };

    // ── Breadcrumb (clickable ancestors) ──
    const renderBreadcrumb = () => {
      clear(breadcrumb);
      const rootLabel = ROOTS.find((r) => r.key === state.root)?.label || state.root;
      breadcrumb.appendChild(el('button.btn.btn-sm.btn-ghost', {
        text: state.root === 'system' ? (state.base || '/') : rootLabel,
        onclick: () => { state.path = ''; render(); },
      }));
      const parts = state.path.split('/').filter(Boolean);
      let acc = '';
      parts.forEach((part) => {
        acc = acc ? acc + '/' + part : part;
        const target = acc;
        breadcrumb.appendChild(el('span.dim', { text: '/' }));
        breadcrumb.appendChild(el('button.btn.btn-sm.btn-ghost', {
          text: part,
          onclick: () => { state.path = target; render(); },
        }));
      });
    };

    // ── Preview a file ──
    const previewFile = (name) => {
      const filePath = state.path ? state.path + '/' + name : name;
      const q = `root=${encodeURIComponent(state.root)}&path=${encodeURIComponent(filePath)}` +
        (state.root === 'system' ? `&base=${encodeURIComponent(state.base)}` : '');
      asyncView(previewPane, () => api.get('/api/files/read?' + q), (data) => {
        const dl = el('button.btn.btn-sm', {
          text: '↓ Download',
          onclick: () => download(`/api/files/download?${q}`, name),
        });
        return [
          el('div.page-head', {}, [
            el('div', {}, [el('h3', { text: name }), el('p.muted', { text: `${fmtBytes(data.size)} · ${fmtTime(data.modified)}` })]),
            dl,
          ]),
          el('pre.block', { text: data.content || '' }),
        ];
      });
    };

    // ── List the current directory ──
    const render = () => {
      renderTabs();
      renderBreadcrumb();
      const q = `root=${encodeURIComponent(state.root)}&path=${encodeURIComponent(state.path)}` +
        (state.root === 'system' ? `&base=${encodeURIComponent(state.base)}` : '');
      asyncView(listPane, () => api.get('/api/files?' + q), (data) => {
        const files = data.files || [];
        if (state.root === 'system' && data.base) state.base = data.base;
        if (!files.length) return empty('Empty directory');

        const rows = files.map((f) => {
          if (f.isDir) {
            return el('div.row.file-row', {
              style: 'cursor:pointer;padding:6px 8px;border-radius:6px',
              onclick: () => { state.path = state.path ? state.path + '/' + f.name : f.name; render(); },
            }, [
              el('span', { text: '📁', style: 'width:20px' }),
              el('div.grow', { text: f.name }),
              el('span.dim', { text: '—' }),
            ]);
          }
          const filePath = state.path ? state.path + '/' + f.name : f.name;
          const dlQ = `root=${encodeURIComponent(state.root)}&path=${encodeURIComponent(filePath)}` +
            (state.root === 'system' ? `&base=${encodeURIComponent(state.base)}` : '');
          return el('div.row.file-row', { style: 'padding:6px 8px;border-radius:6px' }, [
            el('span', { text: '📄', style: 'width:20px' }),
            el('div.grow', { text: f.name, style: 'cursor:pointer', onclick: () => previewFile(f.name) }),
            el('span.dim', { text: fmtBytes(f.size), style: 'font-size:12px' }),
            el('button.btn.btn-sm.btn-ghost', { text: '↓', onclick: () => download(`/api/files/download?${dlQ}`, f.name) }),
          ]);
        });
        return el('div', {}, rows);
      });
    };

    render();
  },
};
