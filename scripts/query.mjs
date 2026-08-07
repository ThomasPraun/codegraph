#!/usr/bin/env node
// The lens. Reads codegraph/index.json and answers one question at a time,
// always against a cap.
//
//   node scripts/query.mjs find "formatear moneda" [--root .] [--limit 8]
//   node scripts/query.mjs who formatearMoneda
//   node scripts/query.mjs ripples src/utils/money.ts
//   node scripts/query.mjs gaps [path]

import { load, words, nameWords, overlap, capped, NOT_PROOF, stalenessLine } from './lib/graph.mjs'
import { languagesFor, ignoreEpipe, isMain } from './lib/scan.mjs'
import { sketchSimilarity } from './lib/parse.mjs'
import { join, dirname } from 'node:path'

// The path this run was invoked with, so printed commands are copy-pasteable
// from wherever the skill is installed. `scripts/...` is only right while
// codegraph is the repo being indexed.
const here = (name) => `node ${join(dirname(process.argv[1] || '.'), name)}`

const TWIN_HINT = 0.6

const FLAGS_WITH_VALUE = new Set(['--root', '--limit'])

function parseArgs(argv) {
  const flags = {}
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    if (FLAGS_WITH_VALUE.has(argv[i])) {
      flags[argv[i].slice(2)] = argv[++i]
    } else if (argv[i].startsWith('--')) {
      flags[argv[i].slice(2)] = true
    } else {
      positional.push(argv[i])
    }
  }
  return { flags, positional }
}

function label(s) {
  return `${s.name}  ·  ${s.file}${s.kind ? `  [${s.kind}]` : ''}`
}

// --------------------------------------------------------------------- find

/** Symbols whose description, name or path overlap the query, best first.
 *  Exported so its ranking can be tested; the CLI is the only other caller. */
