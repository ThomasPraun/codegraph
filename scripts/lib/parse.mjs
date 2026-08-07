// Symbol, comment and shape extraction.
//
// This file deliberately does not parse. It matches declarations with regex and
// finds bodies by counting braces. That is less precise than a real parser and
// it is the point: a tool that does not understand the code cannot be wrong
// about what the code means. Everything it emits is either literally present in
// the text or explicitly labelled as uncertain.

import { hash } from './scan.mjs'

// ---------------------------------------------------------------- declarations

const TS_DECL =
  /^[ \t]*export[ \t]+(?:default[ \t]+)?(?:declare[ \t]+)?(?:abstract[ \t]+)?(?:async[ \t]+)?(function\*?|class|interface|type|enum|const|let|var)[ \t]+([A-Za-z_$][\w$]*)/gm

const DART_TYPE_DECL =
  /^(?:(?:abstract|sealed|final|base|interface|mixin)[ \t]+)*(class|mixin|enum|extension|typedef)[ \t]+([A-Za-z_$][\w$]*)/gm

// A top-level Dart function: a return type, a name and a body, all at column 0.
const DART_FN =
  /^(?!(?:if|for|while|switch|catch|return|else)\b)[A-Za-z_$][\w$<>,.\s[\]?]*?[ \t]+([A-Za-z_$][\w$]*)[ \t]*\([^)]*\)[ \t]*(?:async[ \t]*\*?[ \t]*)?\{/gm

const KIND_ALIAS = { 'function*': 'function', const: 'const', let: 'const', var: 'const' }

// ------------------------------------------------------------------ tokenizing

const KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break',
  'continue', 'return', 'try', 'catch', 'finally', 'throw', 'new', 'await',
  'yield', 'typeof', 'instanceof', 'delete', 'void', 'this', 'super', 'null',
  'true', 'false', 'in', 'of', 'as', 'is',
])

const SHAPE_LETTER = {
  if: 'i', else: 'e', for: 'L', while: 'L', do: 'L', switch: 's', case: 'c',
  try: 't', catch: 'k', return: 'r', await: 'a', throw: 'x', new: 'n',
}

/**
 * Normalised token stream: identifiers collapse to `x`, literals to `0` and `s`.
 * Two functions that differ only in naming produce the same stream, which is
 * exactly the duplicate the inventory cannot catch by name.
 */
export function tokenize(body) {
  const out = []
  let i = 0
  const n = body.length
  while (i < n) {
    const c = body[i]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue }
    if (c === '/' && body[i + 1] === '/') {
      while (i < n && body[i] !== '\n') i++
      continue
    }
    if (c === '/' && body[i + 1] === '*') {
      i += 2
      while (i < n && !(body[i] === '*' && body[i + 1] === '/')) i++
      i += 2
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      i++
      while (i < n && body[i] !== quote) {
        if (body[i] === '\\') i++
        i++
      }
      i++
      out.push('s')
      continue
    }
    if (/[0-9]/.test(c)) {
      while (i < n && /[0-9._xa-fA-F]/.test(body[i])) i++
      out.push('0')
      continue
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i
      while (j < n && /[\w$]/.test(body[j])) j++
      const word = body.slice(i, j)
      out.push(KEYWORDS.has(word) ? word : 'x')
      i = j
      continue
    }
    const two = body.slice(i, i + 2)
    if (['=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--'].includes(two)) {
      out.push(two)
      i += 2
      continue
    }
    out.push(c)
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
    seen.add(hash(tokens.slice(i, i + gram).join('')))
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
export function bodyAt(text, from) {
  const open = text.indexOf('{', from)
  if (open < 0 || open - from > 400) return null
  let depth = 0
  let i = open
  const n = text.length
  while (i < n) {
    const c = text[i]
    if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++
      continue
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i++
      i += 2
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      i++
      while (i < n && text[i] !== quote) {
        if (text[i] === '\\') i++
        i++
      }
      i++
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return text.slice(open, i + 1)
    }
    i++
  }
  return null
}

// ------------------------------------------------------------------ comments

const AFFECTS = /^(?:affects?|afecta|ripples? into|repercute en)\s*[:：]\s*(.+)$/i

/**
 * The comment immediately above `line`, if any. Blank lines break the
 * association on purpose: a comment separated by a blank line is documenting
 * something else, and inheriting it would put a wrong description in the index.
 */
