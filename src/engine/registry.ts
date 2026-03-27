import type { ComponentTypeDef, ComponentInstance, SignalDef } from "./types";

const COMPONENT_REGISTRY = new Map<string, ComponentTypeDef>();

export function registerComponentType(def: ComponentTypeDef): void {
  if (COMPONENT_REGISTRY.has(def.type)) {
    console.warn(`[RigEngine] Component type "${def.type}" already registered — overwriting`);
  }
  COMPONENT_REGISTRY.set(def.type, def);
}

export function getComponentType(type: string): ComponentTypeDef | undefined {
  return COMPONENT_REGISTRY.get(type);
}

export function getRegisteredTypes(): ComponentTypeDef[] {
  return Array.from(COMPONENT_REGISTRY.values());
}

/**
 * Create a new ComponentInstance from a registered type, populating
 * all properties from their PropertyDef defaults.
 */
export function createComponentInstance(type: string): ComponentInstance {
  const def = COMPONENT_REGISTRY.get(type);
  if (!def) throw new Error(`[RigEngine] Unknown component type: "${type}"`);

  const properties: Record<string, unknown> = {};
  for (const propDef of def.propertyDefs) {
    // Deep-clone array/object defaults to avoid shared references
    properties[propDef.key] =
      typeof propDef.default === "object" && propDef.default !== null
        ? JSON.parse(JSON.stringify(propDef.default))
        : propDef.default;
  }

  return {
    id: crypto.randomUUID(),
    type,
    name: def.label,
    enabled: true,
    properties,
  };
}

/**
 * Collect all unique SignalDefs across every registered component type.
 * Used by SignalPreview to auto-generate preview sliders.
 */
export function getAllSignalDefs(): SignalDef[] {
  const seen = new Map<string, SignalDef>();
  for (const def of COMPONENT_REGISTRY.values()) {
    for (const sig of def.signals) {
      if (!seen.has(sig.key)) seen.set(sig.key, sig);
    }
  }
  return Array.from(seen.values());
}
