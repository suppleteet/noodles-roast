---
name: test
description: Runs the full test suite for RoastMe. Always runs TypeScript typecheck and Vitest unit tests. Automatically decides whether to also run Playwright E2E tests based on which files were recently changed. Reports a CLEAN or ISSUES verdict.
---

Run the following in order inside `c:/Projects/RoastMe`:

## Step 1 — TypeScript Typecheck

```
npx tsc --noEmit 2>&1
```

Report: PASS if exit code 0, or list all type errors with file:line references.

## Step 2 — Vitest Unit Tests

```
npm test -- --reporter=verbose 2>&1
```

Report: X passed, Y failed, Z skipped. For each failure: test name, file, error message, expected vs received.

## Step 3 — Decide Whether to Run Playwright

Check which files were recently changed using `git diff --name-only HEAD 2>/dev/null` or `git status --short`. If git is not available, check which files were most recently written in this session.

**Run Playwright if any changed file matches:**
- `src/components/ui/**`
- `src/components/session/**`
- `src/app/page.tsx`
- `src/app/layout.tsx`
- `src/app/api/**`

**Skip Playwright if all changed files are:**
- `src/lib/**`
- `src/store/**`
- `*.config.*`
- `*.d.ts`
- Type-only changes

**When ambiguous, run Playwright.**

State your decision and reason in one line before running (or skipping).

## Step 4 — Playwright E2E (if applicable)

First check if the dev server is running: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null`

- If server responds: run `npx playwright test --reporter=list 2>&1`
- If server is not running: report "⚠ Dev server not running on :3000 — skipping Playwright. Run `npm run dev` first."

## Final Verdict

```
─────────────────────────────
CLEAN  ✓  typecheck + N unit tests passed [+ N e2e passed]
─────────────────────────────
```

or

```
─────────────────────────────
ISSUES ✗
  TypeScript: 2 errors
  Unit tests: 1 failed (spring.test.ts > converges to target)
─────────────────────────────
```
