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

**The skill writes one thing into a repo, and it is fixed text.** `init.mjs`
installs the index rules into the root CLAUDE.md. They name no symbol and count
nothing, so nothing in them can stop being true — which is what removes the need
for a marker, a freshness record and a gate to hold them up. Anything generated
put back there brings all three with it.

**No command may dump.** Everything routed through `capped` and everything that
can come back empty prints `NOT_PROOF`. Removing that line turns an honest miss
into permission to write the duplicate.

**Everything this skill writes is in English** — code, comments, docs, command
output, fixtures, identifiers in examples. What language the person is spoken
to in is the agent's decision, made per conversation, and nothing here should
try to make it.

That is separate from what the skill can *read*. `normalize` strips accents,
`STOPWORDS` and the `AFFECTS` clause carry non-English forms, and those stay:
they match comments in the repo being indexed, which are the user's text, not
this skill's. Deleting them would cost real descriptions in real repos.

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
Unguarded, importing `init.mjs` appends the index rules to a CLAUDE.md as a
side effect of reading its exports. Comparing `import.meta.url` to `process.argv[1]`
directly is the version that looks right and silently does nothing through a
symlink — Node resolves the first and not the second, and a skill is installed
as a link, so that is the normal case. Exit 0, no output: `tests/invocation`
is the only thing that catches it.

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

`init.mjs` writes fixed text and detects it by a sentence from that text, not
by a marker. A marker is a promise to keep a block current; fixed text has
nothing to keep current, and that is the whole reason the rules are fixed. If
`SENTINEL` ever stops appearing in `ORDERS`, every run appends another copy —
`tests/init` is what holds them together.

`init.mjs` appends and never rewrites. The rest of that file is somebody's, and
a tool that reformats a CLAUDE.md to install itself is one that gets deleted
along with its section.

## Dogfood before shipping any change

1. `node --test tests/*.test.mjs` — unquoted, so the shell expands it and node
   is handed explicit paths. Quoting makes node do the expanding, which only
   newer versions can, and `node --test tests/` resolves the directory as a
   module and fails outright.
2. `node scripts/extract.mjs . --full`
3. `node scripts/query.mjs gaps` — must stay at zero.
4. `node scripts/twins.mjs`

A language table entry that stops matching breaks no test unless one exists —
it just returns fewer symbols, silently. That is what `tests/languages.test.mjs`
is for, and why a new language needs a case there in the same change.
