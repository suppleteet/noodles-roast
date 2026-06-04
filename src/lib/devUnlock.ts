/**
 * Dev-feature unlock for production builds.
 *
 * The landing-screen flow dropdown, debug overlays, and other dev-only UI
 * are normally gated by `process.env.NODE_ENV !== "production"`. That gate
 * is correct for end users but inconvenient when iterating on the live
 * Vercel deployment from a phone — there's no terminal handy to flip
 * NODE_ENV, and exposing those controls to all users isn't acceptable.
 *
 * This module adds a client-side override: tap the build-time stamp 5x
 * within 2.5s to flip a localStorage flag. All `IS_DEV` checks consult
 * `useDevUnlock()` (or `getDevUnlocked()` for non-React code), so the gated
 * UI appears as soon as the flag flips. Same gesture re-locks it.
 *
 * On real dev builds the override is a no-op — `isBuiltInDev()` already
 * returns true, and the unlock just stays a redundant boolean.
 */
import { useEffect, useState } from "react";

const STORAGE_KEY = "roastie:devUnlocked";
const EVENT = "roastie:dev-unlock-changed";

function readLocalUnlock(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function isBuiltInDev(): boolean {
  return process.env.NODE_ENV !== "production";
}

/**
 * Synchronous check usable from non-React code (e.g., timing log filters).
 * Returns true on dev builds OR when the user has unlocked via tap gesture.
 */
export function getDevUnlocked(): boolean {
  return isBuiltInDev() || readLocalUnlock();
}

/**
 * Flip the localStorage flag and notify subscribers. Returns the NEW state
 * (true = now unlocked, false = now locked). No-op on the server.
 */
export function toggleDevUnlock(): boolean {
  if (typeof window === "undefined") return false;
  const next = !readLocalUnlock();
  try {
    if (next) window.localStorage.setItem(STORAGE_KEY, "1");
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage may be disabled (private browsing) — toggle is in-memory only
    // for the rest of the page lifetime.
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
  return next;
}

/**
 * React hook returning the current dev-unlocked state. Initial render is
 * false to match SSR; flips to the localStorage value on hydration. Updates
 * on toggle events so multiple subscribed components stay in sync.
 */
export function useDevUnlock(): boolean {
  const [unlocked, setUnlocked] = useState(false);
  useEffect(() => {
    setUnlocked(getDevUnlocked());
    const onChange = () => setUnlocked(getDevUnlocked());
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);
  return unlocked;
}