export function find(g, query, limit) {
  const q = words(query)
  const scored = []

  for (const s of g.index.symbols) {
    const byDesc = overlap(q, words(s.desc))
    const byName = overlap(q, nameWords(s.name))
    // The path is the weakest evidence and the only one a repo has before
    // anyone writes a comment — `src/checkout/totals.ts` answers "checkout
    // total" when the symbol is called `compute` and carries no description.
    const byPath = overlap(q, nameWords(s.file.replace(/\.[^./]+$/, '').replace(/\//g, ' ')))
    const score = Math.max(byDesc, byName * 0.9, byPath * 0.6)
    if (score > 0.15) scored.push({ s, score })
  }
  scored.sort((a, b) => b.score - a.score || g.usageCount(b.s) - g.usageCount(a.s))

  if (!scored.length) {
    return `Nothing matched "${query}".\n${NOT_PROOF}\nTry fewer words, or the name you would have given it.`
  }

  const lines = capped(scored, Number(limit), ({ s }) => {
    const used = g.usageCount(s)
    const parts = [`  ${label(s)}`]
    if (s.desc) parts.push(`      ${s.desc}`)
    parts.push(`      used by ${used} file${used === 1 ? '' : 's'}${s.affects ? ` · affects ${s.affects}` : ''}`)

    // A near-identical sibling is the answer the query was really after.
    for (const other of g.index.symbols) {
      if (other === s || !s.sketch?.length) continue
      if (sketchSimilarity(s.sketch, other.sketch || []) >= TWIN_HINT) {
        parts.push(`      ⚠ near-identical to ${other.name} (${other.file}) — see: twins`)
        break
      }
    }
    return parts.join('\n')
  })

  return `${lines}\n\n${NOT_PROOF}`
}

// ---------------------------------------------------------------------- who

function who(g, name, limit) {
  const decls = g.byName.get(name)
  if (!decls) return `No symbol named "${name}" in the index.\n${NOT_PROOF}`

  const out = []
  for (const s of decls) {
    out.push(label(s))
    if (s.desc) out.push(`  ${s.desc}`)

    const incoming = (g.usedBy.get(name) || []).filter((e) => e.at === s.file && e.from !== s.file)
    out.push(`  used by (${incoming.length}):`)
    out.push(incoming.length
      ? capped(incoming, Number(limit), (e) => `    ${e.from}  [${e.conf}]`)
      : '    nobody — either dead, or reached in a way this tool cannot see')

    const outgoing = (g.uses.get(s.file) || []).filter((e) => e.at !== s.file)
    out.push(`  this file uses (${outgoing.length}):`)
    if (outgoing.length) out.push(capped(outgoing, Number(limit), (e) => `    ${e.to}  ·  ${e.at}  [${e.conf}]`))
    out.push('')
  }
  return out.join('\n')
}

// ------------------------------------------------------------------ ripples

function ripples(g, target, limit) {
  const isFile = target.includes('/') || target.includes('.')
  const owned = g.index.symbols.filter((s) => (isFile ? s.file.startsWith(target) : s.name === target))
  if (!owned.length) return `Nothing in the index under "${target}".\n${NOT_PROOF}`

  const touched = new Map()
  for (const s of owned) {
    for (const e of g.usedBy.get(s.name) || []) {
      if (e.at !== s.file || e.from === s.file) continue
      if (!touched.has(e.from)) touched.set(e.from, [])
      touched.get(e.from).push(`${e.to} [${e.conf}]`)
    }
  }

  const rows = [...touched.entries()].sort((a, b) => b[1].length - a[1].length)
  const head = `Touching ${target} reaches ${rows.length} file${rows.length === 1 ? '' : 's'}:`
  if (!rows.length) {
    return `${head}\n  nothing the index can see.\n${NOT_PROOF}`
  }
  return [
    head,
    capped(rows, Number(limit), ([file, via]) => `  ${file}\n      via ${via.join(', ')}`),
    '',
    'Doc files whose scope covers those paths must be re-read before shipping:',
    `  ${here('check.mjs')}`,
    '',
    NOT_PROOF,
  ].join('\n')
}

// ----------------------------------------------------------------- gaps

function gaps(g, path, limit) {
  const holes = g.index.symbols
    .filter((s) => !s.desc && (!path || s.file.startsWith(path)))
    .map((s) => ({ s, used: g.usageCount(s) }))
    .sort((a, b) => b.used - a.used)

  if (!holes.length) return `Every exported symbol${path ? ` under ${path}` : ''} carries a comment.`

  // Ordered by usage, never alphabetically: a symbol twelve files depend on
  // hurts twelve times more than one nobody imports.
  const total = holes.length
  const worst = holes.filter((h) => h.used > 0).length
  return [
    `${total} exported symbol${total === 1 ? '' : 's'} without a comment` +
      `${path ? ` under ${path}` : ''} · ${worst} of them are used by other files.`,
    'Most-used first — writing those first removes most of the damage.',
    '',
    capped(holes, Number(limit), ({ s, used }) => `  ${used.toString().padStart(3)} uses   ${label(s)}`),
    '',
    'Write the comment above the symbol, in the code. Never in the index.',
  ].join('\n')
}

// ---------------------------------------------------------------------- cli

function main() {
  ignoreEpipe()
  const { flags, positional } = parseArgs(process.argv.slice(2))
  const [cmd, subject] = positional
  const root = flags.root || '.'
  const limit = flags.limit || (cmd === 'gaps' ? '15' : '8')

  const g = load(root)
  // Before the answer, never after: a reader who has the result already has
  // stopped reading.
  process.stdout.write(stalenessLine(root, languagesFor(root).byExt))
  let out
  switch (cmd) {
    case 'find': out = find(g, subject || '', limit); break
    case 'who': out = who(g, subject || '', limit); break
    case 'ripples': out = ripples(g, subject || '', limit); break
    case 'gaps': out = gaps(g, subject || '', limit); break
    default:
      process.stderr.write('usage: query.mjs <find|who|ripples|gaps> [subject] [--root .] [--limit N]\n')
      process.exit(2)
  }
  process.stdout.write(`${out}\n`)
}

// Only run as a command: an unguarded main() turns `import` into a side effect.
if (isMain(import.meta.url)) main()
