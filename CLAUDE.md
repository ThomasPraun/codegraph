---
scope: .
read_before:
  - changing extraction, the query commands, twin detection or the gate
---

# codegraph — working on the skill itself

## Non-negotiables

**No dependency may be added.** Node builtins only, in every script. The skill
has to run in a repo that has installed nothing, and the moment it needs an
install it stops being reached for.

**The extractor must not learn to parse.** Regex for declarations, brace or
indent counting for bodies, substring for edges. Precision bought by
understanding the code is precision that can be confidently wrong; every
uncertainty is labelled instead — see `parseImports` and `compile` for where
confidence comes from.

**A language is data, never a branch.** Every pattern lives in
`languages.json`; nothing in `parse.mjs` may name a language. A new one is a
table entry, and support is graded — missing import rules cost `EXTRACTED`,
a missing body rule costs `twins`, a missing entry costs symbols. Each is a
label, never a silent skip.

**The gate must not learn to judge truth.** `check.mjs` may verify that a path
resolves, a symbol exists, a block is fresh, a budget holds. If it ever decides
whether a documented claim is still correct, it becomes a gate that can be wrong
about meaning, and those get switched off.

**No command may dump.** Everything routed through `capped` and everything that
can come back empty prints `NOT_PROOF`. Removing that line turns an honest miss
into permission to write the duplicate.

## Gotchas

`identifiers` reads code with comments and strings blanked by `stripNonCode`.
Skipping that step makes prose create edges — a comment saying "run this first"
gave `run` three phantom callers, which reordered the whole `gaps` list.

`stringEnd` stops a `'` or `"` at end of line; only a backtick may span one. A
quote inside a regex literal — `/['"]([^'"]+)['"]/` — opens a string with no
close, and unbounded it blanked the rest of the file. That was silently costing
8 of this repo's own edges. Telling a regex from a division needs context, which
is parsing; a line is a bound that needs none.

Declarations match the RAW text, never the blanked copy — see `collect`. Trying
the blanked one to stop code samples inside strings from declaring symbols cost
6 real symbols to avoid 5 phantom, because one backtick in a regex swallows
whatever follows. A phantom symbol shows up in `gaps`; a missing one shows up
nowhere.

Every script guards `main()` behind `isMain`, never a hand-rolled comparison.
Unguarded, importing `write-maps.mjs` makes the gate rewrite files as a side
effect of checking them. Comparing `import.meta.url` to `process.argv[1]`
directly is the version that looks right and silently does nothing through a
symlink — Node resolves the first and not the second, and a skill is installed
as a link, so that is the normal case. Exit 0, no output: `tests/invocation`
is the only thing that catches it.

Doc markers are named `@codegraph`, never after what they hold. `@map` is what
anything in this category picks, and the first real repo already had its own
generator using it, so `--write` would have overwritten a block it did not own.

The root doc file is never the owner of a `ripples_to` target it merely contains
— see `ownerOf`. Without that, every unresolved path lands as a backlink at the
root, where it says nothing.

`bodyAt` gives up when the nearest `{` is more than 400 characters away. That is
what keeps `export const N = 5` from swallowing the next function as its body.

A tier-0 file has no comment syntax to blank, so its edges are `MENTIONED` and
`usageCount` drops them. Counting them would put the phantom-caller bug back,
one layer down: `gaps` would be reordered by names appearing in shell comments.
`NEVER_INDEXED` is the other half — it keeps prose and data out entirely, since
no label makes a README a caller.

Tier 0 must never grow a declaration pattern. A guessed symbol arrives with no
description, so it lands in `gaps` permanently and shows up in `find` as a
result that cannot be read.

`renderMaps` takes the graph as an argument, and `check.mjs` must pass the same
one `write-maps.mjs` does. Let them differ and the block renders differently in
the two callers, so every file reads as stale and no `--write` ever clears it.

The orientation list names what a symbol *is*, from its harvested comment, and
never how anything works. Prose explaining a mechanism belongs nowhere in a doc
file — generated or not, that is the claim that goes stale in silence.

## Dogfood before shipping any change

1. `node --test tests/*.test.mjs` — unquoted, so the shell expands it and node
   is handed explicit paths. Quoting makes node do the expanding, which only
   newer versions can, and `node --test tests/` resolves the directory as a
   module and fails outright.
2. `node scripts/extract.mjs . --full`
3. `node scripts/query.mjs gaps` — must stay at zero.
4. `node scripts/twins.mjs`
5. `node scripts/write-maps.mjs --write` — the block reads the index, so this
   only makes sense after step 2, and skipping it fails step 6.
6. `node scripts/check.mjs --check`

`--reviewed` is **not** part of this list. It records that a person re-read the
doc files against the code, and running it on every build is how that signal
becomes worthless. Run it when you have actually re-read them.

A language table entry that stops matching breaks no test unless one exists —
it just returns fewer symbols, silently. That is what `tests/languages.test.mjs`
is for, and why a new language needs a case there in the same change.

<!-- @codegraph:start — generated. Do not edit. -->

**What lives here** — 56 exported symbols across 9 files.

*Most depended on — changing one of these reaches furthest:*

- `OUT_DIR` · `scripts/lib/scan.mjs` — The one directory this skill writes into a project, and the only trace it leaves. Named after the skill so it… (8 uses)
- `languagesFor` · `scripts/lib/scan.mjs` — The language table for one repo: the shipped one, with any entry in `<root>/codegraph/languages.json` replaci… (6 uses)
- `extract` · `scripts/extract.mjs` — Builds and writes the whole index. Affects: every command, and the gate's ability to check citations at all. (5 uses)
- `ignoreEpipe` · `scripts/lib/scan.mjs` — Stop a closed pipe from becoming a stack trace. `| head`, `| less` and every pager close stdout mid-write; un… (5 uses)
- `isMain` · `scripts/lib/scan.mjs` — Whether this module is the script being run, rather than one being imported. Every main is guarded by it: ung… (5 uses)
- `outDirFor` · `scripts/lib/graph.mjs` — Where every artefact lives. Changing this orphans existing indexes. (4 uses)
- …and 34 more

*No other file references these — each is a way in, a helper used only inside its own file, or dead. The index cannot tell which:*

- `tokenize` · `scripts/lib/parse.mjs` — Normalised token stream: identifiers collapse to `x`, literals to `0` and `s`. Two functions that differ only…
- `stripNonCode` · `scripts/lib/parse.mjs` — Comments and string literals blanked out, positions preserved. Without this, prose creates edges: a comment t…
- `docstringBelow` · `scripts/lib/parse.mjs` — The docstring that opens a body, for languages where the description sits under the signature rather than abo…
- `bodyAt` · `scripts/lib/parse.mjs` — The body starting at the first `{` after `from`, brace-counted while ignoring braces inside strings and comme…
- `compile` · `scripts/lib/parse.mjs` — A language spec with its regexes built once. Compiling per file showed up in profiles long before anything el…
- `commentAbove` · `scripts/lib/parse.mjs` — The comment immediately above `line`, if any. Blank lines break the association on purpose: a comment separat…
- …and 10 more

A ranked sample, not an inventory, and it says what each thing *is* — never how any of it works. Searching the index by purpose covers all of them.

**Before writing anything new**, search the index for what you are about to write, in plain words rather than by the name you had in mind. A thin result is a miss, not proof of absence. Commands and full rules: the root CLAUDE.md — every ancestor loads, not just the nearest.

<!-- @codegraph:end -->
