# Agent instructions — projetoteste-factory

## Software factory

If you were started by the **Factory Issue→PR** Orca automation (or the prompt says you are the factory runner):

1. Follow `factory/prompts/issue-to-pr.md` exactly.
2. Use scripts under `factory/scripts/`.
3. Fail closed: do not open a PR if tests or review gates fail after retry budget.
4. Prefer Conventional Commits and `Closes #<issue>`.

## Product context

Static welcome page for a car sales site (`index.html`, `css/styles.css`). Tests: `npm test` (Node ≥ 21, `node:test` + jsdom).

## Non-factory work

For normal feature work, keep changes minimal, match existing style, and run `npm test` before finishing.
