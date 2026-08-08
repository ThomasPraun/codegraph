---
name: codegraph
description: Use when adding a function, component or helper, when hunting duplicated code, or when documenting a codebase. Extracts every exported symbol with its comment and its callers into a queryable index, and flags twins that do the same thing under different names.
---

# codegraph

Answers one question: **does this already exist, and if I touch it, what starts
lying?**

Everything it knows is harvested from the code, so nothing in the index can be
out of date with the code without saying so. It is rebuilt only when someone
asks, never on its own.

It writes one fixed block of rules into the repo's root `CLAUDE.md` so an agent
opening the repo later knows the index is there. Nothing else.

All paths below are relative to this skill's directory. `<repo>` is the project
being worked on; omit `--root` when it is the current directory.

## Invoked with no task

`/codegraph` on its own carries no question. Run this, show the output, and
stop — the user picks what happens next:

```bash
node scripts/query.mjs --root <repo>
```

It orients: what the tool answers, that questions are asked in words, and the
actions available. **Do not run any of them unasked**, and do not build an
index first — whether one exists is the first thing it says, and building
without being asked is the thing this tool never does.

If the user names a task instead, skip this and go to the matching workflow
below.

## Invoked with a flag

| Typed | Run | |
|---|---|---|
| `/codegraph` | `query.mjs` | orientation and the options |
| `/codegraph --status` | `query.mjs status` | where the repo stands |
| `/codegraph --index` | `extract.mjs <repo>` | rebuild; the flag **is** the ask |
| `/codegraph --gaps [dir]` | `query.mjs gaps [dir]` | exported, uncommented, most-used first |
| `/codegraph --twins` | `twins.mjs` | duplicate candidates with no verdict |
| `/codegraph --init` | `init.mjs <repo>` | write the index rules into the root CLAUDE.md |
| `/codegraph --help` | `query.mjs --help` | the orientation again |

Say what you ran and show the output. `--index` and `--init` write: name the
files afterwards.

`--status` is separate from the bare invocation on purpose. Someone arriving
with no command has not asked how stale the index is — they do not yet know
there is one. Counts answer a question they have not formed and bury the one
thing that helps, which is what to type next.

**There is deliberately no `--find`, `--ripples` or `--who`.** Those take a
subject in prose, and prose is the better interface for them — "does something
already validate a session token?" lets the words be rephrased and the results
read, which is the whole job. A flag would only strip that. The flags cover the
**acts**, where the point is to get exactly one thing done with no
interpretation at all; the **questions** stay in words.

These are the skill's surface, not the scripts'. The scripts keep their own
grammar — `query.mjs gaps`, no dashes — and this table is the mapping. An
unrecognised flag is an error there, never a quiet fallback to `status`.

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
three-thousand-line diff. `twins.json` and `languages.json` stay in git because
each holds a decision a person made — a twin verdict, a language taught. Losing
those means judging twice.

`extract` says so when those two lines are missing from a repo's `.gitignore`.
It never edits the file: offer the lines, let the owner add them.

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

A file that reaches into what you touched is a file to open before shipping.

### When documenting a codebase

```bash
node scripts/query.mjs gaps --root <repo>   # exported, no comment, most-used first
node scripts/twins.mjs --root <repo>        # duplicate candidates
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

**Never put anything generated in a doc file.** A block derived from the index
has to be regenerated, proved fresh and re-reviewed when the code under it
moves — three mechanisms that can each be wrong about a repo they only read.
Fixed text needs none of them. The rules `init.mjs` writes name no symbol and
count nothing, which is exactly why they need no upkeep.

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

## The root CLAUDE.md

The skill writes exactly one thing into a repo: a fixed block of index rules in
the root `CLAUDE.md`, so that an agent opening the repo later knows the index
exists and how to query it.

```bash
node scripts/init.mjs <repo>
```

It appends and never rewrites — whatever else is in that file is the owner's.
Run twice it does nothing the second time.

The text is fixed on purpose. It names no symbol and counts nothing, so there
is no version of it that can be behind the code, and therefore no marker to
keep current, no freshness record and no gate. **Nothing generated goes in a
doc file**: the moment it does, all three come back, and each is a mechanism
that can be wrong about a repo it only reads.

One convention per repo — if `AGENTS.md` is already in use, that is the name;
otherwise `CLAUDE.md`. Never both.

Everything else in that file belongs to the owner. Offer to add what they want
remembered every session; never reorganise what is already there.

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
