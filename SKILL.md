---
name: codegraph
description: Use when adding a function, component or helper, when hunting duplicated code, or when documenting a codebase. Extracts every exported symbol with its comment and its callers into a queryable index, flags twins that do the same thing under different names, and maintains the CLAUDE.md/AGENTS.md pyramid.
---

# codegraph

Answers one question: **does this already exist, and if I touch it, what starts
lying?**

It answers that from the code, and it keeps a `CLAUDE.md` pyramid where a
person answers the question the code cannot: how a subtree actually works. The
index is derived and always true; the pyramid is written and flagged the moment
the ground under it moves. Both are rebuilt only when someone asks.

All paths below are relative to this skill's directory. `<repo>` is the project
being worked on; omit `--root` when it is the current directory.

## Invoked with no task

`/codegraph` on its own carries no question. Run this and show the output —
do not stop at having built something:

```bash
node scripts/query.mjs status --root <repo>
```

It reports where the repo stands — index, drift, comments, doc files, twins —
and ends with the commands that change whatever is not where it should be. It
reads only: it never rebuilds the index, because that stays the owner's call
here as everywhere else. Build the index first if there is none, then run it.

Offer the `Next` lines; do not run them unasked. If the user names a task
instead, skip this and go to the matching workflow below.

## Build the index first

Nothing works without it. It is incremental — the first run costs, later runs
do not.

```bash
node scripts/extract.mjs <repo>          # writes <repo>/codegraph/
node scripts/extract.mjs <repo> --full   # ignore the cache and re-read everything
```

Add these to the project's `.gitignore` — creating one if it has none:

```gitignore
codegraph/index.json
codegraph/.cache.json
```

Split by **origin, not by file type**. `index.json` is derived from the code and
rebuilt in under a second; committed, it turns every code change into a
three-thousand-line diff. `twins.json`, `freshness.json` and `languages.json`
stay in git because each holds a decision a person made — a twin verdict, a doc
reviewed, a language taught. Losing those means judging twice.

CI therefore runs `extract` before `check`. The gate raises a finding when there
are no indexed identifiers, so a pipeline that forgets fails loudly rather than
passing without having checked.

**Never rebuild unasked.** Every command that reads the index prints a line when
the tree has moved past it. Report that line and *offer* to rebuild; the owner
decides when. An index rebuilt behind someone's back changes answers they were
in the middle of using.

## The three workflows

### Before writing a function, component or helper

```bash
node scripts/query.mjs find "what you are about to write" --root <repo>
```

Search by **purpose in plain words**, not by the name you were going to use —
the duplicate you are looking for has a different name, which is why it was
never found. Try the words that would appear in its comment.

Descriptions rank highest, then the symbol's own name, then its path. The path
is what still answers in a repo where nobody has written a comment yet:
`src/checkout/totals.ts` matches "checkout total" even when the function inside
is called `compute` and says nothing.

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
- `MENTIONED` — the file's language is not in the table, so its comments could
  not be blanked. The name is in the text; it may not be in the code. Open the
  file before repeating it as a caller.

Then re-read the doc files whose scope covers those paths, and update whatever
the change made untrue.

### When documenting a codebase

```bash
node scripts/query.mjs gaps --root <repo>          # exported, no comment, most-used first
node scripts/twins.mjs --root <repo>               # duplicate candidates
node scripts/write-maps.mjs --root <repo> --write  # regenerate the @codegraph blocks
node scripts/check.mjs --root <repo> --check       # the gate (CI)
```

Work the `gaps` list from the top. A symbol twelve files import is worth twelve
of one nobody uses; finishing the first page removes most of the damage.

**Always offer to fill a gap; never require it.** A comment is what the index
harvests, so every one written makes `find` better for good — but it is the
owner's call. When you touch an uncommented symbol, offer a one-line comment.
When a directory is bare, offer to work through it: `gaps <dir>`, most-used
first, **one directory per pass, diff shown, then stop**. Never sweep a repo.

For a repo with no index yet, offer the same thing per directory, starting with
the ones the owner says matter.

## Rules that hold the whole thing up

