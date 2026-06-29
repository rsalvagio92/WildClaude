// Store of paired WildClaude servers + the active server's probed capabilities.
// Pairings and the active selection persist to MMKV so they survive restarts;
// `info` is volatile (re-probed on launch / server switch by the layout effect).
import { create } from 'zustand';
import type { ServerCap } from '@/features/manifest';
import { getJSON, setJSON } from '@/lib/storage';

export interface ServerProfile {
  id: string;
  name: string;
  url: string;
  token: string;
  pinnedCertSha256?: string;
}

export interface ServerInfo {
  caps: ServerCap[];
  role: string;
  version?: string;
  online: boolean;
}

const PROFILES_KEY = 'servers.profiles';
const ACTIVE_KEY = 'servers.activeId';

interface ServersState {
  profiles: ServerProfile[];
  activeId: string | null;
  info: ServerInfo | null;
  /** The currently active profile, or null if none is selected. */
  active: () => ServerProfile | null;
  /** Add (or replace by id) a profile; the first one paired becomes active. */
  addProfile: (profile: ServerProfile) => void;
  setActive: (id: string) => void;
  removeProfile: (id: string) => void;
  setInfo: (info: ServerInfo | null) => void;
}

export const useServers = create<ServersState>((set, get) => ({
  profiles: [],
  activeId: null,
  info: null,

  active: () => {
    const { profiles, activeId } = get();
    return profiles.find((p) => p.id === activeId) ?? null;
  },

  addProfile: (profile) => {
    const profiles = [...get().profiles.filter((p) => p.id !== profile.id), profile];
    const activeId = get().activeId ?? profile.id;
    void setJSON(PROFILES_KEY, profiles);
    void setJSON(ACTIVE_KEY, activeId);
    set({ profiles, activeId });
  },

  setActive: (id) => {
    void setJSON(ACTIVE_KEY, id);
    // Drop stale capabilities; the active-server effect re-probes immediately.
    set({ activeId: id, info: null });
  },

  removeProfile: (id) => {
    const wasActive = get().activeId === id;
    const profiles = get().profiles.filter((p) => p.id !== id);
    const activeId = wasActive ? (profiles[0]?.id ?? null) : get().activeId;
    void setJSON(PROFILES_KEY, profiles);
    void setJSON(ACTIVE_KEY, activeId);
    set(wasActive ? { profiles, activeId, info: null } : { profiles, activeId });
  },

  setInfo: (info) => set({ info }),
}));
