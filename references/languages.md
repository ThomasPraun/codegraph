# Languages

What the extractor recognises, how much of a language it needs, and how to add
one.

## Contents

- [The four tiers](#the-four-tiers)
- [What is recognised today](#what-is-recognised-today)
- [Comment forms](#comment-forms)
- [Adding a language](#adding-a-language)
- [The table format](#the-table-format)
- [What the extractor deliberately cannot do](#what-the-extractor-deliberately-cannot-do)

## The four tiers

A language does not have to be fully described to be useful. Each piece that is
missing costs a specific capability, and says so in a label — it never fails
silently.

| Tier | What the table gives it | What you get |
|---|---|---|
| **0** | nothing — the extension is unknown | edges only, every one `MENTIONED` |
| **1** | comments + declarations | symbols, `find`, `gaps`, `who` |
| **2** | + a body rule (`braces` / `indent`) | bodies → shapes → `twins` |
| **3** | + import rules that resolve | edges upgrade to `EXTRACTED` |

**Tier 0 never guesses at declarations.** An invented symbol has no description,
so it lands in `gaps` and stays there, and it pollutes `find` — that is worse
than not indexing the file. A tier-0 file is only ever a *source* of edges, and
those edges carry `MENTIONED`: the file had no comment syntax to blank, so the
name may be sitting in prose rather than in code.

`MENTIONED` edges appear in `who` and `ripples`, where a human reads the label.
They are excluded from the usage count that orders `gaps` — see `usageCount` in
`graph.mjs`. That ordering is the one place a phantom edge does real damage.

Prose and data extensions are never indexed at all, at any tier — see
`NEVER_INDEXED`. A README saying "run this first" would otherwise give `run`
callers it does not have.

## What is recognised today

| Language | Extensions | Tier | Bodies |
|---|---|---|---|
| TypeScript / JavaScript | `.ts .tsx .mts .cts .js .jsx .mjs .cjs` | 3 | braces |
| Astro | `.astro` | 3 | braces |
| Dart / Flutter | `.dart` | 3 | braces |
| Python | `.py .pyi` | 3 | indent |
| Rust | `.rs` | 3 | braces |
| Java | `.java` | 3 | braces |
| Kotlin | `.kt .kts` | 3 | braces |
| C# | `.cs` | 3 | braces |
| PHP | `.php` | 3 | braces |
| Swift | `.swift` | 2 | braces |
| Go | `.go` | 2 | braces |
| Ruby | `.rb` | 1 | none |

Only public symbols are indexed, and what "public" means is written into each
language's declaration pattern. Two shapes, and picking the wrong one is the
easiest way to ship a language that finds nothing:

- **Opt-in** — a marker makes a symbol visible: `export` in TypeScript, `pub` in
  Rust, a capital initial in Go. Require the marker.
- **Opt-out** — everything is visible until marked otherwise: Swift is
  `internal` by default, Java is package-private, Kotlin and C# members are
  public or internal. Exclude `private` and `fileprivate`; require nothing.

Requiring `public` in an opt-out language indexes **zero symbols** from ordinary
code, which is what Swift did until a fixture written from real code caught it.
A leading `_` is treated as private everywhere unless the table says otherwise.

Ruby is at tier 1 on purpose. Its blocks close with `end`, which also closes
`if`, `while` and `do`, and a modifier `if` closes nothing — counting them would
invent bodies rather than miss them. A missing body costs twin detection; an
invented one corrupts it.

Go is at tier 2 because files in the same package see each other without
importing, so most intra-package edges can only ever be `INFERRED`.

## Comment forms

The description is the comment **immediately above** the declaration, unless the
language's table entry says `"doc": "below"` — Python's docstring sits under the
signature, not over it.

A blank line between comment and declaration breaks the association on purpose:
a comment separated by a blank line is documenting something else, and
inheriting it would put a wrong description in the index.

| Form | Example |
|---|---|
| JSDoc block | `/** Formats an amount. */` |
| Line comments | `// Formats an amount.` |
| Doc line comments | `/// Formats an amount.` (Dart, Rust, Swift, C#) |
| Hash line comments | `# Formats an amount.` (Python, Ruby, PHP) |
| Docstring | `"""Formats an amount."""` (Python, below the signature) |
| HTML comment | `<!-- Checkout screen. -->` (Astro, no frontmatter) |

An `.astro` component has no declaration to sit above, so its description is
whatever comment opens the frontmatter fence.

`@param`-style JSDoc tags are skipped: they restate the signature, and the
index already has it.

### The `Affects:` clause

A line matching `Affects:`, `Ripples into:`, `Afecta:` or `Repercute en:` is
harvested separately and shown by `find`:

```ts
/**
 * Formats an amount into local currency.
 * Affects: invoices, checkout, PDF exports
 */
```

Use it for what a change here reaches that the import graph cannot see —
generated documents, external consumers, hand-copied logic.

## Adding a language

**It is a data edit, not a code edit.** Nothing in `parse.mjs` knows the name of
a language; every pattern arrives from `languages.json`. Add an entry there, or
in `<repo>/codegraph/languages.json` to add or replace one for a single repo
without touching the skill.

Start at tier 1 and stop whenever the next tier stops being worth it:

1. **`exts`, comment markers, `decls`** — tier 1. Anchor every declaration
   pattern with `^` (the `m` flag is added for you); that alone removes most
   false matches from inside function bodies. Then decide opt-in or opt-out (see
   above) — get it backwards and the language finds nothing.
2. **`body`** — tier 2. `braces`, `indent`, or `none`. Choose `none` over a rule
   that might be wrong: an invented body produces a false twin, which costs more
   than a missing one.
3. **`imports` and `resolve`** — tier 3. This is the part worth the effort:
   without it every edge in that language is a guess.

Add any build directory the language produces to `ALWAYS_SKIP` in `scan.mjs`.

Then add a case to `tests/fixtures.json`, and **write the fixture from real code
before writing the pattern** — copy a file out of an actual project, keep its
control flow, keep its unmarked declarations. A fixture written afterwards tests
the pattern you just wrote, agrees with it, and proves nothing. That is how
Swift shipped matching `public` only, passing its test, and finding zero symbols
in every ordinary Swift file.

Include in every fixture: a declaration with no visibility marker, one marked
private, an annotated one, a generic return type, and a body with `if` / `for`
/ `while` / `catch` in it. Each catches a fault that has actually shipped here:

| In the fixture | What it caught |
|---|---|
| No visibility marker | Swift required `public`, so ordinary code indexed **zero** |
| A `private` one | a rule on the wrong side of the trade |
| An annotation above it | `@Service` broke the comment link, losing the description |
| A generic return type | C# had **no method rule at all** — types only, every method missing |
| A receiver, in Kotlin | `fun Long.asMoney()` was indexed as `Long` |
| Control flow in a body | a pattern loose enough to read `if (` as a declaration |

Every one of those passed a fixture written *after* the pattern. Four of them
were found the first time a file was written the way real code is written.

## The table format

```json
"python": {
  "label": "Python",
  "exts": [".py", ".pyi"],
  "line": ["#"],
  "block": [],
  "blockStrings": [["\"\"\"", "\"\"\""]],
  "strings": ["\"", "'"],
  "body": "indent",
  "doc": "below",
  "decls": [
    { "re": "^(?:async[ \\t]+)?(def|class)[ \\t]+([A-Za-z_][\\w]*)", "kind": 1, "name": 2 }
  ],
  "imports": [
    { "re": "^[ \\t]*from[ \\t]+([\\w.]+)[ \\t]+import[ \\t]+([^\\n]+)",
      "spec": 1, "clause": 2, "style": "list" }
  ],
  "resolve": { "specSep": ".", "index": true, "indexName": "__init__" }
}
```

- `kind` — a group number to read the kind from, or a literal string.
- `name` — the group number holding the symbol name.
- `docSkip` — lines allowed between the comment and the declaration without
  breaking the association. Annotations are the whole reason it exists:
  `@Service`, `@Composable`, `[HttpGet]` and `#[Attribute]` are written under
  the comment and above the declaration, and counted as a blank line they cost
  the description of exactly the classes most likely to carry one.
- `privatePrefix` — defaults to `_`; set to `""` where that is not the
  convention.
- `fileIsComponent` — the file itself is a symbol, named from its path.
- Import `style` — how names are read out of the matched clause: `braced`
  (default), `list`, `show`, `lastSegment`, `pathBraced`. `specsFrom` pulls
  every quoted path out of one group, for block-form imports.
- `resolve` — `specSep` turns a dotted or `::` path into a file path,
  `stripSpecPrefixes` drops leading `crate`/`self`/`super`, `aliasRoots` are
  the source roots to try, `index`/`indexName` handle directory modules,
  `packagePrefix`/`packageRoot`/`packageDropSegments` handle `package:`-style
  specifiers, `lastSegments` tries every suffix of a host-prefixed module path.

Regexes are JSON strings, so every backslash is doubled.

## What the extractor deliberately cannot do

It does not parse. It matches declarations with regex and finds bodies by
counting braces or indentation, and that is the design, not a shortcut — a tool
that does not understand the code cannot be wrong about what the code means.

Adding languages does not change that, and must not. The table got bigger; the
extractor did not get smarter. "Support for a language" here means a set of
patterns and a set of labels for where they run out — never a claim to
understand it.

The consequences are real and should be stated rather than papered over:

- Dynamic dispatch, re-exports and string-built names produce no edge.
- A symbol reached only through a barrel file may show fewer callers than it has.
- A regex literal is not recognised, so a quote inside one reads as a string.
  `stringEnd` bounds the damage to that line; a backtick inside a regex still
  blanks until the next backtick, and any edge in between is lost.
- Code inside a string or a comment still declares a symbol, because
  declarations match the raw text. That is the deliberate side the trade falls
  on — see the comment on `collect`.
- `INFERRED`, `AMBIGUOUS` and `MENTIONED` exist because the alternative is a
  confident answer that happens to be wrong.

Every command therefore ends with the same line: a thin result is a miss, not
proof of absence. Keep it there.
