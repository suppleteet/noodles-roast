"use client";
import React, { useRef, Suspense, createContext, useContext } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { useMotionState } from "./useMotionState";
import { useSpringPhysics } from "./useSpringPhysics";
import type { SpringTargets } from "./useSpringPhysics";
import { useSessionStore } from "@/store/useSessionStore";
import type { ExperienceType } from "@/store/useSessionStore";

const R = 1.0; // head sphere radius

// ── Magic triangle eye placement ───────────────────────────────────────────
// Eyes nearly touching, close to nose, converging on a shared focal point
// (classic Muppet "magic triangle", Don Sahlin).
//
// Sphere surface positions: x=±0.15, y=0.52, z=0.84
//   |pos| = √(0.0225 + 0.2704 + 0.7056) = 0.9985 ≈ 1.0  ✓
//
// Eye dome rotation: setFromUnitVectors(Y, normalize(eyePos))
//   so the flat base is flush with the sphere and the dome protrudes outward.
//   Left  q=[0.482, 0, 0.086, 0.872] → Euler XYZ ≈ [1.004, -0.083, 0.151]
//   Right q=[0.482, 0,-0.086, 0.872] → Euler XYZ ≈ [1.004,  0.083,-0.151]
const LEFT_EYE_POS:  [number, number, number] = [-0.15, 0.52, 0.84];
const RIGHT_EYE_POS: [number, number, number] = [ 0.15, 0.52, 0.84];
const LEFT_EYE_ROT:  [number, number, number] = [1.004, -0.083,  0.151];
const RIGHT_EYE_ROT: [number, number, number] = [1.004,  0.083, -0.151];

// Pupil: sphere fixed in each eye's local space at the point where the head's
// local +Z axis intersects the white dome.
//
// Computed: R_eye⁻¹ · [0,0,1] → normalize → × 0.207 (15% poke-out depth)
//   Left  R⁻¹·[0,0,1] ≈ [0.172, 0.826, 0.538] → × 0.207 = [ 0.036, 0.171, 0.111]
//   Right R⁻¹·[0,0,1] ≈ [-0.172, 0.826, 0.538] → × 0.207 = [-0.036, 0.171, 0.111]
const PUPIL_RADIUS = 0.133;
const LEFT_PUPIL_POS:  [number, number, number] = [ 0.036, 0.171, 0.111];
const RIGHT_PUPIL_POS: [number, number, number] = [-0.036, 0.171, 0.111];

// ── Palette ───────────────────────────────────────────────────────────────────
// Two palettes — the experienceType picks one at session start. Roast keeps the
// existing purple/dark-red look; Toast shifts everything warm-gold + amber
// (drunk woman at a wedding, champagne / gold-foil energy).

interface PuppetPalette {
  head: string;
  eyeWhite: string;
  pupil: string;
  nose: string;
  brow: string;
  mouth: string;
  tongue: string;
  /** Hemisphere top-eyelid color (Toast only — Roast renders no eyelid). */
  eyelid: string;
}

const ROAST_PALETTE: PuppetPalette = {
  head: "#5a1a8a",       // purple
  eyeWhite: "#f0f0f0",
  pupil: "#0a0a0a",
  nose: "#f5e560",       // light yellow
  brow: "#241430",       // dark plum — a touch brighter than near-black
  mouth: "#3a0510",      // dark red interior cavity
  tongue: "#d44d61",     // light red tongue
  eyelid: "#5a1a8a",     // unused in roast — eyelids only render in toast
};

const TOAST_PALETTE: PuppetPalette = {
  head: "#e8c547",       // warm gold — drunk-wedding-toaster yellow
  eyeWhite: "#fbf6e6",   // slightly creamier white to play with the gold head
  pupil: "#1a1208",      // warm near-black (less harsh than pure black)
  nose: "#d49a2a",       // deeper amber for nose contrast against the gold head
  brow: "#000000",       // unused in toast — brows are hidden
  mouth: "#b8520a",      // warm amber-brown mouth interior
  tongue: "#e09060",     // peachy tongue
  eyelid: "#d49a2a",     // amber droopy eyelid sitting over each eye
};

/** Resolved per-experience context — palette + experienceType for branch
 *  decisions (e.g. "should I render eyelids? eyebrows?"). Threaded via React
 *  context so MouthHemispheres + Nose don't need their own props. Default
 *  is the Roast palette for safety when no provider is mounted (rig-edit
 *  mode etc.). */
interface PuppetContextValue {
  palette: PuppetPalette;
  experienceType: ExperienceType;
}

const PuppetCtx = createContext<PuppetContextValue>({
  palette: ROAST_PALETTE,
  experienceType: "roast",
});

function usePuppetCtx(): PuppetContextValue {
  return useContext(PuppetCtx);
}

interface Props {
  modelUrl?: string | null;
}

