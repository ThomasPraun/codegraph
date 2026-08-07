#!/usr/bin/env node
// The lens. Reads codegraph/index.json and answers one question at a time,
// always against a cap.
//
//   node scripts/query.mjs status                       where this repo stands
//   node scripts/query.mjs find "formatear moneda" [--root .] [--limit 8]
//   node scripts/query.mjs who formatearMoneda
//   node scripts/query.mjs ripples src/utils/money.ts
//   node scripts/query.mjs gaps [path]
//
// `status` is also what no command at all means: the bare invocation is the
// one with no question attached, and it has to answer something.

import {
  load, tryLoad, words, nameWords, overlap, capped, NOT_PROOF, stalenessLine, staleness, outDirFor,
} from './lib/graph.mjs'
import { languagesFor, ignoreEpipe, isMain } from './lib/scan.mjs'
import { sketchSimilarity } from './lib/parse.mjs'
import { findDocFiles, readDoc, splice } from './lib/docs.mjs'
import { existsSync, readFileSync } from 'node:fs'
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

// ------------------------------------------------------------------- status

const WORST_DIRS = 3

/** Undocumented symbols per directory, worst first. Where to send someone who
 *  asked for one directory to work through rather than a list of names. */
function undocumentedByDir(g) {
  const byDir = new Map()
  for (const s of g.index.symbols) {
    if (s.desc) continue
    const dir = s.file.includes('/') ? s.file.slice(0, s.file.lastIndexOf('/')) : '.'
    byDir.set(dir, (byDir.get(dir) || 0) + 1)
  }
  return [...byDir.entries()].sort((a, b) => b[1] - a[1])
}

/** How many doc files exist and how many have nowhere to put the block. */
function docState(root) {
  const paths = findDocFiles(root)
  let unmarked = 0
  for (const p of paths) {
    try {
      if (splice(readDoc(root, p).text, '') === null) unmarked++
    } catch {
      // Unreadable is not the status command's problem to report; the gate
      // does that with a path attached.
    }
  }
  return { total: paths.length, unmarked }
}

/**
 * How many verdicts a person has given, or null when there is no file.
 *
 * That is deliberately not "has twins run": the file only appears once a
 * verdict is recorded, so a clean run leaves nothing behind and looks
 * identical to never having run. Reporting the count is a fact; reporting
 * "never run" would be a guess, and a wrong one on any repo with no twins.
 */
function twinState(root) {
  const p = join(outDirFor(root), 'twins.json')
  if (!existsSync(p)) return null
  try {
    return Object.keys(JSON.parse(readFileSync(p, 'utf8')).verdicts || {}).length
  } catch {
    return null
  }
}

/**
 * Where this repo stands, and the one command that changes each thing that is
 * not where it should be.
 *
 * This is what `codegraph` with nothing after it answers. Without it the bare
 * invocation has no question attached and stops at setup having said nothing,
 * which reads exactly like a tool that does not work.
 *
 * It reports and never repairs — not even the index, and especially not the
 * index. A status that fixes what it finds is one nobody can run to find out
 * where they stand, and rebuilding stays the user's call everywhere else.
 */
export function status(root, byExt) {
  const g = tryLoad(root)
  const rows = []
  const next = []
  const line = (k, v) => rows.push(`  ${k.padEnd(11)} ${v}`)
  // Every suggested command has to work pasted somewhere else, and `--root` is
  // what the reader is least likely to add back.
  const at = root === '.' ? '' : ` --root ${root}`

  if (!g) {
    line('Index', 'none yet — every other command needs it first')
    next.push([`${here('extract.mjs')} ${root}`, 'build it'])
  } else {
    const s = g.index.stats
    line('Index', `${s.files} files · ${s.symbols} symbols · ${s.edges} edges`)
    line('', `${s.languages.join(', ') || 'no language recognised'}${s.tier0 ? ` · ${s.tier0} tier 0` : ''}`)
    const c = s.confidence
    line('', `${c.EXTRACTED} certain · ${c.INFERRED} inferred · ${c.AMBIGUOUS} ambiguous · ${c.MENTIONED} mentioned`)

    const drift = staleness(root, byExt)
    if (!drift) line('Drift', 'unknown — no build cache to compare against')
    else if (!drift.total) line('Drift', 'none: the index matches the tree')
    else {
      const bits = [drift.changed && `${drift.changed} changed`, drift.added && `${drift.added} new`,
        drift.removed && `${drift.removed} deleted`].filter(Boolean)
      line('Drift', `${bits.join(', ')} file(s) since the last build`)
      next.push([`${here('extract.mjs')} ${root}`, 'the tree moved past the index'])
    }

    const holes = undocumentedByDir(g)
    const missing = s.symbols - s.documented
    if (!missing) line('Comments', `all ${s.symbols} symbols carry one`)
    else {
      line('Comments', `${missing} of ${s.symbols} symbols have none`)
      line('', `worst: ${holes.slice(0, WORST_DIRS).map(([d, n]) => `${d} (${n})`).join(' · ')}`)
      // Named with a directory, because "2727 symbols" is a number nobody can
      // start on and one directory is an afternoon.
      next.push([`${here('query.mjs')} gaps ${holes[0][0]}${at}`, `${holes[0][1]} of them are in one directory`])
    }
  }

  const docs = docState(root)
  if (!docs.total) {
    line('Doc files', 'none — no CLAUDE.md or AGENTS.md in this tree')
    next.push(['read references/root-template.md, in the skill', 'the standing orders go in a root CLAUDE.md'])
  } else {
    line('Doc files', `${docs.total}${docs.unmarked ? ` · ${docs.unmarked} with no @codegraph markers` : ''}`)
  }

  const twins = twinState(root)
  line('Twins', twins === null ? 'no verdict recorded here' : `${twins} verdict(s) recorded`)
  if (twins === null && g) next.push([`${here('twins.mjs')}${at}`, 'nothing has been ruled a duplicate or not'])

  const out = [`codegraph · ${root}`, '', ...rows]
  if (next.length) {
    out.push('', '  Next', capped(next, 4, ([cmd, why]) => `    ${cmd}\n        ${why}`))
  }
  out.push('', `  ${NOT_PROOF}`)
  return out.join('\n')
}

// ---------------------------------------------------------------------- cli

function main() {
  ignoreEpipe()
  const { flags, positional } = parseArgs(process.argv.slice(2))
  const [cmd, subject] = positional
  const root = flags.root || '.'
  const limit = flags.limit || (cmd === 'gaps' ? '15' : '8')

  const byExt = languagesFor(root).byExt

  // Before `load`, which exits when there is no index. Having none is a state
  // status exists to report, so it must never be a state status dies on.
  if (!cmd || cmd === 'status') {
    process.stdout.write(`${status(root, byExt)}\n`)
    return
  }

  const g = load(root)
  // Before the answer, never after: a reader who has the result already has
  // stopped reading.
  process.stdout.write(stalenessLine(root, byExt))
  let out
  switch (cmd) {
    case 'find': out = find(g, subject || '', limit); break
    case 'who': out = who(g, subject || '', limit); break
    case 'ripples': out = ripples(g, subject || '', limit); break
    case 'gaps': out = gaps(g, subject || '', limit); break
    default:
      process.stderr.write('usage: query.mjs <status|find|who|ripples|gaps> [subject] [--root .] [--limit N]\n')
      process.exit(2)
  }
  process.stdout.write(`${out}\n`)
}

// Only run as a command: an unguarded main() turns `import` into a side effect.
if (isMain(import.meta.url)) main()
