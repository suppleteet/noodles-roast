"use client";
import type { ComponentInstance, ComponentTypeDef } from "../types";
import PropertyField from "./PropertyField";

interface Props {
  component: ComponentInstance;
  typeDef: ComponentTypeDef;
  boneNames: string[];
  onPropertyChange: (key: string, value: unknown) => void;
  onRename: (name: string) => void;
  onToggle: () => void;
}

export default function ComponentInspector({
  component,
  typeDef,
  boneNames,
  onPropertyChange,
  onRename,
  onToggle,
}: Props) {
  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center gap-2 pb-2 border-b border-white/10">
        <input
          type="checkbox"
          checked={component.enabled}
          onChange={onToggle}
          className="accent-orange-400 w-3.5 h-3.5 shrink-0"
        />
        <input
          type="text"
          value={component.name}
          onChange={(e) => onRename(e.target.value)}
          className="flex-1 bg-transparent border-b border-white/20 text-white/90 text-sm font-medium px-0 py-0.5 focus:outline-none focus:border-orange-400"
        />
        <span className="text-[10px] text-white/30 border border-white/10 rounded px-1.5 py-0.5 shrink-0">
          {typeDef.label}
        </span>
      </div>

      {/* Properties */}
      <div className="flex flex-col gap-3">
        {typeDef.propertyDefs.map((def) => (
          <PropertyField
            key={def.key}
            def={def}
            value={component.properties[def.key]}
            boneNames={boneNames}
            onChange={onPropertyChange}
          />
        ))}
      </div>
    </div>
  );
}
