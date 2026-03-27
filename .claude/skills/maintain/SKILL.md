---
name: maintain
description: Audits the project for drift between the codebase and its documentation, tests, and skills. Run this after adding features or merging changes to find what's out of sync. Read-only — reports findings and recommends actions, makes no changes.
---

Perform a full drift audit of `c:/Projects/Roastie`. Read files, glob directories, and grep as needed. Do not write or edit anything.

## Check 1 — Package Version Table in CLAUDE.md

Read `package.json` and `CLAUDE.md`. Compare every package in `dependencies` and `devDependencies` against the version table in CLAUDE.md.

Report:
- `[STALE]` for any package whose version range changed or is missing from CLAUDE.md
- `[NEW]` for packages in package.json not yet in the table
- `[REMOVED]` for packages in the table that no longer exist in package.json
- `[OK]` if all match

## Check 2 — AI Model Drift

Read `src/lib/constants.ts`. Compare `VISION_MODEL`, `ROAST_MODEL`, and `ELEVENLABS_VOICE_ID` against the model table in CLAUDE.md.

Report `[STALE]` if any value differs, `[OK]` if all match.

## Check 3 — Unit Test Coverage

Glob `src/lib/*.ts` (exclude `*.d.ts`). For each file, check whether a corresponding test exists in `src/__tests__/lib/`.

Glob `src/store/*.ts`. For each file, check whether a corresponding test exists in `src/__tests__/store/`.

Report `[MISSING]` for any source file with no test, `[OK]` for covered files.

## Check 4 — Store Test Completeness

Read `src/store/useSessionStore.ts`. Extract all action names from the store interface. Read `src/__tests__/store/useSessionStore.test.ts`. Check whether each action has at least one test `describe` or `it` block referencing it.

Report any actions that appear untested.

## Check 5 — E2E Coverage for API Routes

Glob `src/app/api/*/route.ts` to find all API routes. For each route, check whether any file in `e2e/` contains a `page.route('/api/[routename]'` mock or a test that exercises it.

Report `[MISSING]` for routes with no E2E coverage, `[OK]` for covered routes.

## Check 6 — Stale References in Skills

Read all `.claude/skills/*/SKILL.md` files. Check each skill for:
- Package version numbers mentioned explicitly — do they still match package.json?
- API method names mentioned (e.g., `ai.models.generateContent`) — are they still correct based on the current `@google/genai` version?
- Model IDs mentioned — do they match `constants.ts`?

Report `[STALE]` with specific line references for anything outdated.

## Check 7 — CLAUDE.md Invariants vs Codebase

Read `CLAUDE.md` key invariants section. For each invariant, verify it's still accurate:
1. Grep for any `useSessionStore(` calls inside `useFrame` callbacks — would violate invariant #1
2. Grep API routes for any `@anthropic-ai/sdk` imports — if found, invariant #2 needs updating
3. Grep `/api/tts` route for `elevenlabs` SDK usage — if found, invariant #3 needs updating
4. Grep store file for `create<` pattern — verify it still matches invariant #4

Report `[VIOLATED]` if an invariant is no longer accurate, `[OK]` if still holds.

---

## Output Format

```
## Maintenance Report — [today's date]

### CLAUDE.md Package Table
- [OK/STALE/NEW/REMOVED] ...

### AI Models
- [OK/STALE] ...

### Unit Tests
- [OK/MISSING] src/lib/[file].ts
- ...

### Store Test Completeness
- [OK/UNTESTED] action: [actionName]
- ...

### E2E Coverage
- [OK/MISSING] /api/[route]
- ...

### Skill References
- [OK/STALE] .claude/skills/[skill]/SKILL.md — [description]
- ...

### CLAUDE.md Invariants
- [OK/VIOLATED] Invariant #N: [description]
- ...

### Recommended Actions (prioritized by impact)
1. [most important]
2. ...
3. ...
```

This is a read-only report. To implement changes, start a new conversation or ask an agent to apply the specific fix.
