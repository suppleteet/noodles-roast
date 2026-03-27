import type { RigConfig } from "../types";

export const CONFIG_VERSION = 1;
const KEY_PREFIX = "rig-config-";

export function serializeRigConfig(config: RigConfig): string {
  return JSON.stringify({ ...config, _version: CONFIG_VERSION });
}

export function deserializeRigConfig(json: string): RigConfig {
  const parsed = JSON.parse(json) as Partial<RigConfig> & { _version?: number };

  // Version migration hook — add cases as the schema evolves
  const version = parsed._version ?? 0;
  if (version < CONFIG_VERSION) {
    console.info(`[configPersistence] Migrating rig config from v${version} to v${CONFIG_VERSION}`);
    // Future: apply migrations here
  }

  if (!parsed.id || !parsed.name || !Array.isArray(parsed.components)) {
    throw new Error("[configPersistence] Invalid rig config: missing required fields");
  }

  return {
    _version: CONFIG_VERSION,
    id: parsed.id,
    name: parsed.name,
    modelPath: parsed.modelPath ?? "",
    components: parsed.components,
  };
}

export function listSavedConfigIds(): string[] {
  if (typeof localStorage === "undefined") return [];
  const ids: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(KEY_PREFIX)) ids.push(key.slice(KEY_PREFIX.length));
  }
  return ids;
}

export function saveRigConfigToStorage(config: RigConfig): void {
  localStorage.setItem(KEY_PREFIX + config.id, serializeRigConfig(config));
}

export function loadRigConfigFromStorage(id: string): RigConfig | null {
  const json = localStorage.getItem(KEY_PREFIX + id);
  if (!json) return null;
  try {
    return deserializeRigConfig(json);
  } catch (e) {
    console.error("[configPersistence] Failed to load config:", e);
    return null;
  }
}

export function deleteRigConfigFromStorage(id: string): void {
  localStorage.removeItem(KEY_PREFIX + id);
}
