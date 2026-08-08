# The root CLAUDE.md

`init.mjs` writes one section into a repo's root `CLAUDE.md`: how to use the
index. This file explains what it writes, why it is fixed, and what belongs
around it.

```bash
node scripts/init.mjs <repo>
```

It appends and never rewrites. Run twice, the second run does nothing.

## What it writes

A `## The index` section: the four commands, and the four rules that decide
whether the index is worth having.

- **Search by purpose, in plain words.** The duplicate has a different name —
  that is why nobody found it. Searching by the name you were about to use
  finds nothing and proves nothing.
- **A thin result is a miss, not proof of absence.** The extractor matches
  text; it does not understand code. Without this line an empty result reads
  as permission to write the duplicate.
- **Descriptions live above the symbol, in the code.** The index harvests
  them. A description kept anywhere else starts true and ends fictional with
  nothing detecting the transition.
- **Never rebuild unasked.** An index rebuilt behind someone's back changes
  answers they were in the middle of using.

Replace `<skill>` in the written commands with the path the skill is installed
at, so they are copy-pasteable from inside that repo.

## Why the text is fixed

It names no symbol, cites no path inside the repo and counts nothing. There is
therefore no version of it that can be behind the code.

That is the whole design. A block generated from the index would need a marker
to find it, a regeneration step to refresh it, and a record of when a person
last checked the prose around it — three mechanisms, each able to be wrong
about a repo it only reads, and each needing to be maintained for as long as
the repo lives. Fixed text needs none of them, and it is not obviously less
useful: an agent that knows the index exists can query it, and querying beats
reading an inventory that was accurate yesterday.

**This is the line to hold.** The moment something generated goes back into a
doc file, all three mechanisms come back with it.

## What belongs around it

Everything else in that file is the owner's:

- Rules they want remembered every session — conventions, house rules, the
  thing that bites every newcomer.
- How the project works, where that cannot be read off the code.
- What must stay true, and what breaks when it does not.

None of that is this skill's business to write, generate or check. Offer to add
what the owner asks for; never reorganise what is already there.

Keep it short enough that nobody skims it. The root file loads on every read of
every file in the repo, so a line here is paid thousands of times.

## One convention per repo

If `AGENTS.md` is already in use, that is the name; otherwise `CLAUDE.md`.
`init.mjs` follows whichever it finds and creates `CLAUDE.md` when there is
neither. Never both — mixing them splits the context in half, and readers load
only one.

## And the .gitignore

`extract.mjs` reports these when they are missing, and never adds them itself:

```gitignore
codegraph/index.json
codegraph/.cache.json
```

Both are derived and rebuilt in under a second. Committed, they turn every
code change into a thousand-line diff. Everything else under `codegraph/`
holds a decision a person made — a twin verdict, a language taught — and
belongs in git.