export default function PuppetCharacter({ modelUrl = null }: Props) {
  const groupRef = useRef<THREE.Group>(null);

  // Subscribe to experienceType so the puppet swaps palette + geometry
  // when the user picks Roast vs Toast. Hook-selector subscription is OK
  // here — invariant #1 only forbids selectors INSIDE useFrame.
  const experienceType = useSessionStore((s) => s.experienceType);
  const palette = experienceType === "toast" ? TOAST_PALETTE : ROAST_PALETTE;

  const targets = useRef<SpringTargets>({ pitch: 0, yaw: 0, roll: 0.05, bobY: -0.03 });
  const { stiffnessRef, dampingRef } = useMotionState(targets);
  const springs = useSpringPhysics(stiffnessRef, dampingRef, targets);

  useFrame(() => {
    const s = springs.current;
    if (!groupRef.current) return;
    groupRef.current.rotation.x = s.pitch.value;
    groupRef.current.rotation.y = s.yaw.value;
    groupRef.current.rotation.z = s.roll.value;
    groupRef.current.position.y = 0;
  });

  return (
    <PuppetCtx.Provider value={{ palette, experienceType }}>
      <group ref={groupRef}>
        {modelUrl ? (
          <GLBErrorBoundary fallback={<ProceduralHead />}>
            <Suspense fallback={<ProceduralHead />}>
              <GLBModel modelUrl={modelUrl} />
            </Suspense>
          </GLBErrorBoundary>
        ) : (
          <ProceduralHead />
        )}
      </group>
    </PuppetCtx.Provider>
  );
}

// ── GLB loader — unconditional hook call, Suspense handles loading ────────────
function GLBModel({ modelUrl }: { modelUrl: string }) {
  const { scene } = useGLTF(modelUrl);
  return <primitive object={scene} scale={1} />;
}

// ── Error boundary for GLB load failures (404, parse errors, etc.) ───────────
class GLBErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() { return this.state.hasError ? this.props.fallback : this.props.children; }
}

