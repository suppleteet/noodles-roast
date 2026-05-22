---
name: wrapup
description: All-in-one finish line — runs maintenance audit, code review, and full test suite sequentially, then updates CLAUDE.md and memory to reflect current state.
---

Run all steps in sequence. Each step must complete before the next begins.

## Step 1 — Maintenance Audit

Use the Skill tool to invoke the `maintain` skill. This audits for drift between the codebase, CLAUDE.md, tests, skills, and model IDs.

Wait for results before proceeding.

## Step 2 — Code Review

Use the Skill tool to invoke the `review` skill. This reviews recently changed files for type safety, React patterns, R3F invariants, Zustand patterns, API route security, performance, and code quality.

Wait for results before proceeding.

### Step 2b — Fix the low-risk findings in-place

This is the finish line, not a homework dump. Apply every Critical finding and most Warnings yourself before moving on. "Low-risk" means:
- Stale references / wrong identifiers (e.g., a Set contains old ids after a rename)
- Dead code branches, unreachable returns, no-op checks
- Missing guards / clamps / null-checks at boundaries
- Hardcoded values that should reference a constant
- Documentation that contradicts the code

Skip only items that need product / design judgment, behavioral changes that need a real user-feel test, or non-obvious cross-file tradeoffs. Note those briefly in the final report under "Deferred."

After the fixes, **re-run typecheck + vitest** to confirm green before continuing. Don't push red.

## Step 3 — Test Suite

Use the Skill tool to invoke the `test` skill. This runs typecheck, Vitest unit tests, and conditionally Playwright E2E.

Wait for results before proceeding.

## Step 4 — Knowledge Base Sync

Using the findings from Steps 1–3, update the knowledge base to reflect current reality. Do this **before** writing the report.

### 4a — CLAUDE.md sync

Read `CLAUDE.md`. Apply only what the maintain audit flagged as `[STALE]`, `[NEW]`, or `[REMOVED]`:

- **Package table**: update any `[STALE]` version ranges to match `package.json`; add `[NEW]` packages; remove `[REMOVED]` ones
- **AI model table**: update any `[STALE]` model IDs or voice IDs to match `src/lib/constants.ts` / `src/lib/liveConstants.ts`
- **Key Invariants**: if the review found a new invariant, add it; if a `[VIOLATED]` invariant was resolved, update its wording

Do **not** rewrite narrative sections, rename headings, or change anything the audit did not flag. Surgical edits only.

### 4b — Memory sync

Read `C:\Users\tyler\.claude\projects\c--Projects-Roastie\memory\MEMORY.md` and its linked files.

Apply updates only for things that materially changed:

- If a new architectural decision was made (new session mode, new API route, new invariant pattern), update or create the relevant project or feedback memory and update the MEMORY.md index
- If a previously recorded fact is now stale (old model ID, removed feature), update or remove that memory
- If the code review found a recurring pattern the user confirmed and it isn't already in memory, save it as a feedback memory

Do **not** create memories for things already in CLAUDE.md or derivable from reading the code. Do **not** duplicate existing memories.

### 4c — Comedy Feedback Distillation

Use the `/feedback` skill to fetch and distill user feedback. The skill handles:
1. Fetching from Vercel Blob (production) and `.debug/feedback/` (local)
2. Displaying a summary table
3. Distilling patterns into `src/lib/comedyGuidelines.ts`

If no feedback exists in either location, skip this step.

### 4d — Report what changed

List every file edited in this step and the specific change. If nothing needed updating, say "Knowledge base: already current — no changes."

## Step 5 — Unified Report

Combine all results into a single report:

```
═══════════════════════════════════════
  WRAPUP REPORT
═══════════════════════════════════════

## 1. Maintenance Audit
[Key findings: STALE/MISSING/VIOLATED items, or CLEAN]

## 2. Code Review
[Verdict: APPROVE / REQUEST CHANGES]
[Top issues if any]

## 3. Test Suite
[Verdict: CLEAN / ISSUES]
[Failures if any]

## 4. Knowledge Base
[Files updated and what changed, or "already current"]

───────────────────────────────────────
OVERALL: SHIP IT ✓  |  NEEDS WORK ✗
───────────────────────────────────────
[If NEEDS WORK: prioritized action list]
```

**SHIP IT** = review approved + no critical maintenance drift + all tests pass.
**NEEDS WORK** = any critical review finding, any violated invariant, or any test failure.

## Step 6 — Commit & Push

After the report, the wrapup ALWAYS ends by pushing the current branch — including any pre-existing commits that haven't been pushed yet.

1. **If there are uncommitted changes** (from knowledge base sync or bug fixes during this wrapup):
   - Stage only the files changed during this wrapup session
   - Commit with a descriptive message

2. **Always check the remote sync state** — run `git status` to see whether the current branch is ahead of its upstream. If ahead by any number of commits (whether from this wrapup or earlier work), run `git push`.

3. **If the branch has no upstream yet** (e.g., a fresh local branch), push with `git push -u origin <branch>`.

4. **If the working tree is clean AND the branch is already in sync with origin**, the push is a no-op — say "Already up to date — nothing to push." and finish.

The wrapup is the finish line. Don't leave commits stranded locally just because this run didn't make new ones.
