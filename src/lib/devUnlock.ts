import { useSyncExternalStore } from "react";

/**
 * Central gate for developer-only UI.
 *
 * Every page load starts locked, including local development. The build
 * timestamp calls unlockDevUi() for the current browser session. Nothing is
 * persisted, so debug controls never leak into the next visit by default.
 */

let sessionUnlocked = false;
const listeners = new Set<() => void>();

export function isBuiltInDev(): boolean {
  return process.env.NODE_ENV !== "production";
}

function emitChange(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function unlockDevUi(): void {
  if (sessionUnlocked) return;
  sessionUnlocked = true;
  emitChange();
}

export function lockDevUi(): void {
  if (!sessionUnlocked) return;
  sessionUnlocked = false;
  emitChange();
}

/** Synchronous check usable from non-React code. */
export function getDevUnlocked(): boolean {
  return sessionUnlocked;
}

/** Reactive gate shared by all client components that expose developer UI. */
export function useDevUnlock(): boolean {
  return useSyncExternalStore(subscribe, getDevUnlocked, () => false);
}
