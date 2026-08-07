// Symbol, comment and shape extraction.
//
// This file deliberately does not parse. It matches declarations with regex and
// finds bodies by counting braces or indentation. That is less precise than a
// real parser and it is the point: a tool that does not understand the code
// cannot be wrong about what the code means. Everything it emits is either
// literally present in the text or explicitly labelled as uncertain.
//
// Nothing here knows the name of a language. Every pattern arrives as data from
// languages.json, so a new language is a table entry, never a branch.

import { hash } from './scan.mjs'

const KIND_ALIAS = { 'function*': 'function', const: 'const', let: 'const', var: 'const' }

// What a tier-0 file — one whose language is unknown — is allowed to have
// blanked before its identifiers are read. Quotes delimit strings in nearly
// every language; comment syntax does not generalise, so it is left alone and
// the resulting edges carry the weakest label there is. Also the fallback when
// a caller passes no compiled spec at all.
const TIER0_C = {
  line: [], block: [], blockStrings: [], strings: ['"', "'"], lineRe: null, imports: [],
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * How far a string opened at `i` reaches, stopping at the end of the line for
 * every delimiter but the backtick.
 *
 * A quote inside a regex literal — `/['"]([^'"]+)['"]/` — opens a string that
 * has no close, and without this bound the blanking runs to the end of the
 * file and takes every declaration and every edge after it with it. Telling a
 * regex literal from a division needs context, which is parsing; a line is a
 * bound that needs none. Backticks are excluded because a template literal is
 * the one form that legitimately spans lines.
 */
function stringEnd(text, i, quote, n) {
  const spans = quote === '`'
  let j = i + 1
  while (j < n && text[j] !== quote) {
    if (text[j] === '\\') j++
    else if (!spans && text[j] === '\n') return j // unterminated: not a string
    j++
  }
  return Math.min(j + 1, n)
}

// ------------------------------------------------------------------ compiling

const cache = new WeakMap()

/** A language spec with its regexes built once. Compiling per file showed up in
 *  profiles long before anything else did. */
export function compile(spec) {
  if (!spec) return null
  const hit = cache.get(spec)
  if (hit) return hit
  const built = {
    spec,
    decls: (spec.decls || []).map((d) => ({ re: new RegExp(d.re, 'gm'), kind: d.kind, name: d.name })),
    imports: (spec.imports || []).map((i) => ({ ...i, re: new RegExp(i.re, 'gm') })),
    // Longest marker first, so `///` is never read as `//` with a stray slash.
    line: [...(spec.line || [])].sort((a, b) => b.length - a.length),
    block: spec.block || [],
    blockStrings: spec.blockStrings || [],
    strings: spec.strings || [],
    body: spec.body || 'braces',
    doc: spec.doc || 'above',
    privatePrefix: spec.privatePrefix === undefined ? '_' : spec.privatePrefix,
    lineRe: (spec.line || []).length
      ? new RegExp(`^\\s*(?:${[...(spec.line || [])].sort((a, b) => b.length - a.length).map(escapeRe).join('|')})\\s?`)
      : null,
  }
  cache.set(spec, built)
  return built
}

const at = (text, i, token) => text.startsWith(token, i)

// ------------------------------------------------------------------ tokenizing

const KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break',
  'continue', 'return', 'try', 'catch', 'finally', 'throw', 'new', 'await',
  'yield', 'typeof', 'instanceof', 'delete', 'void', 'this', 'super', 'null',
  'true', 'false', 'in', 'of', 'as', 'is',
  'def', 'end', 'elif', 'except', 'raise', 'with', 'lambda', 'match', 'fn',
])

const SHAPE_LETTER = {
  if: 'i', elif: 'i', else: 'e', for: 'L', while: 'L', do: 'L', switch: 's',
  match: 's', case: 'c', try: 't', catch: 'k', except: 'k', return: 'r',
  await: 'a', throw: 'x', raise: 'x', new: 'n',
}

/**
 * Normalised token stream: identifiers collapse to `x`, literals to `0` and `s`.
 * Two functions that differ only in naming produce the same stream, which is
 * exactly the duplicate the inventory cannot catch by name.
 */
