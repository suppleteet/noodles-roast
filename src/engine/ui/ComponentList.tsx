"use client";
import { useRef } from "react";
import type { ComponentInstance } from "../types";
import { getRegisteredTypes } from "../registry";

interface Props {
  components: ComponentInstance[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onAdd: (type: string) => void;
}

export default function ComponentList({
  components,
  selectedId,
  onSelect,
  onToggle,
  onRemove,
  onReorder,
  onAdd,
}: Props) {
  const dragIndex = useRef<number | null>(null);
  const registeredTypes = getRegisteredTypes();

  // Group types by category
  const categories = Array.from(new Set(registeredTypes.map((t) => t.category)));

  const handleDragStart = (index: number) => {
    dragIndex.current = index;
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex.current === null || dragIndex.current === index) return;
    onReorder(dragIndex.current, index);
    dragIndex.current = index;
  };

  const handleDragEnd = () => {
    dragIndex.current = null;
  };

  return (
    <div className="flex flex-col gap-1">
      {/* Component rows */}
      {components.map((comp, i) => (
        <div
          key={comp.id}
          draggable
          onDragStart={() => handleDragStart(i)}
          onDragOver={(e) => handleDragOver(e, i)}
          onDragEnd={handleDragEnd}
          onClick={() => onSelect(comp.id)}
          className={`flex items-center gap-1.5 px-2 py-1.5 rounded cursor-pointer select-none group transition-colors
            ${selectedId === comp.id ? "bg-orange-500/20 border border-orange-500/40" : "hover:bg-white/5 border border-transparent"}`}
        >
          {/* Drag handle */}
          <span className="text-white/20 group-hover:text-white/40 cursor-grab text-sm leading-none">⠿</span>

          {/* Enabled toggle */}
          <input
            type="checkbox"
            checked={comp.enabled}
            onChange={(e) => { e.stopPropagation(); onToggle(comp.id); }}
            className="accent-orange-400 w-3 h-3 shrink-0 cursor-pointer"
          />

          {/* Name */}
          <span className={`flex-1 text-xs truncate ${comp.enabled ? "text-white/80" : "text-white/30"}`}>
            {comp.name}
          </span>

          {/* Type badge */}
          <span className="text-[9px] text-white/25 border border-white/10 rounded px-1 shrink-0">
            {comp.type}
          </span>

          {/* Delete */}
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(comp.id); }}
            className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-red-400 text-xs leading-none px-0.5 transition-opacity"
          >
            ×
          </button>
        </div>
      ))}

      {components.length === 0 && (
        <div className="text-white/20 text-xs text-center py-4">No components yet</div>
      )}

      {/* Add Component */}
      <div className="mt-2 pt-2 border-t border-white/10">
        <select
          value=""
          onChange={(e) => { if (e.target.value) onAdd(e.target.value); }}
          className="w-full bg-black/60 border border-white/20 rounded text-white/60 text-xs px-2 py-1.5 cursor-pointer"
        >
          <option value="">+ Add Component</option>
          {categories.map((cat) => (
            <optgroup key={cat} label={cat.charAt(0).toUpperCase() + cat.slice(1)}>
              {registeredTypes
                .filter((t) => t.category === cat)
                .map((t) => (
                  <option key={t.type} value={t.type}>{t.label}</option>
                ))}
            </optgroup>
          ))}
        </select>
      </div>
    </div>
  );
}
