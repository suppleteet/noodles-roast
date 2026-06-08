/**
 * Pure helpers for normalizing an LLM-generated video filename.
 *
 * Lives outside `src/app/api/name-video/` because Next.js App Router route
 * files can only export reserved names (HTTP methods, `config`, etc.) —
 * exporting extra helpers from a route.ts breaks the production build.
 */

/** Strip everything except [A-Za-z0-9], split CamelCase runs into tokens. */
export function tokenize(raw: string): string[] {
  // Split on underscores, spaces, hyphens, and case-boundaries.
  return raw
    .replace(/[^A-Za-z0-9_\s-]/g, "")
    .split(/[_\s-]+/)
    .flatMap((chunk) => chunk.split(/(?=[A-Z])/))
    .filter(Boolean);
}

/** Title-case a single token: "shitty" -> "Shitty". */
export function titleCase(tok: string): string {
  if (!tok) return tok;
  return tok[0]!.toUpperCase() + tok.slice(1).toLowerCase();
}

/**
 * Filename prefix for each experience type. "Roastie_" for the standard
 * roast, "Toastie_" for the drunk-toast variant. Kept as a constant map so
 * the route + fallback both stay in sync.
 */
export const FILENAME_PREFIX: Record<"roast" | "toast", string> = {
  roast: "Roastie",
  toast: "Toastie",
};

/**
 * Take the LLM's raw response (which may include quotes, prefixes, extra prose)
 * and normalize to `<Prefix>_<2-4 PascalCase tokens>`. Returns null if it can't
 * be salvaged — caller falls back.
 */
export function sanitizeFilename(
  raw: string,
  experienceType: "roast" | "toast" = "roast",
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().split(/\r?\n/)[0]?.trim() ?? "";
  if (!trimmed) return null;
  const prefix = FILENAME_PREFIX[experienceType];
  // Strip a leading "Roastie_" or "Toastie_" if the LLM already prepended one.
  const body = trimmed
    .replace(/^["']?(roastie|toastie)[_\s-]*/i, "")
    .replace(/["']$/, "");
  const tokens = tokenize(body).slice(0, 4);
  if (tokens.length === 0) return null;
  const pascal = tokens.map(titleCase).join("");
  if (pascal.length < 2 || pascal.length > 64) return null;
  return `${prefix}_${pascal}`;
}

export function fallbackName(
  userName?: string | null,
  experienceType: "roast" | "toast" = "roast",
): string {
  const safeName = (userName ?? "").replace(/[^A-Za-z0-9]/g, "");
  const base = safeName ? titleCase(safeName) : "Anonymous";
  const ts = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 12); // "202605231423"
  const prefix = FILENAME_PREFIX[experienceType];
  const verb = experienceType === "toast" ? "Toast" : "Roast";
  return `${prefix}_${base}${verb}${ts}`;
}
