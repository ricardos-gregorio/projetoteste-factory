# Software Factory Runbook (Orca)

## Goal

When a GitHub issue is labeled `factory` or `orca` and classified as bug/enhancement/feature, an Orca automation creates an isolated worktree, implements the change, runs tests, and opens a PR (`Closes #<id>`) — or comments a diagnosis without a PR if gates fail.

## Trigger paths

### A. Scheduled (active without bot)

Orca automation **Factory Issue→PR** runs every 5 minutes with precheck:

```bash
node factory/scripts/precheck-eligible.mjs
```

Exit `0` = eligible issue exists → agent run starts.  
Exit `1` = skip.

### B. Event-driven (preferred, needs Factory bot + GitHub connector)

```text
github.labeled in=ricardos-gregorio/projetoteste-factory label=factory
github.labeled in=ricardos-gregorio/projetoteste-factory label=orca
```

`--results-to thread` so updates land on the issue.

## Labels

| Label | Meaning |
|---|---|
| `factory` / `orca` | Trigger: admit into factory |
| `bug` / `enhancement` / `feature` | Eligible type |
| `factory-wip` | Job running |
| `factory-blocked` | Hard stop |
| `factory-needs-human` | Escalated |
| `factory-done` | PR published / handled |

## Agent steps

Follow `factory/prompts/issue-to-pr.md`.

## Local commands

```bash
node factory/scripts/precheck-eligible.mjs
node factory/scripts/next-issue.mjs
node factory/scripts/mark-status.mjs <n> running
npm test
node factory/scripts/run-tests.mjs
```

## Guardrails

- Max 3 implement/validate retries, 2 review fixes
- Max 20 files / 800 diff lines (else escalate)
- Fail-closed: no inconsistent PR
- Base branch: `main`
