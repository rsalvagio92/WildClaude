// Bootstrap: login gate → identity/theme → SSE → router → topbar status.
import { api, getToken, setToken, clearToken } from './api.js';
import { startSSE, onSSEStatus } from './sse.js';
import { startRouter, refreshCurrent } from './router.js';
import { toast, toastErr } from './ui.js';

const $ = (id) => document.getElementById(id);

async function applyIdentity() {
  try {
    const info = await api.get('/api/info');
    const name = info.botName || 'WildClaude';
    const emoji = info.botEmoji || '🐺';
    document.title = name;
    $('brand-name').textContent = name;
    $('brand-logo').textContent = emoji;
    if (info.botTheme) document.documentElement.dataset.theme = info.botTheme;
  } catch { /* defaults stay */ }
}

async function pollStatus() {
  try {
    const h = await api.get('/api/health');
    const tg = $('st-telegram');
    tg.className = 'dot ' + (h.telegramConnected ? 'ok' : 'err');
    tg.title = 'Telegram: ' + (h.telegramConnected ? 'connected' : 'offline');
    $('st-model').textContent = (h.model || '—').replace('claude-', '');
  } catch { /* ignore transient */ }
}

function wireShell() {
  $('sidebar-toggle').addEventListener('click', () => $('app').classList.toggle('collapsed'));
  $('menu-btn').addEventListener('click', () => $('app').classList.toggle('nav-open'));
  $('refresh-btn').addEventListener('click', () => { refreshCurrent(); pollStatus(); });
  $('logout-btn').addEventListener('click', () => { clearToken(); location.reload(); });

  // Caveman toggle — reflects + flips the personality preset.
  const cavemanBtn = $('caveman-btn');
  const refreshCaveman = async () => {
    try {
      const p = await api.get('/api/personality');
      cavemanBtn.classList.toggle('on', p.preset === 'caveman');
    } catch {}
  };
  cavemanBtn.addEventListener('click', async () => {
    try {
      const p = await api.get('/api/personality');
      const isOn = p.preset === 'caveman';
      if (isOn) {
        const cfg = await api.get('/api/config');
        const prev = cfg.previousPreset || 'default';
        const presets = await api.get('/api/personality/presets');
        const target = (presets.presets || []).find((x) => x.id === prev) || { id: 'default', config: { preset: 'default' } };
        await api.put('/api/personality', { ...target.config, preset: target.id });
        await api.put('/api/config', { previousPreset: null });
        toast('Caveman mode OFF → ' + target.id);
      } else {
        const presets = await api.get('/api/personality/presets');
        const caveman = (presets.presets || []).find((x) => x.id === 'caveman');
        if (!caveman) { toastErr('Caveman preset not found'); return; }
        await api.put('/api/config', { previousPreset: p.preset || 'default' });
        await api.put('/api/personality', { ...caveman.config, preset: 'caveman' });
        toast('Caveman mode ON 🦴', 'warn');
      }
      refreshCaveman();
    } catch (e) { toastErr(e.message); }
  });
  refreshCaveman();

  onSSEStatus((up) => {
    const q = $('st-queue');
    q.className = 'dot ' + (up ? 'ok' : 'warn');
    q.title = 'Live stream: ' + (up ? 'connected' : 'reconnecting');
  });
}

async function boot() {
  await applyIdentity();
  wireShell();
  startSSE();
  startRouter();
  pollStatus();
  setInterval(pollStatus, 15000);
  $('login').hidden = true;
  $('app').hidden = false;
}

function showLogin(errMsg) {
  const login = $('login');
  login.hidden = false;
  $('app').hidden = true;
  if (errMsg) { const e = $('login-error'); e.textContent = errMsg; e.hidden = false; }
  // Pre-fill identity on login screen too (best-effort, unauth).
  $('login-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const token = $('login-token').value.trim();
    if (!token) return;
    setToken(token);
    try {
      await api.get('/api/info'); // validates token
      boot();
    } catch (e) {
      clearToken();
      const err = $('login-error');
      err.textContent = e.status === 401 ? 'Invalid token.' : (e.message || 'Login failed');
      err.hidden = false;
    }
  };
}

(async function init() {
  const token = getToken();
  if (!token) { showLogin(); return; }
  try {
    await api.get('/api/info');
    boot();
  } catch (e) {
    if (e.status === 401) showLogin('Session expired — enter your token.');
    else showLogin(e.message || 'Could not reach the dashboard API.');
  }
})();