export function tokenize(body, c = null) {
  const g = c || TIER0_C
  const out = []
  let i = 0
  const n = body.length
  while (i < n) {
    const ch = body[i]
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue }

    let skipped = false
    for (const [open, close] of g.blockStrings) {
      if (!at(body, i, open)) continue
      const end = body.indexOf(close, i + open.length)
      i = end < 0 ? n : end + close.length
      out.push('s')
      skipped = true
      break
    }
    if (skipped) continue

    for (const [open, close] of g.block) {
      if (!at(body, i, open)) continue
      const end = body.indexOf(close, i + open.length)
      i = end < 0 ? n : end + close.length
      skipped = true
      break
    }
    if (skipped) continue

    for (const marker of g.line) {
      if (!at(body, i, marker)) continue
      while (i < n && body[i] !== '\n') i++
      skipped = true
      break
    }
    if (skipped) continue

    if (g.strings.includes(ch)) {
      i++
      while (i < n && body[i] !== ch) {
        if (body[i] === '\\') i++
        i++
      }
      i++
      out.push('s')
      continue
    }
    if (/[0-9]/.test(ch)) {
      while (i < n && /[0-9._xa-fA-F]/.test(body[i])) i++
      out.push('0')
      continue
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i
      while (j < n && /[\w$]/.test(body[j])) j++
      const word = body.slice(i, j)
      out.push(KEYWORDS.has(word) ? word : 'x')
      i = j
      continue
    }
    const two = body.slice(i, i + 2)
    if (['=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '::'].includes(two)) {
      out.push(two)
      i += 2
      continue
    }
    out.push(ch)
    i++
  }
  return out
}

/** Short, readable control skeleton — what gets shown to a human. */
export function shapeOf(tokens) {
  const letters = []
  for (const t of tokens) {
    const l = SHAPE_LETTER[t]
    if (l && letters[letters.length - 1] !== l) letters.push(l)
  }
  return letters.join('')
}

/**
 * Bottom-k sketch of the token 5-grams. Comparable across files without
 * keeping the bodies around, and small enough to sit in the index.
 */
export function sketch(tokens, k = 32, gram = 5) {
  if (tokens.length < gram) return []
  const seen = new Set()
  for (let i = 0; i + gram <= tokens.length; i++) {
    seen.add(hash(tokens.slice(i, i + gram).join('')))
  }
  return [...seen].sort().slice(0, k)
}

/** Jaccard estimated from two bottom-k sketches. */
export function sketchSimilarity(a, b, k = 32) {
  if (!a.length || !b.length) return 0
  const union = [...new Set([...a, ...b])].sort().slice(0, k)
  const setA = new Set(a)
  const setB = new Set(b)
  let both = 0
  for (const h of union) if (setA.has(h) && setB.has(h)) both++
  return both / union.length
}

// -------------------------------------------------------------------- bodies

/**
 * The body starting at the first `{` after `from`, brace-counted while ignoring
 * braces inside strings and comments. Returns null when there is no body within
 * reach, which is the normal case for `export const N = 5`.
 */
export function bodyAt(text, from, c = null) {
  const g = c || TIER0_C
  const open = text.indexOf('{', from)
  if (open < 0 || open - from > 400) return null
  let depth = 0
  let i = open
  const n = text.length
  while (i < n) {
    const ch = text[i]

    let skipped = false
    for (const [o, cl] of g.block) {
      if (!at(text, i, o)) continue
      const end = text.indexOf(cl, i + o.length)
      i = end < 0 ? n : end + cl.length
      skipped = true
      break
    }
    if (skipped) continue
    for (const marker of g.line) {
      if (!at(text, i, marker)) continue
      while (i < n && text[i] !== '\n') i++
      skipped = true
      break
    }
    if (skipped) continue

    if (g.strings.includes(ch)) {
      i = stringEnd(text, i, ch, n)
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(open, i + 1)
    }
    i++
  }
  return null
}

const indentOf = (line) => line.length - line.trimStart().length

/**
 * The body of an indentation-delimited declaration: every following line more
 * indented than the declaration itself. Blank lines do not end it; the first
 * line back at or left of the declaration's column does.
 */
