// Feature manifest — the single source of truth for what the app can do.
//
// Adding/removing a feature is ONE entry here. Navigation, the Features
// settings screen, push subscriptions and lazy route mounting are all derived
// from this list. Mirrors the web SPA's manifest.js philosophy.
//
// A feature is shown only when:
//   1. it is enabled (default from `enabledByDefault`, overridable at runtime), AND
//   2. the connected server advertises every capability in `requiresServerCap`
//      (read from GET /api/info — e.g. 'voice', 'fleet', 'dashboards').

export type ServerCap =
  | 'chat'
  | 'voice'
  | 'fleet'
  | 'dashboards'
  | 'memory'
  | 'agents'
  | 'monitoring'
  | 'observability';

export type FeatureGroup =
  | 'Talk'
  | 'Fleet'
  | 'Monitor'
  | 'Knowledge'
  | 'Agents'
  | 'Dashboards'
  | 'Observability'
  | 'Ecosystem'
  | 'System';

export interface FeatureDef {
  /** Stable id; also the expo-router route segment under /(app)/. */
  id: string;
  title: string;
  icon: string;
  group: FeatureGroup;
  /** Whether the feature is on for a fresh install. */
  enabledByDefault: boolean;
  /** Server capabilities required for this feature to be usable. */
  requiresServerCap: ServerCap[];
  /** Phase that delivers this feature (for tracking; not used at runtime). */
  phase: number;
}

export const FEATURES: FeatureDef[] = [
  { id: 'talk',       title: 'Talk',          icon: '💬', group: 'Talk',       enabledByDefault: true,  requiresServerCap: ['chat'],        phase: 1 },
  { id: 'voice',      title: 'Voice',         icon: '🎙️', group: 'Talk',       enabledByDefault: true,  requiresServerCap: ['chat', 'voice'], phase: 1 },

  { id: 'fleet',      title: 'Fleet',         icon: '🖥️', group: 'Fleet',      enabledByDefault: true,  requiresServerCap: ['fleet'],       phase: 2 },
  { id: 'vitals',     title: 'System Vitals', icon: '📈', group: 'Monitor',    enabledByDefault: true,  requiresServerCap: ['monitoring'],  phase: 2 },
  { id: 'activity',   title: 'Live Activity', icon: '📡', group: 'Monitor',    enabledByDefault: false, requiresServerCap: ['monitoring'],  phase: 2 },
  { id: 'audit',      title: 'Audit Log',     icon: '🛡️', group: 'Monitor',    enabledByDefault: false, requiresServerCap: ['monitoring'],  phase: 2 },

  { id: 'memory',     title: 'Memory',        icon: '🧠', group: 'Knowledge',  enabledByDefault: true,  requiresServerCap: ['memory'],      phase: 3 },
  { id: 'wiki',       title: 'Wiki',          icon: '📚', group: 'Knowledge',  enabledByDefault: false, requiresServerCap: ['memory'],      phase: 3 },
  { id: 'journal',    title: 'Journal',       icon: '📓', group: 'Knowledge',  enabledByDefault: false, requiresServerCap: ['memory'],      phase: 3 },

  { id: 'agents',     title: 'Agent Hub',     icon: '🤖', group: 'Agents',     enabledByDefault: true,  requiresServerCap: ['agents'],      phase: 3 },
  { id: 'missions',   title: 'Missions',      icon: '🎯', group: 'Agents',     enabledByDefault: false, requiresServerCap: ['agents'],      phase: 3 },
  { id: 'automation', title: 'Automation',    icon: '⏰', group: 'Agents',     enabledByDefault: false, requiresServerCap: ['agents'],      phase: 3 },

  { id: 'dashboards', title: 'Dashboards',    icon: '📊', group: 'Dashboards', enabledByDefault: true,  requiresServerCap: ['dashboards'],  phase: 4 },

  { id: 'traces',     title: 'Traces',        icon: '🔍', group: 'Observability', enabledByDefault: false, requiresServerCap: ['observability'], phase: 5 },
  { id: 'reflection', title: 'Reflection',    icon: '🔮', group: 'Observability', enabledByDefault: false, requiresServerCap: ['observability'], phase: 5 },
  { id: 'evals',      title: 'Evals',         icon: '✅', group: 'Observability', enabledByDefault: false, requiresServerCap: ['observability'], phase: 5 },
  { id: 'workflows',  title: 'Workflows',     icon: '🔀', group: 'Observability', enabledByDefault: false, requiresServerCap: ['observability'], phase: 5 },
  { id: 'hermes',     title: 'Hermes Lab',    icon: '⚗️', group: 'Observability', enabledByDefault: false, requiresServerCap: ['observability'], phase: 5 },
  { id: 'files',      title: 'Files',         icon: '📁', group: 'Observability', enabledByDefault: false, requiresServerCap: ['observability'], phase: 5 },

  { id: 'skills',     title: 'Skills & MCP',  icon: '🧩', group: 'Ecosystem',  enabledByDefault: true,  requiresServerCap: ['agents'],      phase: 4 },
  { id: 'projects',   title: 'Progetti',      icon: '📂', group: 'Ecosystem',  enabledByDefault: false, requiresServerCap: [],              phase: 4 },

  { id: 'notifications', title: 'Notifiche',  icon: '🔔', group: 'System',     enabledByDefault: true,  requiresServerCap: ['chat'],        phase: 1 },
  { id: 'settings',   title: 'Settings',      icon: '⚙️', group: 'System',     enabledByDefault: true,  requiresServerCap: [],              phase: 0 },
];

export const FEATURE_GROUP_ORDER: FeatureGroup[] = [
  'Talk', 'Fleet', 'Monitor', 'Knowledge', 'Agents', 'Dashboards', 'Observability', 'Ecosystem', 'System',
];

export function getFeature(id: string): FeatureDef | undefined {
  return FEATURES.find((f) => f.id === id);
}

/** Server capabilities satisfy a feature's requirements. */
export function serverSupports(feature: FeatureDef, caps: ServerCap[]): boolean {
  return feature.requiresServerCap.every((c) => caps.includes(c));
}
