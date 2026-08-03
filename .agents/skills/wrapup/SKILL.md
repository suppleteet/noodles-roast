---
name: wrapup
description: Finish Roastie work with scope-proportionate validation, review, documentation sync, commit, and push. Use after implementing a change or when the user asks for wrapup; defaults to Quick for small focused work, escalates to Standard for risky state/API/audio changes, and uses Full only for major architecture, dependency/model work, release checkpoints, or an explicit full wrapup.
---

# Roastie Wrapup

Choose the smallest tier that matches the completed task. State the chosen tier and why before running it.

## Scope rules for every tier

- Define the task scope from the task commit/range or the files changed during the current task. Never infer scope from the whole dirty working tree.
- Inspect `git status` before acting. Preserve all pre-existing and concurrent changes.
- Review and stage only the task commit/range and wrapup-authored files.
- Treat unrelated findings and pre-existing test failures as baseline. Report them; do not fix, revert, stage, or pull them into the task.
- Do not reopen an already completed and pushed change for low-risk polish. Reopen it only for a correctness, safety, data-loss, or material regression issue.
- Run knowledge-base synchronization only when the task materially changed documented architecture, dependencies, models, commands, invariants, or durable project facts.
- End by checking upstream status and pushing any in-scope commits. A synchronized branch needs no empty commit.

## Choose a tier

### Quick - default

Use for a small, focused change with bounded behavior and focused tests, including documentation, prompt, test, and localized performance cleanups.

1. Inspect the task diff or committed range and confirm it contains only intended work.
2. Run the smallest relevant focused tests.
3. Run typecheck. If it fails, compare the errors with the pre-task baseline:
   - New in-scope errors block completion.
   - Identical pre-existing or unrelated errors are reported as baseline and do not expand scope.
4. Commit only in-scope uncommitted files when needed.
5. Push the current branch if it is ahead of upstream.

Report: task range, focused tests, typecheck result with baseline distinction, commit, and push status.

### Standard - medium or risky

Use for changes to state-machine behavior, API contracts, audio/STT/TTS, recording, monetization, security boundaries, or multi-file runtime behavior where focused review or browser validation materially reduces risk.

Run Quick, plus:

1. Invoke the `review` skill with the exact task commit/range and relevant files. Never review the entire dirty tree.
2. Fix Critical findings and in-scope Warnings that affect correctness or safety. Defer polish and unrelated findings.
3. Run relevant E2E tests when a local server is available. Choose targeted specs; run the full browser suite only when the change has broad UI/runtime reach.
4. Re-run affected focused tests and typecheck after fixes.

Report the scoped review verdict, relevant E2E evidence, fixes made, and deferred items.

### Full - exceptional

Use only for:

- major architecture or cross-cutting subsystem changes;
- dependency, package, AI model, or provider migrations;
- release checkpoints;
- an explicit request for a "full wrapup."

Run Standard, plus:

1. Invoke the `maintain` skill for package/model/documentation/test drift.
2. Invoke the `test` skill for the complete validation workflow.
3. Update AGENTS.md or project memory only for material facts changed by the task or drift directly caused by it. Make surgical edits; do not opportunistically rewrite documentation.
4. Run feedback distillation only when feedback exists and the task or explicit request calls for comedy-guideline synchronization.

Full-wrap findings outside the task remain reported baseline unless they are release-blocking correctness or safety issues.

## Commit and push safety

Before committing:

1. List staged files and compare them with the declared task scope.
2. Unstage anything outside scope without altering its working-tree content.
3. Preserve concurrent hunks in shared files by staging only the task hunks.
4. Run `git diff --cached --check`.

Then commit with a descriptive message. Push the current branch when ahead; otherwise report "Already up to date."

## Final report

Keep the report concise:

```text
WRAPUP - QUICK | STANDARD | FULL
Scope: <commit/range and files>
Validation: <focused/typecheck/E2E results; baseline failures distinguished>
Review: <verdict or not required>
Knowledge base: <updated files or not required>
Git: <commit and push status>
Verdict: SHIP IT | NEEDS WORK
```
