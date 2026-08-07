# The root CLAUDE.md

The standing orders for a repo: what an agent must know before touching
anything, every session, without being told twice. Copy the template below into
`<repo>/CLAUDE.md`, then cut what does not apply and add what the owner wants
never forgotten.

When setting a project up, also add to its `.gitignore` (create one if absent):

```gitignore
codegraph/index.json
codegraph/.cache.json
```

## What belongs here, and what does not

| Root | A sub-file |
|---|---|
| How to use the index | What this subtree does and how it hangs together |
| Documentation conventions, including these | Invariants and gotchas of this subtree |
| That the pyramid exists and how it works | Procedures local to it |
| Rules the owner wants always remembered | What a change here ripples into |

**The root never explains the code.** It is loaded on every read of every file
in the repo, so a line here is paid thousands of times. Explanation belongs in a
sub-file, which is paid only when someone works in that subtree — that is what
makes it on demand rather than always-on.

Keep it short enough that nobody skims it. Everything below is optional except
the index rules and the conventions.

## The template

````markdown
---
scope: .
---

# <project>

## The index

`codegraph/` holds an index of every exported symbol, its comment, and who
uses it. It is **never rebuilt automatically** — ask before rebuilding.

`index.json` and `.cache.json` are gitignored: they are derived and rebuilt in
under a second. `twins.json`, `freshness.json` and `languages.json` are in git,
because each holds a decision somebody made.

```bash
node <path>/scripts/query.mjs find "<purpose>" --root .   # does this exist already?
node <path>/scripts/query.mjs ripples <path|symbol>       # what reaches what I touched
node <path>/scripts/query.mjs gaps [dir]                  # exported, uncommented, most-used first
node <path>/scripts/extract.mjs .                         # rebuild — only when asked
```

- Search by **purpose in plain words**, not by the name you were going to use.
  The duplicate has a different name; that is why nobody found it.
- **A thin result is a miss, not proof of absence.** Grep before concluding
  something does not exist.
- Every command warns when the index is behind the tree. Report it and **offer**
  to rebuild. Never rebuild unasked.

## Documentation

- Every exported symbol carries a comment **immediately above it**, one line
  saying what it is for. A blank line between comment and declaration breaks the
  association.
- The comment is the only place a description lives. Never restate it elsewhere.
- When you touch code that has no comment, **offer to write one**. When a whole
  directory is undocumented, offer to work through it — `gaps <dir>`, most-used
  first, one directory at a time, showing the diff.

## The CLAUDE.md pyramid

Files below this one carry the context for their own subtree. **Every ancestor
loads, not just the nearest**, so a file halfway down is paid on every read
below it.

- Read the file whose scope covers what you are about to change.
- A directory earns a file when it holds **three or more things the code will
  not tell you**. Below three, the facts move up to the parent.
- Aim for **200 lines**. Past that, ask whether a subtree deserves its own file
  before cutting anything worth keeping.
- Say it in as few tokens as the idea survives. Dense beats long.
- Never edit between `@map` markers — that block is generated.
- After changing code, the gate says which files the change moved the ground
  under. Re-read those, fix what stopped being true, and **offer** to record
  them reviewed.

## Always

<!-- What the owner wants remembered every session. Delete if empty. -->
````
