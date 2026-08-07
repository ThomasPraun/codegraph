# codegraph — design

**Status:** validated 2026-08-06. Not yet implemented.

**The one question this answers:** *does this already exist, and if I touch it,
what starts lying?*

Everything that does not serve that question stays out. This is not an
architecture explainer — graphify already is one, and competing with it there
would lose. Where graphify asks *how does this work*, codegraph asks *has this
been written already*.

**What produced it:** a documentation plan for a real repo (23 defects measured
over 2026-08-04/06; almost none was "I misread this function", almost all were
"I did not know this had a second door"), plus the observation that the same
codebase kept growing second copies of functions that already existed under a
different name.

---

## The three renunciations

Each one is load-bearing. Together they are why the tool cannot mislead.

1. **It does not parse.** Regex and substring matching only. It does not
   understand the code, and therefore cannot lie about it. Tree-sitter would be
   more precise and would also make the tool wrong in ways that are hard to see.
2. **It never judges truth.** The gate checks that a cited symbol exists, that a
   path resolves, that a generated block is fresh, that a budget holds. It never
   decides whether a written invariant is still true. A gate that can be wrong
   about meaning gets `continue-on-error` bolted on within a month.
3. **Thin is a miss, never proof of absence.** If `find` returns nothing, that
   is not evidence the thing does not exist. This is printed in the command's
   own output, not buried in a README — it is the difference between an honest
   tool and one that authorises you to duplicate.

**No dependencies.** Node builtins only. It must run in a repo that has
installed nothing.

---

## Architecture

```
   source tree
        │  (1) EXTRACTOR — script, zero deps
        │      regex     → exported symbols + harvested comment
        │      substring → who names whom, disambiguated by imports
        ▼
   docs-graph/index.json ───────────────┐
        │                               │
        │ (2) COMMANDS                  │ (3) TWINS
        │     capped output             │     candidates by shape + description
        │     find · who · ripples      │     agent adjudicates the candidates
        │     gaps · twins · check      │     verdict persisted with body hashes
        ▼                               ▼
   a ten-line answer            docs-graph/twins.json
        ▲
        │  (4) PYRAMID — CLAUDE.md / AGENTS.md per directory
        └──── small, auto-loaded, and its main job is to send
              you to the commands rather than repeat their content
```

**Why the inventory is not inside the doc files.** The inventory is unbounded —
hundreds or thousands of entries. Doc files are loaded whole on every read, and
every ancestor loads, not just the nearest. An inventory in there taxes every
file read in the subtree, forever. The split is the point: **the inventory knows
what exists; the pyramid knows what is not obvious and teaches you to query the
inventory.** One grows without limit, the other must stay small.

---

## Piece 1 — the extractor

Two passes over the tree, each file read exactly once.

### Pass 1 — what exists

Per-language regex against exported declarations, harvesting the comment
immediately above:

| Stack | Declarations | Comment form |
|---|---|---|
| TS / JS | `export function`, `export const`, `export class`, `export type` | `/** … */` |
| Dart / Flutter | top-level public declarations, `class X extends StatelessWidget` | `/// …` |
| Astro | the `.astro` file *is* the component; `export` inside frontmatter | `<!-- … -->`, `/** … */` |

One row per symbol: name, kind, file, harvested description — or a marked hole
when there is no comment.

**The description is harvested, never authored elsewhere.** It is written once,
in the only place that survives a rename and a `git mv`. An inventory with its
own prose starts true and ends fictional, and nothing detects the transition.

### Pass 2 — who names whom

With the name list in memory, scan each file for those strings. Crude on
purpose. **The import disambiguates**, and that is what makes it honest:

```
checkout.tsx contains "formatearMoneda"
  ├─ imports it?          yes → EXTRACTED  (certain)
  ├─ imports it?          no  → INFERRED   (names it, reason unknown)
  └─ name exists in 3+ files → AMBIGUOUS   (collision)
```

Without the import check, substring matching produces garbage: `get`, `format`,
`index` appear everywhere. With it, most edges become verifiable certainty and
the rest are **marked doubtful instead of disguised as certain** — graphify's
confidence labels applied where they actually matter.

### Incremental

Size and `mtime` per file are stored; the second run re-extracts only what
changed. A large repo costs once and costs cents afterwards, which is what
decides whether it gets run again.

### `index.json` shape

```jsonc
{
  "version": 1,
  "root": ".",
  "files": { "src/utils/money.ts": { "size": 1840, "mtime": 1754500000 } },
  "symbols": {
    "formatearMoneda": {
      "kind": "function",
      "file": "src/utils/money.ts",
      "desc": "Formatea un monto a moneda local.",
      "affects": "facturas, checkout, exports PDF",   // optional second clause
      "shape": "if>loop>call>return",                  // normalised skeleton
      "bodyHash": "…"
    }
  },
  "edges": [
    { "from": "src/checkout.tsx", "to": "formatearMoneda", "conf": "EXTRACTED" }
  ]
}
```

Name collisions are real: `symbols` is keyed by `name@file` when a bare name is
not unique. Callers of `find` never see the key — it is an implementation
detail.

---

## Piece 2 — the commands