export function bodyByIndent(lines, declLine) {
  const base = indentOf(lines[declLine] || '')
  const out = []
  for (let i = declLine + 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) { out.push(line); continue }
    if (indentOf(line) <= base) break
    out.push(line)
  }
  while (out.length && !out[out.length - 1].trim()) out.pop()
  return out.length ? out.join('\n') : null
}

// ------------------------------------------------------------------ comments

const AFFECTS = /^(?:affects?|afecta|ripples? into|repercute en)\s*[:：]\s*(.+)$/i

function finish(collected) {
  const kept = collected.map((l) => l.trim()).filter(Boolean)
  if (!kept.length) return null

  let affects = null
  const prose = []
  for (const l of kept) {
    if (l.startsWith('@')) continue // JSDoc tags are signature, not purpose
    const m = l.match(AFFECTS)
    if (m) { affects = m[1].trim(); continue }
    prose.push(l)
  }
  const desc = prose.join(' ').replace(/\s+/g, ' ').trim().slice(0, 240)
  if (!desc && !affects) return null
  return { desc, affects }
}

/**
 * The comment immediately above `line`, if any. Blank lines break the
 * association on purpose: a comment separated by a blank line is documenting
 * something else, and inheriting it would put a wrong description in the index.
 */
export function commentAbove(lines, line, c = null) {
  const g = c || TIER0_C
  let i = line - 1
  const collected = []

  const closer = g.block.find(([, close]) => i >= 0 && new RegExp(`${escapeRe(close)}\\s*$`).test(lines[i] || ''))
  if (closer) {
    const [open, close] = closer
    const end = i
    while (i >= 0 && !lines[i].includes(open)) i--
    if (i < 0) return null
    for (let j = i; j <= end; j++) {
      collected.push(
        lines[j]
          .replace(new RegExp(`^\\s*${escapeRe(open)}+`), '')
          .replace(new RegExp(`${escapeRe(close)}\\s*$`), '')
          .replace(/^\s*\*+\s?/, '')
      )
    }
  } else if (g.lineRe) {
    while (i >= 0 && g.lineRe.test(lines[i])) {
      collected.unshift(lines[i].replace(g.lineRe, ''))
      i--
    }
  }

  return finish(collected)
}

/**
 * The comment that opens a block, reading downwards. An `.astro` component has
 * no declaration to sit above — the file itself is the component — so its
 * description is whatever comment opens the frontmatter fence.
 */
export function commentBelow(lines, start, c = null) {
  const g = c || TIER0_C
  let i = start
  while (i < lines.length && !lines[i].trim()) i++
  const collected = []

  const opener = g.block.find(([open]) => new RegExp(`^\\s*${escapeRe(open)}`).test(lines[i] || ''))
  if (opener) {
    const [open, close] = opener
    while (i < lines.length) {
      collected.push(
        lines[i]
          .replace(new RegExp(`^\\s*${escapeRe(open)}+`), '')
          .replace(new RegExp(`${escapeRe(close)}\\s*$`), '')
          .replace(/^\s*\*+\s?/, '')
      )
      if (lines[i].includes(close)) break
      i++
    }
  } else if (g.lineRe) {
    while (i < lines.length && g.lineRe.test(lines[i])) {
      collected.push(lines[i].replace(g.lineRe, ''))
      i++
    }
  }

  return finish(collected)
}

const LOOKAHEAD = 12

/**
 * The docstring that opens a body, for languages where the description sits
 * under the signature rather than above it. Reads at most `LOOKAHEAD` lines of
 * signature, so a call that merely spans lines cannot swallow the next block.
 */
