---
name: wrapup
description: All-in-one finish line — runs code review, then maintenance audit, then full test suite sequentially. Use after completing a feature or before committing.
---

Run all three checks in sequence. Each step must complete before the next begins.

## Step 1 — Maintenance Audit

Use the Skill tool to invoke the `maintain` skill. This audits for drift between the codebase, CLAUDE.md, tests, skills, and model IDs.

Wait for results before proceeding.

## Step 2 — Code Review

Use the Skill tool to invoke the `review` skill. This reviews recently changed files for type safety, React patterns, R3F invariants, Zustand patterns, API route security, performance, and code quality.

Wait for results before proceeding.

## Step 3 — Test Suite

Use the Skill tool to invoke the `test` skill. This runs typecheck, Vitest unit tests, and conditionally Playwright E2E.

Wait for results before proceeding.

## Step 4 — Unified Report

Combine all three results into a single report:

```
═══════════════════════════════════════
  WRAPUP REPORT
═══════════════════════════════════════

## 1. Maintenance Audit
[Key findings: STALE/MISSING/VIOLATED items]

## 2. Code Review
[Verdict: APPROVE / REQUEST CHANGES]
[Top issues if any]

## 3. Test Suite
[Verdict: CLEAN / ISSUES]
[Failures if any]

───────────────────────────────────────
OVERALL: SHIP IT ✓  |  NEEDS WORK ✗
───────────────────────────────────────
[If NEEDS WORK: prioritized action list]
```

**SHIP IT** = review approved + no critical maintenance drift + all tests pass.
**NEEDS WORK** = any critical review finding, any violated invariant, or any test failure.
