"use client";
import { useRef, useEffect } from "react";
import * as THREE from "three";
import type { GizmoDrawCall } from "./types";

interface Props {
  drawCalls: GizmoDrawCall[];
}

/**
 * R3F component that renders gizmo lines and spheres.
 * All materials use depthTest: false so they render on top of the scene.
 */
export default function GizmoRenderer({ drawCalls }: Props) {
  const linesRef = useRef<THREE.LineSegments>(null);
  const spheresGroupRef = useRef<THREE.Group>(null);

  const lines = drawCalls.filter((d): d is Extract<GizmoDrawCall, { type: "line" }> => d.type === "line");
  const spheres = drawCalls.filter((d): d is Extract<GizmoDrawCall, { type: "sphere" }> => d.type === "sphere");

  // Update line geometry whenever drawCalls change
  useEffect(() => {
    const mesh = linesRef.current;
    if (!mesh) return;

    const positions: number[] = [];
    const colors: number[] = [];
    const c = new THREE.Color();

    for (const l of lines) {
      positions.push(l.from.x, l.from.y, l.from.z);
      positions.push(l.to.x, l.to.y, l.to.z);
      c.set(l.color);
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }

    const geo = mesh.geometry;
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }, [lines]);

  return (
    <>
      {/* Lines */}
      <lineSegments ref={linesRef} renderOrder={999}>
        <bufferGeometry />
        <lineBasicMaterial
          vertexColors
          depthTest={false}
          transparent
          opacity={0.85}
        />
      </lineSegments>

      {/* Spheres */}
      <group ref={spheresGroupRef} renderOrder={999}>
        {spheres.map((s, i) => (
          <mesh key={i} position={s.center.toArray()}>
            <sphereGeometry args={[s.radius, 8, 8]} />
            <meshBasicMaterial color={s.color} depthTest={false} transparent opacity={0.9} />
          </mesh>
        ))}
      </group>
    </>
  );
}