export function docstringBelow(lines, declLine, c) {
  const quotes = (c.blockStrings || []).map(([open]) => open)
  if (!quotes.length) return null

  let i = declLine
  const limit = Math.min(lines.length, declLine + LOOKAHEAD)
  while (i < limit && !/:\s*(?:#.*)?$/.test(lines[i])) i++
  if (i >= limit) return null

  i++
  while (i < lines.length && !lines[i].trim()) i++
  const first = lines[i]
  if (!first) return null

  const quote = quotes.find((q) => first.trim().startsWith(q))
  if (!quote) return null

  const collected = []
  let rest = first.trim().slice(quote.length)
  if (rest.includes(quote)) {
    collected.push(rest.slice(0, rest.indexOf(quote)))
  } else {
    collected.push(rest)
    i++
    while (i < lines.length) {
      const line = lines[i]
      if (line.includes(quote)) { collected.push(line.slice(0, line.indexOf(quote))); break }
      collected.push(line)
      i++
    }
  }
  return finish(collected)
}

// ------------------------------------------------------------------- imports

function namesFromClause(clause, style) {
  const names = []
  if (style === 'show') {
    const show = clause.match(/\bshow\s+([^;]+)/)
    if (show) for (const n of show[1].split(',')) if (n.trim()) names.push(n.trim())
    return names
  }
  if (style === 'lastSegment') {
    const last = clause.trim().split(/[.\\]/).pop()
    if (last && last !== '*') names.push(last)
    return names
  }
  if (style === 'list') {
    for (const part of clause.replace(/[()]/g, '').split(',')) {
      const bit = part.trim().split(/\s+as\s+/)
      const name = (bit[1] || bit[0] || '').trim()
      if (name && name !== '*') names.push(name)
    }
    return names
  }
  if (style === 'pathBraced') {
    const braced = clause.match(/\{([\s\S]*)\}/)
    if (braced) {
      for (const part of braced[1].split(',')) {
        const name = part.trim().split('::').pop().split(/\s+as\s+/).pop().trim()
        if (name && name !== '*' && name !== 'self') names.push(name)
      }
      return names
    }
    const last = clause.trim().split('::').pop().split(/\s+as\s+/).pop().trim()
    if (last && last !== '*') names.push(last)
    return names
  }

  // braced — the default: `import Thing, { a, b as c } from '…'`
  const braced = clause.match(/\{([\s\S]*)\}/)
  if (braced) {
    for (const part of braced[1].split(',')) {
      const bit = part.trim().split(/\s+as\s+/)
      const name = (bit[1] || bit[0] || '').trim()
      if (name) names.push(name.replace(/^type\s+/, ''))
    }
  }
  const outside = clause.replace(/\{[\s\S]*\}/, '')
  for (const m of outside.matchAll(/(?:^|,)\s*(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)/g)) {
    if (m[1] && m[1] !== 'type') names.push(m[1])
  }
  return names
}

/** Imported names and raw specifiers. This is what upgrades a substring match
 *  from a guess to a certainty, so a language with no rules here has every
 *  edge labelled INFERRED, and a file with no language at all MENTIONED. */
export function parseImports(text, c = null) {
  const names = new Set()
  const specs = new Set()
  if (!c) return { names, specs }

  for (const rule of c.imports) {
    rule.re.lastIndex = 0
    for (const m of text.matchAll(rule.re)) {
      if (rule.spec && m[rule.spec]) specs.add(m[rule.spec].trim())
      if (rule.specsFrom && m[rule.specsFrom]) {
        for (const q of m[rule.specsFrom].matchAll(/['"]([^'"]+)['"]/g)) specs.add(q[1])
      }
      if (rule.clause && m[rule.clause]) {
        for (const n of namesFromClause(m[rule.clause], rule.style)) names.add(n)
      }
    }
  }
  return { names, specs }
}

// ---------------------------------------------------------------- identifiers

/**
 * Comments and string literals blanked out, positions preserved.
 *
 * Without this, prose creates edges: a comment that says "run this first"
 * makes every file mentioning it look like a caller of `run`. Those show up as
 * usage counts and reorder the gaps list, which is the one place the ordering
 * has to be trustworthy.
 */
export function stripNonCode(text, c = null) {
  const g = c || TIER0_C
  let out = ''
  let i = 0
  const n = text.length

  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) out += text[k] === '\n' ? '\n' : ' '
    return Math.min(to, n)
  }

  while (i < n) {
    let skipped = false

    for (const [open, close] of g.blockStrings) {
      if (!at(text, i, open)) continue
      const end = text.indexOf(close, i + open.length)
      i = blank(i, end < 0 ? n : end + close.length)
      skipped = true
      break
    }
    if (skipped) continue

    for (const [open, close] of g.block) {
      if (!at(text, i, open)) continue
      const end = text.indexOf(close, i + open.length)
      i = blank(i, end < 0 ? n : end + close.length)
      skipped = true
      break
    }
    if (skipped) continue

    for (const marker of g.line) {
      if (!at(text, i, marker)) continue
      let j = i
      while (j < n && text[j] !== '\n') j++
      i = blank(i, j)
      skipped = true
      break
    }
    if (skipped) continue

    const ch = text[i]
    if (g.strings.includes(ch)) {
      i = blank(i, stringEnd(text, i, ch, n))
      continue
    }
    out += ch
    i++
  }
  return out
}

