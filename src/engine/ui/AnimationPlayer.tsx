"use client";
import { useRigEditStore } from "../store/RigEditStore";

/**
 * Edit-mode panel: dropdown of animation clips from the loaded FBX,
 * play/stop button, and label showing which clip is currently playing.
 */
export default function AnimationPlayer() {
  const clipNames = useRigEditStore((s) => s.animationClipNames);
  const selected = useRigEditStore((s) => s.selectedClipName);
  const playing = useRigEditStore((s) => s.playingClipName);
  const store = useRigEditStore();

  if (clipNames.length === 0) {
    return (
      <div className="text-white/20 text-[10px] text-center py-2">
        No animation clips in FBX
      </div>
    );
  }

  const isPlaying = playing !== null;

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[10px] text-white/30 uppercase tracking-wider">Animation</div>

      {/* Clip dropdown */}
      <select
        value={selected ?? ""}
        onChange={(e) => store.selectClip(e.target.value || null)}
        className="bg-black/60 border border-white/20 rounded text-white text-xs px-2 py-1.5 w-full"
      >
        {clipNames.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>

      {/* Play / Stop button */}
      <button
        onClick={() => {
          if (isPlaying) {
            store.stopClip();
          } else if (selected) {
            store.playClip(selected);
          }
        }}
        disabled={!selected && !isPlaying}
        className={`text-xs px-3 py-1.5 rounded font-medium transition-colors w-full ${
          isPlaying
            ? "bg-red-500/80 hover:bg-red-400/80 text-white"
            : "bg-green-600/80 hover:bg-green-500/80 text-white disabled:opacity-30 disabled:cursor-not-allowed"
        }`}
      >
        {isPlaying ? "Stop" : "Play"}
      </button>

      {/* Now playing label */}
      <div className="text-[10px] font-mono text-center h-4">
        {playing ? (
          <span className="text-green-400">
            Playing: {playing}
          </span>
        ) : (
          <span className="text-white/20">Stopped</span>
        )}
      </div>
    </div>
  );
}