// ── Procedural puppet head (fallback when no GLB is available) ────────────────
function ProceduralHead() {
  const { palette, experienceType } = usePuppetCtx();
  const isToast = experienceType === "toast";
  return (
    // Eyes and nose are children of MouthHemispheres so they tilt with the top jaw
    <MouthHemispheres>
      {/* ── Left eye ── */}
      <group position={LEFT_EYE_POS} rotation={LEFT_EYE_ROT}>
        <mesh>
          <sphereGeometry args={[0.30, 40, 40, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color={palette.eyeWhite} roughness={0.08} />
        </mesh>
        <mesh position={LEFT_PUPIL_POS}>
          <sphereGeometry args={[PUPIL_RADIUS, 24, 24]} />
          <meshStandardMaterial color={palette.pupil} roughness={0.3} />
        </mesh>
        {/* Toast eyelid: top-third hemisphere sitting on the upper surface
            of the eye dome, colored to match the head so it reads as a
            heavy droopy "had a few drinks" lid. Local +Y of the eye group
            is already the "top of the eyeball" since the dome was rotated
            so its base sits flush with the head sphere. Slightly larger
            radius than the eyeball (0.305 vs 0.30) so there's no
            z-fight along the seam. */}
        {isToast && (
          <mesh position={[0, 0.05, 0]}>
            <sphereGeometry args={[0.305, 40, 16, 0, Math.PI * 2, 0, Math.PI / 3]} />
            <meshStandardMaterial color={palette.eyelid} roughness={1.0} metalness={0} />
          </mesh>
        )}
      </group>

      {/* ── Right eye ── */}
      <group position={RIGHT_EYE_POS} rotation={RIGHT_EYE_ROT}>
        <mesh>
          <sphereGeometry args={[0.30, 40, 40, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color={palette.eyeWhite} roughness={0.08} />
        </mesh>
        <mesh position={RIGHT_PUPIL_POS}>
          <sphereGeometry args={[PUPIL_RADIUS, 24, 24]} />
          <meshStandardMaterial color={palette.pupil} roughness={0.3} />
        </mesh>
        {isToast && (
          <mesh position={[0, 0.05, 0]}>
            <sphereGeometry args={[0.305, 40, 16, 0, Math.PI * 2, 0, Math.PI / 3]} />
            <meshStandardMaterial color={palette.eyelid} roughness={1.0} metalness={0} />
          </mesh>
        )}
      </group>

      {/* ── Nose ── */}
      <Nose />

      {/* ── Eyebrows (Roast only) — Toast skips these entirely; the eyelids
            above are the brow region's visual focus in that mode. ── */}
      {!isToast && (
        <>
          <mesh position={[-0.22, 0.82, 0.85]} rotation={[0.9, 0, Math.PI / 2]}>
            <capsuleGeometry args={[0.12, 0.18, 6, 12]} />
            <meshStandardMaterial color={palette.brow} roughness={1.0} metalness={0} />
          </mesh>
          <mesh position={[0.22, 0.82, 0.85]} rotation={[0.9, 0, Math.PI / 2]}>
            <capsuleGeometry args={[0.12, 0.18, 6, 12]} />
            <meshStandardMaterial color={palette.brow} roughness={1.0} metalness={0} />
          </mesh>
        </>
      )}
    </MouthHemispheres>
  );
}

// ── Mouth: top and bottom hemispheres counter-rotate; eyes/nose ride the top ─
//
// Open-amount → rotation mapping:
//   eased = pow(amp, 1.3)        // small amps stay subtle, the curve only
//                                // gets aggressive past ~0.6
//   bottom.x =  eased * MAX_JAW  // MAX_JAW caps loud talking from gaping wide
//   top.x    = -eased * MAX_JAW * TOP_RANGE_RATIO
const MAX_JAW = 0.55;          // was effectively 1.0 — felt too gaping
const TOP_RANGE_RATIO = 0.4;   // unchanged — top moves 40% as much as bottom
const JAW_CURVE_EXPONENT = 1.3;

function MouthHemispheres({ children }: { children?: React.ReactNode }) {
  const { palette } = usePuppetCtx();
  const topGroupRef    = useRef<THREE.Group>(null);
  const bottomGroupRef = useRef<THREE.Group>(null);
  const openAmt        = useRef(0);

  useFrame(() => {
    const amp = useSessionStore.getState().audioAmplitude;
    // Curve + cap the TARGET (not the smoothed value) so loud passages don't
    // stay gaping wide-open. Smoothing then handles the temporal dynamics on
    // top of the already-shaped target.
    const target = Math.pow(Math.max(0, amp), JAW_CURVE_EXPONENT) * MAX_JAW;
    // Fast attack (0.5), slower release (0.15) for snappy but smooth mouth
    const speed = target > openAmt.current ? 0.5 : 0.15;
    openAmt.current += (target - openAmt.current) * speed;

    if (bottomGroupRef.current) bottomGroupRef.current.rotation.x = openAmt.current;
    if (topGroupRef.current)    topGroupRef.current.rotation.x    = -openAmt.current * TOP_RANGE_RATIO;

    // Debug bars — write to global for HUD overlay to read
    if (typeof window !== "undefined") {
      (window as unknown as Record<string, number>).__DEBUG_AMP__ = amp;
      (window as unknown as Record<string, number>).__DEBUG_MOUTH__ = openAmt.current;
    }
  });

  return (
    <>

      {/* Top hemisphere — eyes and nose are children so they tilt with it.
          The flat circular opening at the equator is capped by a red disc,
          so each hemisphere reads as a SOLID half-ball. When the jaw
          opens, the two discs split apart and you see them face-on as the
          inside of the mouth. */}
      <group ref={topGroupRef}>
        <mesh>
          <sphereGeometry args={[R, 64, 64, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color={palette.head} roughness={1.0} metalness={0} />
        </mesh>
        {/* Red disc cap — fills the flat opening at the bottom of the top hemisphere */}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <circleGeometry args={[R, 48]} />
          <meshStandardMaterial color={palette.mouth} roughness={1.0} metalness={0} side={THREE.DoubleSide} />
        </mesh>
        {children}
      </group>

      {/* Bottom hemisphere — tongue is a child so it follows the jaw down */}
      <group ref={bottomGroupRef}>
        <mesh>
          <sphereGeometry args={[R * 0.95, 64, 64, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} />
          <meshStandardMaterial color={palette.head} roughness={1.0} metalness={0} />
        </mesh>
        {/* Red disc cap — fills the flat opening at the top of the bottom hemisphere */}
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[R * 0.95, 48]} />
          <meshStandardMaterial color={palette.mouth} roughness={1.0} metalness={0} side={THREE.DoubleSide} />
        </mesh>
        {/* Tongue: large, very flat ellipsoid resting on top of the bottom
            disc, tilted slightly forward. meshLambertMaterial → pure
            diffuse, no specular lobe at all (matches the felt look of
            the rest of the head). */}
        <mesh position={[0, 0.03, 0.30]} rotation={[-0.25, 0, 0]} scale={[0.90, 0.10, 1.05]}>
          <sphereGeometry args={[0.32, 32, 24]} />
          <meshLambertMaterial color={palette.tongue} />
        </mesh>
      </group>
    </>
  );
}

// ── Static nose ──────────────────────────────────────────────────────────────
function Nose() {
  const { palette } = usePuppetCtx();
  return (
    <mesh position={[0, 0.18, 0.95]} scale={[0.88, 1.12, 0.80]}>
      <sphereGeometry args={[0.34, 40, 40]} />
      <meshStandardMaterial color={palette.nose} roughness={1.0} metalness={0} />
    </mesh>
  );
}