/** Every identifier a file actually uses — the raw material of pass 2's edges. */
export function identifiers(text, c = null) {
  const out = new Set()
  for (const m of stripNonCode(text, c).matchAll(/[A-Za-z_$][\w$]*/g)) out.add(m[0])
  return out
}

// --------------------------------------------------------------------- main

function pascalFromPath(path) {
  const base = path.split('/').pop().replace(/\.[^.]+$/, '')
  return base.replace(/(^|[-_.])([a-z])/g, (_, __, ch) => ch.toUpperCase())
}

function lineIndex(text) {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1)
  return (offset) => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return lo
  }
}

// Declarations match the RAW text, not the blanked copy. Blanking would stop a
// code sample inside a string from declaring a symbol, which is real but rare —
// and it costs more than it saves: one backtick or quote inside a regex literal
// blanks a span that swallows real declarations after it, and those vanish with
// no sign. A phantom symbol is visible in `gaps`; a missing one is invisible.
function collect(text, lines, lineOf, rule, c, seen, out) {
  rule.re.lastIndex = 0
  for (const m of text.matchAll(rule.re)) {
    const kind = typeof rule.kind === 'number' ? m[rule.kind] : rule.kind
    const name = m[rule.name]
    if (!name || seen.has(name)) continue
    if (c.privatePrefix && name.startsWith(c.privatePrefix)) continue
    seen.add(name)

    const line = lineOf(m.index)
    const body = c.body === 'braces'
      ? bodyAt(text, m.index, c)
      : c.body === 'indent'
        ? bodyByIndent(lines, line)
        : null
    const tokens = body ? tokenize(body, c) : []
    const comment = c.doc === 'below'
      ? docstringBelow(lines, line, c)
      : commentAbove(lines, line, c)

    out.push({
      name,
      kind: KIND_ALIAS[kind] || kind || 'symbol',
      line: line + 1,
      desc: comment?.desc || '',
      affects: comment?.affects || '',
      bodyHash: body ? hash(body.replace(/\s+/g, ' ')) : '',
      tokenCount: tokens.length,
      shape: shapeOf(tokens),
      sketch: sketch(tokens),
    })
  }
}

/**
 * Everything one file contributes to the graph, from a single read. A `spec` of
 * null is tier 0: the file is a source of identifiers and nothing else, because
 * guessing at a declaration syntax invents symbols, and an invented symbol
 * floods gaps and poisons find.
 */
export function parseFile(path, spec, text) {
  const c = compile(spec)
  if (!c) {
    return { symbols: [], idents: [...identifiers(text, null)], importNames: [], importSpecs: [] }
  }

  const lines = text.split('\n')
  const lineOf = lineIndex(text)
  const symbols = []
  const seen = new Set()

  for (const rule of c.decls) collect(text, lines, lineOf, rule, c, seen, symbols)

  if (spec.fileIsComponent) {
    // The file *is* the component; its own name is what other files use.
    const name = pascalFromPath(path)
    if (!seen.has(name)) {
      const fence = lines.findIndex((l) => l.trim() === '---')
      const comment = commentBelow(lines, fence >= 0 ? fence + 1 : 0, c)
      symbols.push({
        name,
        kind: 'component',
        line: 1,
        desc: comment?.desc || '',
        affects: comment?.affects || '',
        bodyHash: hash(text.replace(/\s+/g, ' ')),
        tokenCount: 0,
        shape: '',
        sketch: [],
      })
    }
  }

  const { names, specs } = parseImports(text, c)
  return {
    symbols,
    idents: [...identifiers(text, c)],
    importNames: [...names],
    importSpecs: [...specs],
  }
}
