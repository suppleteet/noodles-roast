"use client";

interface Props {
  boneNames: string[];
  value: string;
  onChange: (value: string) => void;
}

export default function BoneSelector({ boneNames, value, onChange }: Props) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-black/60 border border-white/20 rounded text-white/80 text-xs px-2 py-1 cursor-pointer"
    >
      <option value="">-- select bone --</option>
      {boneNames.map((name) => (
        <option key={name} value={name}>{name}</option>
      ))}
    </select>
  );
}
