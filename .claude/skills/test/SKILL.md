---
name: test
description: Runs the full test suite for RoastMe. Always runs TypeScript typecheck and Vitest unit tests. Automatically decides whether to also run Playwright E2E tests based on which files were recently changed. Reports a CLEAN or ISSUES verdict.
---

Run the following in order inside `c:/Projects/Roastie`:

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
- `src/lib/comedianBrain.ts`
- `src/lib/comedianBrainConfig.ts`
- `src/lib/comedianConfig.ts`
- `e2e/**`

**Skip Playwright if all changed files are:**
- `src/lib/**` (except comedianBrain/Config files above)
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

## Step 5 — Roast Run (always run when dev server is up, regardless of changed files)

The roast-run test exercises the full brain state machine through 6 realistic Q&A cycles using the debug text input. Always run this when the dev server is available — it catches bugs that unit tests miss.

```
npx playwright test e2e/roast-run.spec.ts --reporter=list 2>&1
```

After it completes (pass or fail), **always read `.debug/last-session.json`** and analyze:

```
Read c:\Projects\Roastie\.debug\last-session.json
```

Look for:
- Double consecutive `brain: → <state>` lines (state machine bug)
- `stream delivered nothing` / `enterDelivering with nothing` (API returned 0 jokes)
- Long gaps between state transitions (puppet went silent)
- `error` lines (API or WebSocket failures)
- Missing puppet speech for a user answer (no `🎭` after a `👤` within 2 transitions)
- Brain stuck in `prodding` more than once per cycle

Report findings as a bulleted list even if the test passed — bugs show up in the log even when assertions don't catch them.

## Final Verdict

```
─────────────────────────────
CLEAN  ✓  typecheck + N unit tests passed [+ N e2e passed] [+ roast-run passed, N issues found]
─────────────────────────────
```

or

```
─────────────────────────────
ISSUES ✗
  TypeScript: 2 errors
  Unit tests: 1 failed (spring.test.ts > converges to target)
  Roast run: double transition → ask_question at +45.2s
─────────────────────────────
```
