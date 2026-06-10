// Module registry — metadata only. Modules are lazy-imported on navigation,
// so a single broken module shows an inline error instead of killing the app.
// path is relative to /ui/js/modules/.
export const MODULES = [
  { id: 'command',    title: 'Command Center',     icon: '💬', group: 'Chat' },

  { id: 'memory',     title: 'Memory Palace',       icon: '🧠', group: 'Knowledge' },
  { id: 'wiki',       title: 'Knowledge Wiki',      icon: '📚', group: 'Knowledge' },
  { id: 'journal',    title: 'Daily Journal',       icon: '📓', group: 'Knowledge' },
  { id: 'reflection', title: 'Reflection & Digest', icon: '🔮', group: 'Knowledge' },

  { id: 'agents',     title: 'Agent Hub',           icon: '🤖', group: 'Agents' },
  { id: 'mission',    title: 'Mission Control',     icon: '🎯', group: 'Agents' },
  { id: 'automation', title: 'Automation',          icon: '⏰', group: 'Agents' },
  { id: 'workflows',  title: 'Workflows',           icon: '🔀', group: 'Agents' },
  { id: 'evals',      title: 'Evals',               icon: '✅', group: 'Agents' },

  { id: 'projects',   title: 'Projects',            icon: '📦', group: 'Projects' },

  { id: 'builder',    title: 'Dashboards',          icon: '📊', group: 'Ecosystem' },
  { id: 'ecosystem',  title: 'Skills & MCP',        icon: '🧩', group: 'Ecosystem' },

  { id: 'vitals',     title: 'System Vitals',       icon: '📈', group: 'Monitoring' },
  { id: 'traces',     title: 'Trace Inspector',     icon: '🔍', group: 'Monitoring' },
  { id: 'activity',   title: 'Live Activity',       icon: '📡', group: 'Monitoring' },
  { id: 'audit',      title: 'Audit Log',           icon: '🛡️', group: 'Monitoring' },
  { id: 'hermes',     title: 'Hermes Lab',          icon: '⚗️', group: 'Monitoring' },

  { id: 'files',      title: 'File Explorer',       icon: '📁', group: 'System' },
  { id: 'settings',   title: 'Settings',            icon: '⚙️', group: 'System' },
];

export const GROUP_ORDER = ['Chat', 'Projects', 'Knowledge', 'Agents', 'Ecosystem', 'Monitoring', 'System'];
