// Fleet Control — manage connected secondary machines.
// Shows real-time telemetry, sends commands, shows command history.
import { api } from '../api.js';

const REFRESH_INTERVAL = 30_000;
let refreshTimer = null;
let selectedMachine = null;

export async function mount(container) {
  container.innerHTML = `
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-xl font-semibold">Fleet Control</h2>
          <p class="text-xs text-gray-500 mt-0.5">Manage connected secondary nodes</p>
        </div>
        <button id="refresh-btn" class="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded-lg">
          Refresh
        </button>
      </div>

      <!-- Machine cards grid -->
      <div id="machines-grid" class="grid grid-cols-1 gap-4">
        <p class="text-gray-400 text-sm">Loading…</p>
      </div>

      <!-- Command history panel (shown when a machine is selected) -->
      <div id="history-panel" class="hidden space-y-2">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-medium text-gray-300">Command History — <span id="history-machine-label" class="font-mono text-xs text-gray-400"></span></h3>
          <button id="close-history" class="text-xs text-gray-500 hover:text-gray-300">close</button>
        </div>
        <div id="history-list" class="space-y-1 max-h-64 overflow-y-auto"></div>
      </div>
    </div>
  `;

  document.getElementById('refresh-btn').addEventListener('click', () => renderMachines());
  document.getElementById('close-history').addEventListener('click', () => {
    document.getElementById('history-panel').classList.add('hidden');
    selectedMachine = null;
  });

  await renderMachines();
  refreshTimer = setInterval(renderMachines, REFRESH_INTERVAL);

  // Router uses the returned function as cleanup on navigate-away.
  return () => {
    if (refreshTimer) clearInterval(refreshTimer);
    selectedMachine = null;
  };
}

// ── Render machine cards ─────────────────────────────────────────────────────

async function renderMachines() {
  const grid = document.getElementById('machines-grid');
  try {
    const res = await api.get('/api/machines');
    const machines = res.machines || [];

    if (!machines.length) {
      grid.innerHTML = `
        <div class="p-6 bg-gray-900 border border-gray-800 rounded-xl text-center">
          <div class="text-3xl mb-2">🖥️</div>
          <p class="text-gray-400 text-sm">No secondary machines connected.</p>
          <p class="text-gray-600 text-xs mt-1">Configure WILD_ROLE=secondary + WILD_PRIMARY_URL on remote nodes.</p>
        </div>`;
      return;
    }

    grid.innerHTML = machines.map(m => machineCard(m)).join('');

    // Re-attach event listeners after re-render
    machines.forEach(m => bindMachineCard(m));

    // Refresh history if a machine is selected
    if (selectedMachine) {
      renderHistory(selectedMachine);
    }
  } catch (err) {
    grid.innerHTML = `<p class="text-red-400 text-sm">Error: ${esc(err.message)}</p>`;
  }
}

function machineCard(m) {
  const isOnline = m.status === 'online';
  const statusColor = isOnline ? 'bg-green-500' : 'bg-gray-600';
  const t = m.telemetry || {};

  const cpuPct = t.cpuPercent != null ? Math.round(t.cpuPercent) : null;
  const ramPct = t.ramTotal ? Math.round((t.ramUsed / t.ramTotal) * 100) : null;
  const diskPct = t.diskTotal ? Math.round((t.diskUsed / t.diskTotal) * 100) : null;

  const uptime = t.uptime != null
    ? (() => { const h = Math.floor(t.uptime / 3600), mn = Math.floor((t.uptime % 3600) / 60); return `${h}h ${mn}m`; })()
    : '—';

  const ago = formatAgo(Date.now() - m.lastSeen);

  const barHtml = (pct, color) => pct != null ? `
    <div class="h-1.5 rounded-full bg-gray-800 overflow-hidden">
      <div class="h-full rounded-full ${color}" style="width:${pct}%"></div>
    </div>` : '';

  return `
    <div class="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3" id="card-${esc(m.machineId)}">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="inline-block w-2 h-2 rounded-full ${statusColor} ${isOnline ? 'animate-pulse' : ''}"></span>
          <span class="font-mono font-medium">${esc(m.machineId)}</span>
          ${m.version ? `<span class="text-xs text-gray-600">v${esc(m.version)}</span>` : ''}
        </div>
        <span class="text-xs text-gray-500">${ago}</span>
      </div>

      <!-- Telemetry bars -->
      <div class="grid grid-cols-3 gap-3 text-xs">
        <div>
          <div class="flex justify-between text-gray-400 mb-1"><span>CPU</span><span class="${cpuPct > 80 ? 'text-red-400' : 'text-gray-200'}">${cpuPct != null ? cpuPct + '%' : '—'}</span></div>
          ${barHtml(cpuPct, cpuPct > 80 ? 'bg-red-500' : 'bg-blue-500')}
        </div>
        <div>
          <div class="flex justify-between text-gray-400 mb-1"><span>RAM</span><span class="${ramPct > 80 ? 'text-red-400' : 'text-gray-200'}">${ramPct != null ? ramPct + '%' : '—'}</span></div>
          ${barHtml(ramPct, ramPct > 80 ? 'bg-red-500' : 'bg-purple-500')}
        </div>
        <div>
          <div class="flex justify-between text-gray-400 mb-1"><span>Disk</span><span class="${diskPct > 85 ? 'text-red-400' : 'text-gray-200'}">${diskPct != null ? diskPct + '%' : '—'}</span></div>
          ${barHtml(diskPct, diskPct > 85 ? 'bg-red-500' : 'bg-yellow-500')}
        </div>
      </div>

      <!-- Stats row -->
      <div class="flex gap-4 text-xs text-gray-400">
        <span>Mem: <span class="text-gray-200">${m.memoryCount ?? '—'}</span></span>
        <span>Sessions: <span class="text-gray-200">${m.sessionCount ?? '—'}</span></span>
        <span>Uptime: <span class="text-gray-200">${uptime}</span></span>
      </div>

      ${m.lastError ? `<p class="text-xs text-red-400 truncate">Error: ${esc(m.lastError)}</p>` : ''}

      <!-- Action buttons -->
      <div class="flex flex-wrap gap-2 pt-1 border-t border-gray-800">
        <button data-cmd="restart" data-id="${esc(m.machineId)}"
          class="cmd-btn px-2.5 py-1 text-xs bg-red-900/60 hover:bg-red-800 text-red-200 rounded-lg">
          Restart
        </button>
        <button data-action="stt" data-id="${esc(m.machineId)}"
          class="stt-btn px-2.5 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg">
          STT Provider
        </button>
        <button data-action="model" data-id="${esc(m.machineId)}"
          class="model-btn px-2.5 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg">
          Set Model
        </button>
        <button data-action="history" data-id="${esc(m.machineId)}"
          class="hist-btn px-2.5 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg ml-auto">
          History
        </button>
      </div>
    </div>`;
}