```bash
codegraph find "formatear moneda"     # does this already exist?  ← the main one
codegraph who formatearMoneda         # both directions: what it uses, who uses it
codegraph ripples src/utils/money.ts  # touch this, what starts lying
codegraph gaps [path]                 # exported without a comment, most-used first
codegraph twins                       # candidate pairs with no verdict
codegraph check                       # the gate (CI)
```

Two decisions inside this:

**`gaps` orders by usage, not alphabetically.** A symbol with no comment used by
twelve files hurts twelve times more than one nobody uses. Ordering by usage
turns a list of three hundred holes into *"fix these eight and most of the
damage is gone"*.

**Every command truncates against a cap and says so** — `…and 40 more, narrow
the query`. Never a dump. And when `find` returns nothing it prints, in words,
that not finding is not proof of absence.

`find` matches against three things at once: harvested descriptions, symbol
names, and — for a query that resembles code — normalised shape.

---

## Piece 3 — twins

Candidates arrive by two independent routes:

```
SHAPE        strip identifiers and literals, keep the control skeleton
             if→loop→call→return  ═══  if→loop→call→return
             finds: copy-paste, and renamed copies

DESCRIPTION  significant-word overlap between harvested comments
             "formatea monto a moneda"  ~  "convierte número a string con $"
             finds: same purpose, unrelated code
```

Candidates go to an agent that adjudicates **only those pairs**, in one batch.
The verdict is written to `twins.json` **together with both body hashes**.

That hash is what makes the detector survivable. A pair already ruled *"no,
these are different"* is never asked again — **unless one of the bodies
changes**, at which point the verdict reopens by itself. Without it you either
re-ask forever (noise, and you switch it off) or you seal a verdict that ages
into a lie.

**A noisy detector is a disabled detector.** Thresholds start high. Five real
pairs beat forty candidates.

**It never refactors on its own.** It reports the pair and leaves the decision.
Merging two functions is a design decision, and a tool that takes it unasked is
a tool you stop running.

---

## Piece 4 — the pyramid, and the gate

### Which directory earns a file

All three at once: **≥3 non-obvious facts** the code alone will not give you ·
**useless outside that subtree** · **the subtree is a small fraction of its
parent**. Below three, no file — an empty file teaches people to ignore files,
and then no file saves them.

**If a candidate is dropped, its facts are not**: they move up to the parent,
paid for by a cut there. A dropped module must never mean evaporated knowledge —
that failure is invisible and permanent.

The bar is higher than it looks, because **every ancestor doc file loads, not
just the nearest one** (measured, not assumed). An intermediate file taxes every
read below it, forever.

### What a file carries

```yaml
---
scope: src/modules/task
read_before:
  - changing task transitions, dependencies or bulk operations
  - adding a new door that creates tasks
ripples_to:
  - mcp-server/src/tools/
---
```

`read_before` is phrased as **the task the reader is about to do**, never as the
module's name: "adding a vendor importer", not "the import module".

`ripples_to` is declared only where a real edge exists, **and only after
checking**. A false edge is worse than a missing one, because it will be
trusted.

Then a generated block, spliced between hand-placed markers:

```markdown
<!-- @map:start — generated by codegraph. Do not edit. -->
Points here: backend/src/modules/notification, mcp-server/src/tools
Before adding anything: codegraph find "<what you are about to write>"
<!-- @map:end -->
```

Those **backlinks — who declares they ripple here — are the half of the graph
that exists in no repo today.** Nobody writes them by hand. If the markers are
absent the writer reports and does nothing; it must never invent placement.

### The gate

`codegraph check` verifies **form, never truth**: paths resolve, cited symbols
exist somewhere in the tree, generated blocks are fresh, line budgets hold.
Generated blocks are exempt from the prose checks — an index is an inventory,
and the ban on inventories targets hand-written ones, which drift; a generated
one cannot, and `check` proves it.

Budgets are never raised. Over budget means cut prose.

### Naming

If the repo already has `AGENTS.md`, use that name. Otherwise `CLAUDE.md`. **One
convention per repo, never both.**

---

## Skill layout

```
codegraph/
  SKILL.md               when to reach for it, the workflow, the rules
  scripts/
    extract.mjs          passes 1 and 2 → index.json
    query.mjs            find · who · ripples · gaps
    twins.mjs            candidates → agent → twins.json
    check.mjs            the gate
    write-maps.mjs       splices generated blocks
  references/
    languages.md         the regex table, how to add a language
    writing-doc-files.md what earns a file, what goes in it, what never does
```

---

## Implementation order

Each step is verifiable against this repo before the next begins.

1. **Extractor** — pass 1, then pass 2 with import disambiguation. Verify by
   reading `index.json` against a tree you know.
2. **Commands** — `find` first; it is the one that justifies the tool.
3. **Twins** — candidates and thresholds first, report only. Tune until the
   output is all deliberate before an agent is ever dispatched.
4. **Pyramid** — frontmatter, then generated backlinks.
5. **Gate** — report mode first. Nothing is promoted to `check` until report
   shows only deliberate findings.

---

## Deliberately deferred

- **HTML visualisation.** Good for a human, useless to an agent.
- **Automatic refactoring of twins.** See above.
- **Languages beyond TS/JS, Dart and Astro.** The regex table is designed to be
  extended; extending it before there is a repo that needs it is speculation.
- **A git hook.** Until the incremental path is measured as fast, a hook is a
  tax on every commit.
