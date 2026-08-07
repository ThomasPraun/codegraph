# Languages

What the extractor recognises, and how to add one.

## Contents

- [What is recognised today](#what-is-recognised-today)
- [Comment forms](#comment-forms)
- [Adding a language](#adding-a-language)
- [What the extractor deliberately cannot do](#what-the-extractor-deliberately-cannot-do)

## What is recognised today

| Language | Extensions | Declarations found |
|---|---|---|
| TypeScript / JavaScript | `.ts .tsx .mts .cts .js .jsx .mjs .cjs` | `export function\|class\|interface\|type\|enum\|const\|let\|var Name` |
| Dart / Flutter | `.dart` | top-level `class`, `mixin`, `enum`, `extension`, `typedef`, and top-level functions with a body |
| Astro | `.astro` | the file itself is the component; plus `export` inside the frontmatter fence |

Only public symbols are indexed. In Dart, a leading `_` means private and is
skipped.

## Comment forms

The description is the comment **immediately above** the declaration. A blank
line between them breaks the association on purpose — a comment separated by a
blank line is documenting something else, and inheriting it would put a wrong
description in the index.

| Form | Example |
|---|---|
| JSDoc block | `/** Formats an amount. */` |
| Line comments | `// Formats an amount.` |
| Dart doc | `/// Formats an amount.` |
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

Three edits, all in `scripts/lib/`:

1. **`scan.mjs`** — add the extensions to `LANG_BY_EXT`, mapping to a language
   key. Add any build directory the language produces to `ALWAYS_SKIP`.
2. **`parse.mjs`** — add a declaration regex in the style of `TS_DECL` /
   `DART_TYPE_DECL`, then a `collect(...)` call for the new key in `parseFile`.
   Anchor patterns to the start of a line with `^` and the `m` flag; that alone
   removes most false matches from inside function bodies.
3. **`parse.mjs`, `parseImports`** — teach it how the language imports, so edges
   can be labelled `EXTRACTED` instead of `INFERRED`. This is the part worth the
   effort: without it, every edge in that language is a guess.

If the language has no `{}` bodies, `bodyAt` returns null. Symbols still index;
they simply never take part in shape-based twin detection.

## What the extractor deliberately cannot do

It does not parse. It matches declarations with regex and finds bodies by
counting braces, and that is the design, not a shortcut — a tool that does not
understand the code cannot be wrong about what the code means.

The consequences are real and should be stated rather than papered over:

- Dynamic dispatch, re-exports and string-built names produce no edge.
- A symbol reached only through a barrel file may show fewer callers than it has.
- `INFERRED` and `AMBIGUOUS` exist because the alternative is a confident
  answer that happens to be wrong.

Every command therefore ends with the same line: a thin result is a miss, not
proof of absence. Keep it there.
