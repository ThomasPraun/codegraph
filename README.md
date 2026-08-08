# codegraph

A Claude Code skill that answers one question about a codebase:

> **does this already exist, and if I touch it, what starts lying?**

It extracts every exported symbol with its comment and its callers into a
queryable index, and flags twins that do the same thing under different names.

Everything it reports is harvested from the code. Nothing is written down twice,
so nothing can drift apart.

## Why

Two failures cost more than any others when working in an unfamiliar repo:

1. **Writing something that already exists** under a name you would never have
   searched for.
2. **Changing something without knowing what reaches into it** — no test breaks,
   so nothing tells you.

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

# 4. Once: leave the rules where an agent will find them
node scripts/init.mjs <repo>
```

Run `node scripts/query.mjs` with no command for orientation and the full list.

Everything the tool owns lands in one folder, `<repo>/codegraph/` — safe to
delete. The only file it touches outside that is the root `CLAUDE.md`, once,
and it appends rather than rewriting.

| File | In git? | Why |
|---|---|---|
| `index.json` | no | derived; rebuilt in under a second, thousand-line diffs if tracked |
| `.cache.json` | no | derived, and its mtimes are meaningless on another machine |
| `twins.json` | **yes** | verdicts a person gave on duplicate candidates |
| `languages.json` | **yes** | hand-written, optional: a language for this repo only |

`extract` says so when the first two are not ignored by git, and never edits
`.gitignore` itself.

**Nothing is ever rebuilt for you.** Every command that reads the index says so
when the tree has moved past it, and then leaves the decision alone.

Extraction is incremental — the first run costs, later runs do not. Use
`--full` to ignore the cache and re-read everything.

## Commands

| Command | What it does |
|---|---|
| `query.mjs` | Orientation: what this answers and what can be asked of it |
| `query.mjs status` | Where the repo stands, and the command that changes each thing that is off |
| `query.mjs find "<purpose>"` | Search by purpose in plain words, not by name — description, then name, then path |
| `query.mjs who <symbol>` | Who calls this |
| `query.mjs ripples <path\|symbol>` | What reaches into what you touched |
| `query.mjs gaps [dir]` | Exported and uncommented, most-used first |
| `extract.mjs <repo> [--full]` | Build or refresh the index into `<repo>/codegraph/` |
| `twins.mjs [--record verdicts.json]` | Duplicate candidates; records your verdicts |
| `init.mjs <repo>` | Write the index rules into the repo's root `CLAUDE.md` |

`extract.mjs` and `init.mjs` take the repo as a positional argument; every other
script takes `--root <repo>`. Omit either when the repo is the current
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

**Never merge twins unasked.** `twins.mjs` proposes; the user decides. Merging
is a design decision, and a tool that takes it unasked is one nobody runs twice.

**Never write anything generated into a doc file.** A block derived from the
index needs a marker to find it, a step to regenerate it and a record of when a
person last read the prose around it — three mechanisms, each able to be wrong
about a repo it only reads, each needing upkeep for as long as the repo lives.

## The root CLAUDE.md

`init.mjs` writes one section: how to query the index, and the four rules that
decide whether it is worth having — search by purpose, a thin result is a miss,
descriptions live in the code, never rebuild unasked.

The text is **fixed**. It names no symbol, cites no path inside the repo and
counts nothing, so there is no version of it that can be behind the code. That
is what removes the need for the three mechanisms above.

It appends and never rewrites; everything else in that file belongs to the
owner. Run twice, the second run does nothing.

Details: [`references/root-template.md`](references/root-template.md).

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

Each table entry is held to a fixture written from real code **before** the
pattern. Of the ten languages, nine had a fault that their old fixture missed —
C# indexed no method at all, Dart and Python no member of any class. Details,
entry format and how to add one:
[`references/languages.md`](references/languages.md).

## Documentation

- [`SKILL.md`](SKILL.md) — the skill instructions Claude follows
- [`references/root-template.md`](references/root-template.md) — what `init.mjs`
  writes, and why it is fixed text
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
```

A new language needs a case in `tests/fixtures.json` in the same change, and
the fixture source has to be written before the pattern — a table entry that
stops matching breaks nothing, it just returns fewer symbols.

No dependency may be added. Node builtins only, in every script.

## License

MIT — see [LICENSE](LICENSE).
