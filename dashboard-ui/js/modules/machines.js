// Machines — view connected secondaries in real-time
// Shows: machineId, status (online/offline), memory count, last seen

const REFRESH_INTERVAL = 30_000; // 30 seconds

let refreshTimer = null;

export async function mount(container) {
  container.innerHTML = `
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-xl font-semibold">Connected Machines</h2>
        <button id="refresh-machines" class="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
          Refresh
        </button>
      </div>
      <div id="machines-list" class="space-y-2">
        <p class="text-gray-400 text-sm">Loading...</p>
      </div>
    </div>
  `;

  document.getElementById('refresh-machines').addEventListener('click', () => refreshMachines(container));

  await refreshMachines(container);

  // Auto-refresh
  refreshTimer = setInterval(() => refreshMachines(container), REFRESH_INTERVAL);
}

async function refreshMachines(container) {
  try {
    const res = await api.get('/api/machines');
    const machines = res.machines || [];

    const listEl = document.getElementById('machines-list');
    if (!machines.length) {
      listEl.innerHTML = '<p class="text-gray-400 text-sm">No secondaries connected.</p>';
      return;
    }

    const now = Date.now();
    listEl.innerHTML = machines
      .map(m => {
        const isOnline = m.status === 'online';
        const ago = formatTimeDiff(now - m.lastSeen);
        const statusBadge = isOnline
          ? '<span class="px-2 py-0.5 text-xs bg-green-900 text-green-100 rounded">online</span>'
          : '<span class="px-2 py-0.5 text-xs bg-gray-700 text-gray-300 rounded">offline</span>';

        return `
          <div class="p-3 bg-gray-800 rounded border border-gray-700">
            <div class="flex items-center justify-between mb-1">
              <span class="font-mono text-sm">${escapeHtml(m.machineId)}</span>
              ${statusBadge}
            </div>
            <div class="text-xs text-gray-400 space-y-0.5">
              <div>Memory: <span class="text-gray-200">${m.memoryCount || '?'}</span> records</div>
              <div>Last seen: <span class="text-gray-200">${ago}</span></div>
            </div>
          </div>
        `;
      })
      .join('');
  } catch (err) {
    const listEl = document.getElementById('machines-list');
    listEl.innerHTML = `<p class="text-red-400 text-sm">Error: ${escapeHtml(err.message)}</p>`;
  }
}

function formatTimeDiff(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

export function unmount() {
  if (refreshTimer) clearInterval(refreshTimer);
}
