// Per-feature on/off overrides layered over the manifest defaults.
// Defaults come from each feature's `enabledByDefault`; user toggles persist
// to MMKV. A feature is "visible" only when enabled AND server-supported.
import { create } from 'zustand';
import {
  FEATURES,
  getFeature,
  serverSupports,
  type FeatureDef,
  type ServerCap,
} from '@/features/manifest';
import { getJSON, setJSON } from '@/lib/storage';

const OVERRIDES_KEY = 'features.overrides';

interface FeaturesState {
  /** featureId → explicit user choice; absence means "use the default". */
  overrides: Record<string, boolean>;
  isEnabled: (featureId: string) => boolean;
  /** Enabled features whose server-capability requirements are met by `caps`. */
  visible: (caps: ServerCap[]) => FeatureDef[];
  setEnabled: (featureId: string, enabled: boolean) => void;
  reset: () => void;
}

export const useFeatures = create<FeaturesState>((set, get) => ({
  overrides: {},

  isEnabled: (featureId) => {
    const { overrides } = get();
    if (featureId in overrides) return overrides[featureId];
    return getFeature(featureId)?.enabledByDefault ?? false;
  },

  visible: (caps) => {
    const { isEnabled } = get();
    return FEATURES.filter((f) => isEnabled(f.id) && serverSupports(f, caps));
  },

  setEnabled: (featureId, enabled) => {
    const overrides = { ...get().overrides, [featureId]: enabled };
    void setJSON(OVERRIDES_KEY, overrides);
    set({ overrides });
  },

  reset: () => {
    void setJSON(OVERRIDES_KEY, {});
    set({ overrides: {} });
  },
}));