function bindMachineCard(m) {
  const card = document.getElementById(`card-${m.machineId}`);
  if (!card) return;

  // Restart
  card.querySelector('[data-cmd="restart"]')?.addEventListener('click', async () => {
    if (!confirm(`Restart ${m.machineId}? The bot will be offline for ~10s.`)) return;
    await sendCommand(m.machineId, 'restart', {});
  });

  // STT provider picker
  card.querySelector('.stt-btn')?.addEventListener('click', async () => {
    const provider = await showPicker('STT Provider', ['auto', 'groq', 'local']);
    if (!provider) return;
    await sendCommand(m.machineId, 'set-stt-provider', { provider });
  });

  // Model picker
  card.querySelector('.model-btn')?.addEventListener('click', async () => {
    const model = await showPicker('Default Model', ['sonnet', 'haiku', 'opus']);
    if (!model) return;
    await sendCommand(m.machineId, 'set-model', { model });
  });

  // Command history
  card.querySelector('.hist-btn')?.addEventListener('click', () => {
    selectedMachine = m.machineId;
    renderHistory(m.machineId);
  });
}

// ── Command execution ────────────────────────────────────────────────────────

async function sendCommand(machineId, type, payload) {
  try {
    const res = await api.post(`/api/machines/${encodeURIComponent(machineId)}/command`, { type, payload });
    if (res.queued) {
      showToast(`Command "${type}" queued for ${machineId}`, 'success');
    }
  } catch (err) {
    showToast(`Failed: ${err.message}`, 'error');
  }
}

// ── Command history panel ────────────────────────────────────────────────────

async function renderHistory(machineId) {
  const panel = document.getElementById('history-panel');
  const label = document.getElementById('history-machine-label');
  const list = document.getElementById('history-list');

  panel.classList.remove('hidden');
  label.textContent = machineId;
  list.innerHTML = '<p class="text-xs text-gray-500">Loading…</p>';

  try {
    const res = await api.get(`/api/machines/${encodeURIComponent(machineId)}/commands?limit=30`);
    const cmds = res.commands || [];

    if (!cmds.length) {
      list.innerHTML = '<p class="text-xs text-gray-500">No commands yet.</p>';
      return;
    }

    list.innerHTML = cmds.map(c => {
      const statusColor = {
        pending: 'text-yellow-400',
        sent: 'text-blue-400',
        acked: 'text-green-400',
        failed: 'text-red-400',
      }[c.status] || 'text-gray-400';

      const ts = new Date(c.createdAt * 1000).toLocaleTimeString();
      return `
        <div class="flex items-center gap-2 px-2 py-1.5 bg-gray-800/60 rounded text-xs">
          <span class="font-mono text-gray-400 w-14 shrink-0">${ts}</span>
          <span class="font-mono bg-gray-700 px-1.5 py-0.5 rounded">${esc(c.type)}</span>
          <span class="${statusColor} ml-auto">${c.status}</span>
          ${c.result ? `<span class="text-gray-500 truncate max-w-28" title="${esc(c.result)}">${esc(c.result)}</span>` : ''}
        </div>`;
    }).join('');
  } catch (err) {
    list.innerHTML = `<p class="text-red-400 text-xs">${esc(err.message)}</p>`;
  }
}

// ── Utilities ────────────────────────────────────────────────────────────────

function showPicker(label, options) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/60 flex items-center justify-center z-50';
    overlay.innerHTML = `
      <div class="bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-3 min-w-56 shadow-2xl">
        <p class="text-sm font-medium">${esc(label)}</p>
        ${options.map(o => `<button data-val="${esc(o)}"
          class="w-full px-3 py-2 text-sm bg-gray-800 hover:bg-gray-700 rounded-lg text-left">${esc(o)}</button>`).join('')}
        <button data-val="" class="w-full px-3 py-2 text-xs text-gray-500 hover:text-gray-300">Cancel</button>
      </div>`;
    overlay.addEventListener('click', e => {
      const val = e.target.dataset.val;
      if (val !== undefined) { document.body.removeChild(overlay); resolve(val || null); }
    });
    document.body.appendChild(overlay);
  });
}

function showToast(msg, type = 'info') {
  const t = document.createElement('div');
  const bg = type === 'success' ? 'bg-green-800' : type === 'error' ? 'bg-red-900' : 'bg-gray-800';
  t.className = `fixed bottom-4 right-4 z-50 px-4 py-2.5 ${bg} text-white text-sm rounded-xl shadow-xl`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function formatAgo(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
