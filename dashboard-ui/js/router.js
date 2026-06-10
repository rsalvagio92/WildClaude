// Hash router + nav builder. Lazy-imports module files and manages lifecycle.
import { MODULES, GROUP_ORDER } from './manifest.js';
import { el, mount, clear, errbox, loading } from './ui.js';

let current = null;       // { id, cleanup }
const view = () => document.getElementById('view');

export function buildNav() {
  const nav = document.getElementById('nav');
  clear(nav);
  for (const group of GROUP_ORDER) {
    const items = MODULES.filter((m) => m.group === group);
    if (!items.length) continue;
    nav.appendChild(el('div.nav-group-label', { text: group }));
    for (const m of items) {
      nav.appendChild(el('button.nav-item', {
        dataset: { id: m.id },
        onclick: () => { location.hash = '#/' + m.id; closeMobileNav(); },
      }, [el('span.ico', { text: m.icon }), el('span', { text: m.title })]));
    }
  }
}

function setActive(id) {
  document.querySelectorAll('.nav-item[data-id]').forEach((n) => {
    n.classList.toggle('active', n.dataset.id === id);
  });
  const m = MODULES.find((x) => x.id === id);
  document.getElementById('page-title').textContent = m ? m.title : 'WildClaude';
}

async function navigate() {
  const id = (location.hash.replace(/^#\/?/, '') || MODULES[0].id).split('?')[0];
  const meta = MODULES.find((m) => m.id === id);
  if (!meta) { location.hash = '#/' + MODULES[0].id; return; }

  // Tear down previous module.
  if (current && current.cleanup) { try { current.cleanup(); } catch {} }
  setActive(id);
  const container = view();
  mount(container, loading());

  try {
    const mod = await import(`./modules/${id}.js`);
    const def = mod.default || mod;
    clear(container);
    const cleanup = await def.mount(container, { meta });
    current = { id, cleanup: typeof cleanup === 'function' ? cleanup : null };
  } catch (e) {
    console.error('Module load failed:', id, e);
    mount(container, errbox(`Failed to load "${id}": ${e.message}`));
    current = { id, cleanup: null };
  }
}

export function refreshCurrent() {
  // Re-run the active module's mount.
  navigate();
}

function closeMobileNav() { document.getElementById('app')?.classList.remove('nav-open'); }

export function startRouter() {
  buildNav();
  window.addEventListener('hashchange', navigate);
  if (!location.hash) location.hash = '#/' + MODULES[0].id;
  else navigate();
}