export function commentAbove(lines, line) {
  let i = line - 1
  const collected = []

  if (i >= 0 && /\*\/\s*$/.test(lines[i])) {
    const end = i
    while (i >= 0 && !/\/\*/.test(lines[i])) i--
    if (i < 0) return null
    for (let j = i; j <= end; j++) {
      collected.push(lines[j].replace(/^\s*\/\*+/, '').replace(/\*+\/\s*$/, '').replace(/^\s*\*+\s?/, ''))
    }
  } else {
    while (i >= 0 && /^\s*(\/\/\/?|#)\s?/.test(lines[i])) {
      collected.unshift(lines[i].replace(/^\s*(\/\/\/?|#)\s?/, ''))
      i--
    }
  }

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
 * The comment that opens a block, reading downwards. An `.astro` component has
 * no declaration to sit above — the file itself is the component — so its
 * description is whatever comment opens the frontmatter fence.
 */
export function commentBelow(lines, start) {
  let i = start
  while (i < lines.length && !lines[i].trim()) i++
  const collected = []
  if (/^\s*\/\*/.test(lines[i] || '')) {
    while (i < lines.length) {
      collected.push(lines[i].replace(/^\s*\/\*+/, '').replace(/\*+\/\s*$/, '').replace(/^\s*\*+\s?/, ''))
      if (/\*\//.test(lines[i])) break
      i++
    }
  } else if (/^\s*<!--/.test(lines[i] || '')) {
    while (i < lines.length) {
      collected.push(lines[i].replace(/^\s*<!--/, '').replace(/-->\s*$/, ''))
      if (/-->/.test(lines[i])) break
      i++
    }
  } else {
    while (i < lines.length && /^\s*\/\/\/?\s?/.test(lines[i])) {
      collected.push(lines[i].replace(/^\s*\/\/\/?\s?/, ''))
      i++
    }
  }
  if (!collected.length) return null
  return commentAbove([...collected.map((l) => `// ${l}`), ''], collected.length)
}

// ------------------------------------------------------------------- imports

const TS_IMPORT_FROM = /import\s+([\s\S]*?)\s+from\s*['"]([^'"]+)['"]/g
const TS_IMPORT_BARE = /import\s*['"]([^'"]+)['"]/g
const TS_REQUIRE = /(?:const|let|var)\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
const DART_IMPORT = /(?:import|export|part)\s+['"]([^'"]+)['"]([^;]*);/g

function namesFromClause(clause) {
  const names = []
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
 *  from a guess to a certainty, so a language with no support here has every
 *  edge labelled INFERRED. */
export function parseImports(text, lang) {
  const names = new Set()
  const specs = new Set()

  if (lang === 'dart') {
    for (const m of text.matchAll(DART_IMPORT)) {
      specs.add(m[1])
      const show = m[2] && m[2].match(/\bshow\s+([^;]+)/)
      if (show) for (const n of show[1].split(',')) names.add(n.trim())
    }
    return { names, specs }
  }

  for (const m of text.matchAll(TS_IMPORT_FROM)) {
    specs.add(m[2])
    for (const n of namesFromClause(m[1])) names.add(n)
  }
  for (const m of text.matchAll(TS_IMPORT_BARE)) specs.add(m[1])
  for (const m of text.matchAll(TS_REQUIRE)) {
    specs.add(m[2])
    for (const n of namesFromClause(m[1])) names.add(n)
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
export function stripNonCode(text) {
  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]
    if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') { out += ' '; i++ }
      continue
    }
    if (c === '/' && text[i + 1] === '*') {
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) { out += text[i] === '\n' ? '\n' : ' '; i++ }
      out += '  '
      i += 2
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      out += ' '
      i++
      while (i < n && text[i] !== quote) {
        if (text[i] === '\\') { out += ' '; i++ }
        out += text[i] === '\n' ? '\n' : ' '
        i++
      }
      out += ' '
      i++
      continue
    }
    out += c
    i++
  }
  return out
}

/** Every identifier a file actually uses — the raw material of pass 2's edges. */
export function identifiers(text) {
  const out = new Set()
  for (const m of stripNonCode(text).matchAll(/[A-Za-z_$][\w$]*/g)) out.add(m[0])
  return out
}

// --------------------------------------------------------------------- main

function pascalFromPath(path) {
  const base = path.split('/').pop().replace(/\.[^.]+$/, '')
  return base.replace(/(^|[-_.])([a-z])/g, (_, __, c) => c.toUpperCase())
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

function collect(text, lines, lineOf, re, kindFrom, path, seen, out) {
  re.lastIndex = 0
  for (const m of text.matchAll(re)) {
    const kind = kindFrom(m)
    const name = kind === 'component' ? pascalFromPath(path) : m[2] || m[1]
    if (!name || name.startsWith('_') || seen.has(name)) continue
    seen.add(name)
    const line = lineOf(m.index)
    const body = bodyAt(text, m.index)
    const tokens = body ? tokenize(body) : []
    const comment = commentAbove(lines, line)
    out.push({
      name,
      kind: KIND_ALIAS[kind] || kind,
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

/** Everything one file contributes to the graph, from a single read. */
export function parseFile(path, lang, text) {
  const lines = text.split('\n')
  const lineOf = lineIndex(text)
  const symbols = []
  const seen = new Set()

  if (lang === 'ts' || lang === 'astro') {
    collect(text, lines, lineOf, TS_DECL, (m) => m[1], path, seen, symbols)
  }

  if (lang === 'astro') {
    // The .astro file *is* the component; its own name is what other files use.
    const name = pascalFromPath(path)
    if (!seen.has(name)) {
      const fence = lines.findIndex((l) => l.trim() === '---')
      const comment = commentBelow(lines, fence >= 0 ? fence + 1 : 0)
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

  if (lang === 'dart') {
    collect(text, lines, lineOf, DART_TYPE_DECL, (m) => m[1], path, seen, symbols)
    collect(text, lines, lineOf, DART_FN, () => 'function', path, seen, symbols)
  }

  const { names, specs } = parseImports(text, lang)
  return {
    symbols,
    idents: [...identifiers(text)],
    importNames: [...names],
    importSpecs: [...specs],
  }
}
