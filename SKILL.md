---
name: codegraph
description: Use when adding a function, component or helper, when hunting duplicated code, or when documenting a codebase. Extracts every exported symbol with its comment and its callers into a queryable index, flags twins that do the same thing under different names, and maintains the CLAUDE.md/AGENTS.md pyramid.
---

# codegraph

Answers one question: **does this already exist, and if I touch it, what starts
lying?**

Not an architecture explainer. When the question is "how does this system work",
this is the wrong tool.

All paths below are relative to this skill's directory. `<repo>` is the project
being worked on; omit `--root` when it is the current directory.

## Build the index first

Nothing works without it. It is incremental — the first run costs, later runs
do not.

```bash
node scripts/extract.mjs <repo>          # writes <repo>/docs-graph/
node scripts/extract.mjs <repo> --full   # ignore the cache and re-read everything
```

Commit `docs-graph/index.json` and `docs-graph/twins.json`. Do not commit
`docs-graph/.cache.json` — add it to `.gitignore`.

## The three workflows

### Before writing a function, component or helper

```bash
node scripts/query.mjs find "what you are about to write" --root <repo>
```

Search by **purpose in plain words**, not by the name you were going to use —
the duplicate you are looking for has a different name, which is why it was
never found. Try the words that would appear in its comment.

If a result is flagged `⚠ near-identical`, the repo already has two of
something. Report that; it usually matters more than the task at hand.

**When `find` returns nothing, say so honestly.** It matches text; it does not
understand code. Never report "this does not exist" — report "the index did not
find it", then grep before concluding.

### After changing code

```bash
node scripts/query.mjs ripples <path-or-symbol> --root <repo>
node scripts/query.mjs who <symbol> --root <repo>
```

`ripples` lists the files that reach into what was touched. Confidence labels
are not decoration:

- `EXTRACTED` — the file imports it and names it. Certain.
- `INFERRED` — names it without importing it. Often a string, a comment or a
  re-export. Read before trusting.
- `AMBIGUOUS` — several declarations share the name and no import disambiguates.
  Both are listed because guessing would be worse.

Then re-read the doc files whose scope covers those paths, and update whatever
the change made untrue.

### When documenting a codebase

```bash
node scripts/query.mjs gaps --root <repo>          # exported, no comment, most-used first
node scripts/twins.mjs --root <repo>               # duplicate candidates
node scripts/write-maps.mjs --root <repo> --write  # regenerate backlink blocks
node scripts/check.mjs --root <repo> --check       # the gate (CI)
```

Work the `gaps` list from the top. A symbol twelve files import is worth twelve
of one nobody uses; finishing the first page removes most of the damage.

## Rules that hold the whole thing up

**Descriptions live in the code, never in the index.** The index harvests the
comment above each exported symbol. To fix a description, edit the comment. A
description stored anywhere else starts true and ends fictional, and nothing
detects the transition.

**Write comments in bounded, reviewable batches.** A comment breaks no test, so
a bad sweep lands in silence. Do one directory, show the diff, move on. Never
sweep a whole repo of comments in one pass.

**The gate checks form, never truth.** `check.mjs` verifies that a path
resolves, a cited symbol exists, a generated block is fresh, a budget holds. Do
not extend it to judge whether a documented claim is still true. A gate that can
be wrong about meaning gets disabled within a month.

**Cite symbol names, never line numbers.** The gate can verify a name. Line
numbers rot on the next edit and nothing notices.

**Never raise a budget to make the gate pass.** Over budget means cut prose.

## Judging twin candidates

`twins.mjs` proposes; it never decides. Given candidates:

1. Read both functions. Shape similarity finds renamed copies; description
   similarity finds same-purpose code that looks nothing alike. Both produce
   false positives — a Flutter widget and an Astro component can describe
   themselves identically and share nothing.
2. Rule each pair `twins` or `different`, with a one-line reason.
3. Persist it, so the pair is never raised again unless a body changes:

```bash
node scripts/twins.mjs --root <repo> --record verdicts.json
```

```json
[{ "a": {"name": "…", "file": "…", "bodyHash": "…"},
   "b": {"name": "…", "file": "…", "bodyHash": "…"},
   "verdict": "different", "reason": "one line" }]
```

Take `bodyHash` from `docs-graph/index.json`.

**Never merge twins unasked.** Report the pair and let the user decide — merging
is a design decision, and a tool that takes it unasked is one nobody runs twice.

## The doc pyramid

Read `references/writing-doc-files.md` before creating or editing any
`CLAUDE.md` / `AGENTS.md`. It covers what earns a file, what belongs in one,
budgets, and where the `@map` markers go.

Two facts that change decisions and are easy to get wrong:

- **Every ancestor doc file loads, not just the nearest one.** A new file
  halfway down a tree taxes every read below it, forever.
- **One convention per repo.** If `AGENTS.md` is already in use, use that name;
  otherwise `CLAUDE.md`. Never both.

## Adding a language

Only TypeScript/JavaScript, Dart and Astro are recognised. To add another, read
`references/languages.md` — it has the declaration patterns, the comment forms
and where to register a new extension.
