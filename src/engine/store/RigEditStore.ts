import { create } from "zustand";
import type { RigConfig, ComponentInstance } from "../types";
import { createComponentInstance } from "../registry";
import {
  saveRigConfigToStorage,
  loadRigConfigFromStorage,
  listSavedConfigIds,
  CONFIG_VERSION,
} from "./configPersistence";

interface RigEditState {
  isEditMode: boolean;
  activeConfigId: string | null;
  rigConfigs: RigConfig[];
  selectedComponentId: string | null;
  showGizmos: boolean;
  isDirty: boolean;
  /** Bone names from the loaded model — populated by RigRuntimeBridge */
  boneNames: string[];
  /** Preview signal values driven by SignalPreview sliders */
  previewSignals: Record<string, number>;

  // ── Navigation ────────────────────────────────────────────────────────────
  enterEditMode: (configId?: string) => void;
  exitEditMode: () => void;

  // ── Config CRUD ───────────────────────────────────────────────────────────
  createNewConfig: (name: string, modelPath: string) => RigConfig;
  saveConfig: () => void;
  loadConfig: (id: string) => void;
  listSavedConfigs: () => { id: string; name: string }[];

  // ── Component management ──────────────────────────────────────────────────
  addComponent: (type: string) => void;
  removeComponent: (id: string) => void;
  reorderComponent: (fromIndex: number, toIndex: number) => void;
  updateComponentProperty: (componentId: string, key: string, value: unknown) => void;
  renameComponent: (componentId: string, name: string) => void;
  toggleComponent: (componentId: string) => void;

  // ── UI state ──────────────────────────────────────────────────────────────
  selectComponent: (id: string | null) => void;
  toggleGizmos: () => void;
  setPreviewSignal: (key: string, value: number) => void;
  setBoneNames: (names: string[]) => void;
}

// Helper: find active config
function getActive(state: RigEditState): RigConfig | undefined {
  return state.rigConfigs.find((c) => c.id === state.activeConfigId);
}

// Helper: update active config's components immutably
function updateComponents(
  state: RigEditState,
  fn: (components: ComponentInstance[]) => ComponentInstance[]
): Partial<RigEditState> {
  const active = getActive(state);
  if (!active) return {};
  const updated: RigConfig = { ...active, components: fn(active.components) };
  return {
    rigConfigs: state.rigConfigs.map((c) => (c.id === active.id ? updated : c)),
    isDirty: true,
  };
}

export const useRigEditStore = create<RigEditState>((set, get) => ({
  isEditMode: false,
  activeConfigId: null,
  rigConfigs: [],
  selectedComponentId: null,
  showGizmos: false,
  isDirty: false,
  boneNames: [],
  previewSignals: {},

  enterEditMode: (configId) => {
    const state = get();
    let id = configId;
    if (id) {
      // Try to load from storage if not already in memory
      if (!state.rigConfigs.find((c) => c.id === id)) {
        const loaded = loadRigConfigFromStorage(id);
        if (loaded) {
          set((s) => ({ rigConfigs: [...s.rigConfigs, loaded] }));
        }
      }
    } else {
      // Use first available or leave null to show empty state
      id = state.activeConfigId ?? state.rigConfigs[0]?.id ?? undefined;
    }
    set({ isEditMode: true, activeConfigId: id ?? null });
  },

  exitEditMode: () => {
    const { isDirty } = get();
    if (isDirty) get().saveConfig();
    set({ isEditMode: false, selectedComponentId: null });
  },

  createNewConfig: (name, modelPath) => {
    const config: RigConfig = {
      _version: CONFIG_VERSION,
      id: crypto.randomUUID(),
      name,
      modelPath,
      components: [],
    };
    set((s) => ({ rigConfigs: [...s.rigConfigs, config], activeConfigId: config.id, isDirty: true }));
    return config;
  },

  saveConfig: () => {
    const active = getActive(get());
    if (!active) return;
    saveRigConfigToStorage(active);
    set({ isDirty: false });
  },

  loadConfig: (id) => {
    const loaded = loadRigConfigFromStorage(id);
    if (!loaded) { console.warn(`[RigEditStore] Config not found: ${id}`); return; }
    set((s) => {
      const exists = s.rigConfigs.find((c) => c.id === id);
      return {
        rigConfigs: exists ? s.rigConfigs.map((c) => (c.id === id ? loaded : c)) : [...s.rigConfigs, loaded],
        activeConfigId: id,
        isDirty: false,
      };
    });
  },

  listSavedConfigs: () => {
    return listSavedConfigIds().map((id) => {
      const inMemory = get().rigConfigs.find((c) => c.id === id);
      if (inMemory) return { id, name: inMemory.name };
      const loaded = loadRigConfigFromStorage(id);
      return { id, name: loaded?.name ?? id };
    });
  },

  addComponent: (type) => {
    const instance = createComponentInstance(type);
    set((s) => updateComponents(s, (comps) => [...comps, instance]));
    set({ selectedComponentId: instance.id });
  },

  removeComponent: (id) => {
    set((s) => ({
      ...updateComponents(s, (comps) => comps.filter((c) => c.id !== id)),
      selectedComponentId: s.selectedComponentId === id ? null : s.selectedComponentId,
    }));
  },

  reorderComponent: (fromIndex, toIndex) => {
    set((s) =>
      updateComponents(s, (comps) => {
        const next = [...comps];
        const [item] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, item);
        return next;
      })
    );
  },

  updateComponentProperty: (componentId, key, value) => {
    set((s) =>
      updateComponents(s, (comps) =>
        comps.map((c) =>
          c.id === componentId ? { ...c, properties: { ...c.properties, [key]: value } } : c
        )
      )
    );
  },

  renameComponent: (componentId, name) => {
    set((s) =>
      updateComponents(s, (comps) =>
        comps.map((c) => (c.id === componentId ? { ...c, name } : c))
      )
    );
  },

  toggleComponent: (componentId) => {
    set((s) =>
      updateComponents(s, (comps) =>
        comps.map((c) => (c.id === componentId ? { ...c, enabled: !c.enabled } : c))
      )
    );
  },

  selectComponent: (id) => set({ selectedComponentId: id }),
  toggleGizmos: () => set((s) => ({ showGizmos: !s.showGizmos })),
  setPreviewSignal: (key, value) =>
    set((s) => ({ previewSignals: { ...s.previewSignals, [key]: value } })),
  setBoneNames: (names) => set({ boneNames: names }),
}));
