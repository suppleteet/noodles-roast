/**
 * Central gate for developer-only UI.
 *
 * Production builds deliberately have no browser-side override. This keeps
 * model selectors, mock controls, timing/transcript panels, rig tools, and
 * amplitude meters off Vercel even if an old `roastie:devUnlocked`
 * localStorage value remains from builds that supported tap-to-unlock.
 */

export function isBuiltInDev(): boolean {
  return process.env.NODE_ENV !== "production";
}

/** Synchronous check usable from non-React code. */
export function getDevUnlocked(): boolean {
  return isBuiltInDev();
}

/** Hook-shaped wrapper retained for existing client components. */
export function useDevUnlock(): boolean {
  return isBuiltInDev();
}