**Descriptions live in the code, never in the index.** The index harvests the
comment above each exported symbol. To fix a description, edit the comment. A
description stored anywhere else starts true and ends fictional, and nothing
detects the transition.

**Write comments in bounded, reviewable batches.** A comment breaks no test, so
a bad sweep lands in silence. Do one directory, show the diff, move on. Never
sweep a whole repo of comments in one pass.

**The gate checks form, never truth.** `check.mjs` verifies that a path
resolves, a cited symbol exists, a generated block is fresh, a budget holds — and
raises a *note*, never a finding, when the code under a doc file has moved. It
must never judge whether a documented claim is still correct. A gate that can be
wrong about meaning gets disabled within a month; a note that a person settles
cannot be wrong about anything.

**Cite symbol names, never line numbers.** The gate can verify a name. Line
numbers rot on the next edit and nothing notices.

**Never raise a budget to make the gate pass.** Past the target, split a subtree
into its own file first, compress second, and only then accept a few lines over.

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

Take `bodyHash` from `codegraph/index.json`.

**Never merge twins unasked.** Report the pair and let the user decide — merging
is a design decision, and a tool that takes it unasked is one nobody runs twice.

## The doc pyramid

Read `references/writing-doc-files.md` before creating or editing any
`CLAUDE.md` / `AGENTS.md`. It covers what earns a file, what belongs in one,
budgets, and where the `@codegraph` markers go.

Setting up a repo for the first time: write its root file from
`references/root-template.md`, then add sub-files only where a directory earns
one.

A doc file is an **operating manual for its directory** — how to work there,
the house rules, what will bite — in two halves under opposite rules.

**Between the `@codegraph` markers**, generated: the child files worth opening, what
lives in this directory ranked two ways, and the backlinks. It may describe the
code because it is derived and the gate proves it fresh — but it names what each
thing *is*, never how anything *works*.

**Outside the markers**, written: invariants, procedures, gotchas, ripples —
and, **in a sub-file only, how that subtree actually works**. The root never
explains: it loads on every read in the repo, so a paragraph there is paid
thousands of times. A sub-file is paid only by whoever works in that subtree,
which is what makes the explanation on demand.

Explanation is allowed because it no longer rots unseen. The gate fingerprints
the symbols each file speaks for and raises a **note** when they change — *the
ground moved*, never *this is wrong*. Notes never fail a build; only a person
can settle them:

```bash
node scripts/write-maps.mjs --root <repo> --reviewed   # I re-read these against the code
```

`--reviewed` is deliberately not `--write`. Regenerating a block is mechanical
and runs every build; declaring a file reviewed is a person saying they looked.
Coupled, the mechanical step would clear the human signal every time.

Aim for **200 written lines**. Past it the first question is not "what do I
delete" but **"is this directory carrying two subjects?"** — split, then
compress, then accept a few over. Say everything in as few tokens as the idea
survives.

`write-maps.mjs` reads the index, so run `extract.mjs` first and the gate last.

Two more facts that change decisions and are easy to get wrong:

- **Every ancestor doc file loads, not just the nearest one.** A new file
  halfway down a tree taxes every read below it, forever.
- **One convention per repo.** If `AGENTS.md` is already in use, use that name;
  otherwise `CLAUDE.md`. Never both.

## Languages

Recognised: TypeScript/JavaScript, Astro, Dart, Python, Rust, Java, Kotlin, C#,
PHP, Swift, Go, Ruby. Every pattern is data in `scripts/lib/languages.json`, so
adding one is a table entry, never a change to the extractor.

Support is graded, and what is missing is labelled rather than hidden:

- No import rules → every edge in that language is `INFERRED`, not `EXTRACTED`.
- No body rule → symbols index normally, but never take part in `twins`.
- No table entry at all → the file is **tier 0**: a source of edges labelled
  `MENTIONED` and nothing else. It contributes no symbols, because guessing at a
  declaration syntax invents symbols, and an invented symbol has no description,
  so it lands in `gaps` and stays there.

Prose and data files are never indexed at any tier — a README saying "run this
first" would otherwise give `run` callers it does not have.

Read `references/languages.md` before adding or changing a language: it has the
tier table, the entry format, and which corners are deliberately left at a lower
tier.
