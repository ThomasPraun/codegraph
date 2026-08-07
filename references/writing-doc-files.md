# Writing CLAUDE.md / AGENTS.md files

Read before creating or editing one.

## Contents

- [Which directory earns a file](#which-directory-earns-a-file)
- [What goes in one](#what-goes-in-one)
- [What never goes in one](#what-never-goes-in-one)
- [Frontmatter](#frontmatter)
- [The generated block](#the-generated-block)
- [Why this is allowed to describe the code when you are not](#why-this-is-allowed-to-describe-the-code-when-you-are-not)
- [Budgets](#budgets)
- [The gate](#the-gate)

## Which directory earns a file

All three tests, at once:

1. **≥3 non-obvious facts** — things the code alone will not tell you. An
   invariant, a gotcha, a silent-failure procedure. Not a description of what
   the module does.
2. **Useless outside that subtree** — if it is worth knowing elsewhere, it
   belongs higher up.
3. **The subtree is a small fraction of its parent** — otherwise the parent is
   the right home.

Below three facts, **no file**. An empty file teaches people to ignore files,
and then no file saves them.

The bar is higher than it looks: **every ancestor doc file loads, not just the
nearest**. A file placed halfway down a tree is paid for on every read below it,
forever, by every reader.

**If a candidate is dropped, its facts are not.** They move up to the parent,
paid for by cutting something there. A dropped directory must never mean
evaporated knowledge — that failure is invisible and permanent.

## What goes in one

**An operating manual for this directory.** How to work here, what the house
rules are, what will bite — and, in a sub-file, how the thing actually works.

Four kinds of thing, and nothing else:

- **Invariants** — the house rules. What must stay true, and what breaks when it
  does not.
- **Procedures** — the steps. What to run, in what order, for something that
  fails quietly when skipped.
- **Gotchas** — the traps. Where a change here silently requires a change
  somewhere else.
- **What a change here ripples into** — as *steps to walk*, not prose. Prose is
  nodded at; a numbered list is followed, and can be bounced in review.

Plus, **in a sub-file only**, a fifth:

- **How this subtree works** — the shape a reader cannot get from any one file:
  what talks to what, in what order, and why it was split this way.

### Where explanation is allowed, and why only there

Not in the root. The root loads on every read of every file in the repo, so a
paragraph there is paid thousands of times whether or not anyone needed it. A
sub-file is paid only by someone already working in that subtree — that is what
makes the explanation *on demand* rather than *always on*.

The old objection to explaining at all was that prose about mechanism goes stale
in silence. It no longer does: `scopeFingerprints` records the symbols a file
speaks for, and the gate raises a **note** when they change — the ground under
this file moved, never this file is now wrong. Only a person can settle the
second, which is why it is a note and not a finding, and why `--reviewed` is a
separate act from `--write`.

So an explanation is allowed to be unverifiable, on one condition: **it is
marked the moment the thing it explains changes.** Write it where it is cheap,
keep it dense, and clear the note by re-reading rather than by re-running.

For the other four kinds, the test still holds: **could a reader act on it, and
could you prove it wrong by trying?** A procedure is proved by running it, an
invariant by breaking it.

Cite **symbol names, never line numbers**. The gate can verify a name exists;
a line number rots on the next edit and nothing notices. Escape a deliberately
deleted name with `<!-- codegraph: allow-symbol theName -->`.

Name the home, never restate it. If the rule lives in the parent, point at the
parent. Two copies means one of them is already wrong.

## What never goes in one

- **Inventories, counts, directory trees.** Hand-written, they are stale by the
  next commit. The generated block carries a ranked sample instead — see
  [The generated block](#the-generated-block).
- **What the code already says.** A description of a function that reads like
  its signature costs a reader's attention and returns nothing.
- **Anything duplicated from another doc file.** Different words for the same
  rule in two places is drift waiting to happen.

The word doing the work in all three is **hand-written**. The objection was
never to orientation; it is to a claim that goes stale in silence. Anything
generated from the index is regenerated on demand and proved fresh by the gate,
so it is held to a different standard — a lower one, deliberately.

## Frontmatter

Required. Exactly three keys, nothing else:

```yaml
---
scope: src/modules/invoice
read_before:
  - changing how an invoice line is rendered or totalled
  - adding a new door that creates invoices
ripples_to:
  - src/modules/notification
---
```

- `scope` — the file's own directory, relative to the repo root. The root uses
  `.` and needs no `read_before`.
- `read_before` — phrased as **the task the reader is about to do**, never as
  the module's name. "adding a vendor importer", not "the import module". This
  is what a reader sees in the parent's generated index; a module name tells
  them nothing about whether to open it.
- `ripples_to` — declare only where a real edge exists, **and only after
  checking**. A false edge is worse than a missing one, because it will be
  trusted. `node scripts/query.mjs ripples <dir>` shows what the code actually
  reaches.

## The generated block

Markers are placed **by hand, once**, where the block belongs:

```markdown
<!-- @map:start — generated by codegraph. Do not edit. -->
<!-- @map:end -->
```

Then `node scripts/write-maps.mjs --root <repo> --write` fills them. If the
markers are absent the generator reports and does nothing — it never invents
placement, because a guess would drop the block above the part of the file that
actually matters.

The block carries three things, all derived, none writable by hand:

1. **Which child doc file to open, and when** — from each child's first
   `read_before`.
2. **What lives here** — the directory's exported symbols in the two orderings
   that orient without understanding anything: most depended on, and never
   referenced from another file. Descriptions are the ones harvested from the
   code, so a wrong line is fixed in the comment it came from, never here.
3. **The backlinks** — who declares they ripple *into here*. Nobody writes
   those by hand, which is why no repo has them.

It is **read from the index**, so `extract.mjs` has to run before
`write-maps.mjs`, and both before the gate.

### Why this is allowed to describe the code when you are not

Three things make hand-written description a liability, and a generated block
has none of them:

| | Hand-written | Generated |
|---|---|---|
| Goes stale silently | yes | no — the gate re-renders and fails on any diff |
| Competes for the budget | yes | no — `bodyLineCount` excludes the block |
| Says what the code says | costs attention for nothing | it *is* the code's own comments |

What it still costs is a reader's attention on every load of every file below,
which is why it is **ranked and capped** rather than listed. It is a sample,
and it says so.

The line it must never cross: it names **what each thing is**, never **how any
of it works**. A mechanism cannot be derived from an index, so a claim about one
is a claim that can be wrong — and being generated would make it look
authoritative while it was.

Never edit inside the markers. The gate compares the file against a fresh render
and fails on any difference.

## Budgets

Body lines, excluding frontmatter and the generated block. Default 200; override
per file in `codegraph/budgets.json`:

```json
{ "CLAUDE.md": 172, "backend/CLAUDE.md": 161 }
```

A target, not a wall. Past 200 the first question is **not** "what do I delete"
— it is **"is this directory carrying two subjects?"**. A subtree that earns its
own file takes its lines with it and costs nothing extra, because its readers
were loading them anyway.

In order: split, then compress, then accept a few lines over. The gate says so —
past the target it raises a note, and only past 1.5× does it fail, because a
gate that fires at 201 lines teaches people to raise the number.

**Never raise a budget to make the gate pass.** And say it in as few tokens as
the idea survives: dense beats long, everywhere.

## The gate

```bash
node scripts/check.mjs --root <repo>           # report, always exit 0
node scripts/check.mjs --root <repo> --check   # exit 1 on any finding (CI)
```

It verifies **form, never truth**: frontmatter parses, `scope` matches the
directory, `ripples_to` targets exist on disk, cited symbols exist in the
indexed code, generated blocks are fresh, budgets hold.

It will never tell you a documented invariant has stopped being true. Nothing
can. The defence against that is making every claim cheap to falsify — which is
why symbols and not line numbers, and why the description lives in the code.
