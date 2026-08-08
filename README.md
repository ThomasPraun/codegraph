# codegraph

A Claude Code skill that answers one question about a codebase:

> **does this already exist, and if I touch it, what starts lying?**

It extracts every exported symbol with its comment and its callers into a
queryable index, flags twins that do the same thing under different names, and
maintains the `CLAUDE.md` / `AGENTS.md` pyramid.

**What** is in a codebase is generated from the code and kept fresh by a gate.
**How** it works is written by a person, in a sub-file, and flagged the moment
the code under it moves — a mechanism cannot be derived, so the tool marks the
ground rather than judging the claim. See [The doc pyramid](#the-doc-pyramid).

## Why

Two failures cost more than any others when working in an unfamiliar repo:

1. **Writing something that already exists** under a name you would never have
   searched for.
2. **Changing something and leaving the docs quietly wrong** — no test breaks,
   so nothing tells you.

`codegraph` attacks both with an index harvested straight from the code, plus a
gate that checks the shape of documentation without ever judging its truth.

## Install

Zero dependencies, Node builtins only — no `npm install`, ever. That is a hard
constraint of the project: a tool that needs an install is a tool nobody reaches
for.

Requires Node 18+.

**As a Claude Code skill:**

```bash
git clone https://github.com/ThomasPraun/codegraph.git ~/.claude/skills/codegraph
```

Or install the packaged bundle at `dist/codegraph.skill`.

**As plain scripts**, cloned anywhere and pointed at a repo with `--root`.

## Quick start

```bash
# 1. Build the index — nothing else works without it
node scripts/extract.mjs <repo>

# 2. Before writing anything, check it does not exist
node scripts/query.mjs find "format a currency amount" --root <repo>

# 3. After changing code, see what reaches into it
node scripts/query.mjs ripples src/money.ts --root <repo>
```

Everything lands in one folder, `<repo>/codegraph/` — the only trace this leaves
in a project, and safe to delete.

| File | In git? | Why |
|---|---|---|
| `index.json` | no | derived; rebuilt in under a second, 3000-line diffs if tracked |
| `.cache.json` | no | derived, and its mtimes are meaningless on another machine |
| `twins.json` | **yes** | verdicts a person gave on duplicate candidates |
| `freshness.json` | **yes** | which doc files a person reviewed, and against what |
| `languages.json` | **yes** | hand-written, optional: a language for this repo only |

CI runs `extract` before `check`. Forget it and the gate raises a finding rather
than passing silently.

**Nothing is ever rebuilt for you.** Every command that reads the index says so
when the tree has moved past it, and then leaves the decision alone.

Extraction is incremental — the first run costs, later runs do not. Use
`--full` to ignore the cache and re-read everything.

## Commands

| Command | What it does |
|---|---|
| `extract.mjs <repo> [--full]` | Build or refresh the index into `<repo>/codegraph/` |
| `query.mjs` | Orientation: what this answers and what can be asked of it. What no command at all means |
| `query.mjs status` | Where the repo stands, and the command that changes each thing that is off |
| `query.mjs find "<purpose>"` | Search by purpose in plain words, not by name — description, then name, then path |
| `query.mjs who <symbol>` | Who calls this |
| `query.mjs ripples <path\|symbol>` | What reaches into what you touched |
| `query.mjs gaps` | Exported and uncommented, most-used first |
| `twins.mjs [--record verdicts.json]` | Duplicate candidates; records your verdicts |
| `write-maps.mjs [--write]` | Regenerate the generated blocks in doc files |
| `write-maps.mjs --reviewed` | Record that you re-read the doc files against the code |
| `check.mjs [--check]` | The gate; `--check` exits 1 on any finding, for CI |

`extract.mjs` takes the repo as a positional argument (plus `--out DIR`); every
other script takes `--root <repo>`. Omit either when the repo is the current
directory. `query.mjs` and `twins.mjs` also take `--limit N`.

## Confidence labels

`ripples` never pretends to be sure. Every edge is labelled:

- **`EXTRACTED`** — the file imports it and names it. Certain.
- **`INFERRED`** — names it without importing it. Often a string, a comment or a
  re-export. Read before trusting.
- **`AMBIGUOUS`** — several declarations share the name and no import
  disambiguates. Both are listed, because guessing would be worse.
- **`MENTIONED`** — the file's language is not in the table, so its comments
  could not be blanked. The name is in the text; it may not be in the code.
  Shown by `who` and `ripples`, and deliberately excluded from the usage count
  that orders `gaps`.

Likewise, when `find` returns nothing that means *the index did not find it* —
never *it does not exist*. It matches text; it does not understand code. Grep
before concluding.

## Rules that hold the whole thing up

**Descriptions live in the code, never in the index.** The index harvests the
comment above each exported symbol. To fix a description, edit the comment. A
description stored anywhere else starts true and ends fictional, and nothing
detects the transition.

**The gate checks form, never truth.** `check.mjs` verifies that a path
resolves, a cited symbol exists, a generated block is fresh, a budget holds. When
the code under a doc file changes it raises a **note**, never a finding: *the
ground moved*, not *this is wrong*. Notes do not fail a build, because only a
person can settle one. A gate that can be wrong about meaning gets switched off
within a month.

**Cite symbol names, never line numbers.** The gate can verify a name; line
numbers rot on the next edit and nothing notices.

**Never raise a budget to make the gate pass.** Past the 200-line target, split a
subtree into its own file first, compress second, accept a few lines over third.
Only at 1.5× does it fail — a gate that fires at 201 teaches people to raise the
number.

**Never merge twins unasked.** `twins.mjs` proposes; the user decides. Merging
is a design decision, and a tool that takes it unasked is one nobody runs twice.

## The doc pyramid

A `CLAUDE.md` / `AGENTS.md` file has two halves, and they are held to opposite
standards.

### The generated half

Between `@codegraph` markers, regenerated by `write-maps.mjs` and proved fresh by the
gate. It answers **what is here**:

- which child doc file to open, and when
- the directory's exported symbols, ranked two ways — most depended on, and
  never referenced from another file — each with the description harvested from
  its own comment
- the backlinks: who declares they ripple into here

This is allowed to describe the code precisely because it is *not written*. It
cannot go stale (the gate re-renders and fails on any difference), and it does
not compete for the budget (`bodyLineCount` excludes it). What it still costs is
attention on every load of every file below, so it is ranked and capped — a
sample that says it is a sample, never an inventory.

It names what each thing **is**. It never says how anything **works**: that
cannot be derived from an index, and generating it would make a guessable claim
look authoritative.

### The written half

Everything you type: **an operating manual for this directory.** How to work
here, what the house rules are, what will bite.

- **Invariants** — the house rules. What must stay true, and what breaks when it
  does not.
- **Procedures** — the steps. What to run, in what order, for something that
  fails quietly when skipped.
- **Gotchas** — the traps. Where a change here silently requires a change
  somewhere else.
- **Ripples** — what a change here reaches into, as steps to walk.
- **How this subtree works** — *in a sub-file only*. The root is loaded on every
  read in the repo, so a paragraph there is paid thousands of times; a sub-file
  is paid only by whoever works in that subtree. That is what makes the
  explanation on demand rather than always on.

The first four have a test: **could a reader act on it, and could you prove it
wrong by trying?** A procedure is proved by running it; an invariant by breaking
it. The fifth cannot be proved at all — which is why the gate fingerprints the
symbols each file speaks for and raises a note when they change, and why
`--reviewed` is a separate act from `--write`. An explanation may be
unverifiable as long as it is marked the moment its subject moves.

Still ruled out: hand-typed inventories, descriptions that restate a signature,
and anything already said in another doc file.

So the division is not "explain / do not explain". It is **derived facts are
generated, judgement is written, and written claims are marked when their ground
moves** — and only the written half has a budget.

The commands mirror it. `ripples` tells you which **code** reaches what you
touched; the written half tells you which **knowledge that no code can hold**
just stopped being true.

A directory earns a file only when it has **≥3 non-obvious facts** for the
written half — the generated half is free but never justifies a file on its own.
Below three, no file, because *every ancestor doc file loads, not just the
nearest*: one halfway down a tree is paid for on every read below it, forever.
Read
[`references/writing-doc-files.md`](references/writing-doc-files.md) before
creating or editing one.

## Languages

Every pattern is data in `scripts/lib/languages.json` — adding a language is a
table entry, not a change to the extractor. Drop a
`<repo>/codegraph/languages.json` in a project to add or replace one there
without touching the skill.

| Language | Extensions | Tier |
|---|---|---|
| TypeScript / JavaScript | `.ts .tsx .mts .cts .js .jsx .mjs .cjs` | 3 |
| Astro | `.astro` | 3 |
| Dart / Flutter | `.dart` | 3 |
| Python | `.py .pyi` | 3 |
| Rust | `.rs` | 3 |
| Java · Kotlin · C# · PHP | `.java .kt .kts .cs .php` | 3 |
| Swift · Go | `.swift .go` | 2 |
| Ruby | `.rb` | 1 |

Support is **graded, and what is missing is labelled rather than hidden**:

| Tier | Missing | Cost |
|---|---|---|
| 3 | — | full |
| 2 | import rules | edges stay `INFERRED`, never `EXTRACTED` |
| 1 | body rule | no shapes, so no `twins` |
| 0 | the whole entry | edges only, all `MENTIONED`; **no symbols** |

Tier 0 never guesses at declaration syntax. An invented symbol has no
description, so it lands in `gaps` and stays there, and it poisons `find` —
worse than not indexing the file. And prose or data files are never indexed at
any tier: a README saying "run this first" would otherwise give `run` callers it
does not have.

That is also why "any language" has a ceiling. The extractor deliberately does
not parse — regex for declarations, brace or indent counting for bodies,
substring for edges. Precision bought by *understanding* code is precision that
can be confidently wrong; every uncertainty is labelled instead. Adding
languages makes the table bigger, never the extractor smarter.

Details, entry format and how to add one:
[`references/languages.md`](references/languages.md).

## Documentation

- [`SKILL.md`](SKILL.md) — the skill instructions Claude follows
- [`references/writing-doc-files.md`](references/writing-doc-files.md) — what
  earns a `CLAUDE.md`, what belongs in one, budgets, `@codegraph` markers
- [`references/languages.md`](references/languages.md) — recognised languages
  and how to add one
- [`CLAUDE.md`](CLAUDE.md) — working on the skill itself

## Contributing

Dogfood before shipping any change:

```bash
node --test tests/*.test.mjs        # unquoted: the shell expands it, not node
node scripts/extract.mjs . --full
node scripts/query.mjs gaps        # must stay at zero
node scripts/twins.mjs
node scripts/write-maps.mjs --write
node scripts/check.mjs --check
```

A new language needs a case in `tests/fixtures.json` in the same change — a
table entry that stops matching breaks nothing, it just returns fewer symbols.

No dependency may be added. Node builtins only, in every script.

## License

MIT — see [LICENSE](LICENSE).
