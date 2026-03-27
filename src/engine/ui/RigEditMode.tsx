"use client";
import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment, OrbitControls } from "@react-three/drei";
import { useRigEditStore } from "../store/RigEditStore";
import { getComponentType } from "../registry";
import ComponentList from "./ComponentList";
import ComponentInspector from "./ComponentInspector";
import SignalPreview from "./SignalPreview";
import RigRuntimeBridge from "../runtime/RigRuntimeBridge";

// Import puppet components to trigger registry registration
import "@/puppet/components/JawFlapComponent";
import "@/puppet/components/HeadMotionComponent";
import "@/engine/components/VerletChainComponent";

function SceneLights() {
  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[2, 4, 3]} intensity={1.2} castShadow />
      <pointLight position={[-2, 2, 2]} intensity={0.5} color="#ff6030" />
    </>
  );
}

export default function RigEditMode() {
  const isEditMode = useRigEditStore((s) => s.isEditMode);
  const activeConfigId = useRigEditStore((s) => s.activeConfigId);
  const rigConfigs = useRigEditStore((s) => s.rigConfigs);
  const selectedComponentId = useRigEditStore((s) => s.selectedComponentId);
  const showGizmos = useRigEditStore((s) => s.showGizmos);
  const isDirty = useRigEditStore((s) => s.isDirty);
  const boneNames = useRigEditStore((s) => s.boneNames);
  const store = useRigEditStore();

  if (!isEditMode) return null;

  const activeConfig = rigConfigs.find((c) => c.id === activeConfigId) ?? null;
  const selectedComponent = activeConfig?.components.find((c) => c.id === selectedComponentId) ?? null;
  const selectedTypeDef = selectedComponent ? getComponentType(selectedComponent.type) : null;

  // Signal provider for RigRuntimeBridge: reads preview signals each frame
  const signalProvider = () => useRigEditStore.getState().previewSignals;

  return (
    <div className="fixed inset-0 bg-black flex flex-col z-50">
      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-white/10 bg-black/80 shrink-0">
        <button
          onClick={() => store.exitEditMode()}
          className="text-white/50 hover:text-white text-sm px-2 py-1 rounded hover:bg-white/10 transition-colors"
        >
          ← Back
        </button>

        <span className="text-white/80 text-sm font-medium">
          {activeConfig?.name ?? "No Config"}
          {isDirty && <span className="text-orange-400 ml-1">•</span>}
        </span>

        <div className="flex-1" />

        <button
          onClick={() => store.toggleGizmos()}
          className={`text-xs px-2 py-1 rounded border transition-colors ${showGizmos ? "border-orange-400/60 text-orange-300 bg-orange-400/10" : "border-white/20 text-white/40 hover:text-white/70"}`}
        >
          Gizmos
        </button>

        <button
          onClick={() => store.saveConfig()}
          disabled={!isDirty}
          className="text-xs px-3 py-1 rounded bg-orange-500 hover:bg-orange-400 disabled:opacity-30 disabled:cursor-not-allowed text-white transition-colors"
        >
          Save
        </button>
      </div>

      {/* ── Main content ─────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Left panel ────────────────────────────────────────────────────── */}
        <div className="w-72 shrink-0 border-r border-white/10 flex flex-col bg-black/60 overflow-hidden">
          {activeConfig ? (
            <>
              {/* Component list */}
              <div className="flex-1 overflow-y-auto p-3">
                <div className="text-[10px] text-white/30 uppercase tracking-wider mb-2">Components</div>
                <ComponentList
                  components={activeConfig.components}
                  selectedId={selectedComponentId}
                  onSelect={(id) => store.selectComponent(id)}
                  onToggle={(id) => store.toggleComponent(id)}
                  onRemove={(id) => store.removeComponent(id)}
                  onReorder={(from, to) => store.reorderComponent(from, to)}
                  onAdd={(type) => store.addComponent(type)}
                />
              </div>

              {/* Divider */}
              <div className="border-t border-white/10" />

              {/* Inspector */}
              <div className="flex-1 overflow-y-auto p-3">
                {selectedComponent && selectedTypeDef ? (
                  <>
                    <div className="text-[10px] text-white/30 uppercase tracking-wider mb-3">Inspector</div>
                    <ComponentInspector
                      component={selectedComponent}
                      typeDef={selectedTypeDef}
                      boneNames={boneNames}
                      onPropertyChange={(key, value) =>
                        store.updateComponentProperty(selectedComponent.id, key, value)
                      }
                      onRename={(name) => store.renameComponent(selectedComponent.id, name)}
                      onToggle={() => store.toggleComponent(selectedComponent.id)}
                    />
                  </>
                ) : (
                  <div className="text-white/20 text-xs text-center py-4">
                    Select a component to inspect
                  </div>
                )}
              </div>
            </>
          ) : (
            <NoConfigPanel />
          )}
        </div>

        {/* ── 3D Viewport ───────────────────────────────────────────────────── */}
        <div className="flex-1 relative">
          {activeConfig?.modelPath ? (
            <Canvas
              camera={{ position: [0, 0.2, 9.2], fov: 40 }}
              className="w-full h-full"
              gl={{ antialias: true }}
            >
              <color attach="background" args={["#1a0a00"]} />
              <SceneLights />
              <Suspense fallback={null}>
                <RigRuntimeBridge
                  config={activeConfig}
                  signalProvider={signalProvider}
                  showGizmos={showGizmos}
                />
                <Environment preset="studio" />
              </Suspense>
              <OrbitControls />
            </Canvas>
          ) : (
            <div className="flex items-center justify-center h-full text-white/20 text-sm">
              Set a model path to preview
            </div>
          )}
        </div>

        {/* ── Right signal panel ────────────────────────────────────────────── */}
        <div className="w-56 shrink-0 border-l border-white/10 p-3 bg-black/60 overflow-y-auto">
          <SignalPreview />
        </div>
      </div>
    </div>
  );
}

function NoConfigPanel() {
  const store = useRigEditStore();
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 p-4">
      <p className="text-white/30 text-xs text-center">No rig config loaded</p>
      <button
        onClick={() => {
          const name = prompt("Rig name:");
          const modelPath = prompt("FBX path (e.g. /puppets/triumph/model.fbx):");
          if (name && modelPath) store.createNewConfig(name, modelPath);
        }}
        className="text-xs px-3 py-1.5 rounded bg-orange-500 hover:bg-orange-400 text-white transition-colors"
      >
        + New Config
      </button>
    </div>
  );
}
