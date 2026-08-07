#!/usr/bin/env node
// Generates the block inside each doc file's @map markers.
//
//   node scripts/write-maps.mjs [--root .]           show what would change
//   node scripts/write-maps.mjs --write              apply it
//   node scripts/write-maps.mjs --reviewed           record "I have read these
//                                                    files against their code"
//
// The backlinks — who declares they ripple into here — are the half of the
// graph nobody writes by hand, and therefore the half no repo has. They are
// generated, so they cannot drift, and `check.mjs` proves it.
//
// Markers are hand-placed, once. If they are absent this reports and does
// nothing: a generator that guessed at placement would drop an index above the
// part of the file that actually matters.

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  findDocFiles, readDoc, classify, splice, pathExists, MARK_START, MARK_END,
} from './lib/docs.mjs'
import { tryLoad, outDirFor } from './lib/graph.mjs'
import { hash, ignoreEpipe } from './lib/scan.mjs'

// The orientation list is generated, so it cannot drift, and it sits inside the
// block that `bodyLineCount` excludes, so it costs no budget. What it does cost
// is a reader's attention on every load of every file below — which is why it
// is ranked and capped, and never a listing.
const ORIENT_MAX = 6
const ORIENT_DESC = 110

// No command path here. The skill lives outside the repo being indexed, so a
// hardcoded `node scripts/query.mjs` is correct only while codegraph indexes
// itself and wrong in every project that installs it — and this block is the
// text every agent loads. The path is written once, by hand, in the root file;
// naming its home beats restating it in every descendant.
const REMINDER = (docName) =>
  '**Before writing anything new**, search the index for what you are about to write, ' +
  'in plain words rather than by the name you had in mind. A thin result is a miss, not ' +
  `proof of absence. Commands and full rules: the root ${docName} — every ancestor loads, ` +
  'not just the nearest.'

function norm(p) {
  return p.replace(/^\.\//, '').replace(/\/+$/, '')
}

/**
 * The doc file that owns a path: the deepest one whose directory contains it.
 * The root is never the catch-all — its scope contains everything, so letting
 * it absorb unresolved targets would fill it with backlinks that say nothing.
 */
function ownerOf(docs, target) {
  const t = norm(target)
  let best = null
  for (const d of docs) {
    if (d.dir === '.' && t !== '.') continue
    const scope = d.dir === '.' ? '' : `${d.dir}/`
    if (`${t}/`.startsWith(scope) || d.dir === t) {
      if (!best || d.dir.length > best.dir.length) best = d
    }
  }
  return best
}

/**
 * The doc file a source file belongs to: the deepest one whose directory
 * contains it. Unlike `ownerOf`, the root counts — a symbol sitting at the root
 * genuinely lives there, whereas an unresolved `ripples_to` target merely
 * passes through it.
 */
function docOwning(docs, file) {
  let best = null
  for (const d of docs) {
    const scope = d.dir === '.' ? '' : `${d.dir}/`
    if (!file.startsWith(scope)) continue
    if (!best || d.dir.length > best.dir.length) best = d
  }
  return best
}

/**
 * What a directory holds, in the two shapes that orient a reader without
 * anything having to understand the code: what the rest of the repo leans on,
 * and what it never reaches. Ranking by inbound edges alone would invert the
 * pyramid — an entry point has no callers by definition, so it sorts last.
 *
 * The second list is not called "entry points". Same-file edges are never
 * recorded, so a module-internal helper is indistinguishable from a door and
 * from dead code. All three are named instead of one of them being guessed.
 *
 * Descriptions are the ones harvested from the code, never written here. This
 * is the index rendered, so a wrong line is fixed in the comment it came from.
 */
function orientation(d, docs, g) {
  const mine = g.index.symbols.filter((s) => docOwning(docs, s.file)?.path === d.path)
  if (!mine.length) return []

  const prefix = d.dir === '.' ? '' : `${d.dir}/`
  const documentedFirst = (a, b) => (b.desc ? 1 : 0) - (a.desc ? 1 : 0)

  const row = (s, note) => {
    const where = s.file.startsWith(prefix) ? s.file.slice(prefix.length) : s.file
    const desc = s.desc
      ? s.desc.length > ORIENT_DESC ? `${s.desc.slice(0, ORIENT_DESC - 1).trimEnd()}…` : s.desc
      : '_no comment yet_'
    return `- \`${s.name}\` · \`${where}\` — ${desc}${note}`
  }

  const doors = mine
    .filter((s) => !g.usageCount(s))
    .sort((a, b) => documentedFirst(a, b) || b.tokenCount - a.tokenCount || (a.name < b.name ? -1 : 1))
  const load = mine
    .filter((s) => g.usageCount(s))
    .sort((a, b) => g.usageCount(b) - g.usageCount(a) || documentedFirst(a, b) || (a.name < b.name ? -1 : 1))

  const files = new Set(mine.map((s) => s.file)).size
  const lines = [
    `**What lives here** — ${mine.length} exported symbol${mine.length === 1 ? '' : 's'}` +
      ` across ${files} file${files === 1 ? '' : 's'}.`,
    '',
  ]

  if (load.length) {
    lines.push('*Most depended on — changing one of these reaches furthest:*', '')
    for (const s of load.slice(0, ORIENT_MAX)) {
      const n = g.usageCount(s)
      lines.push(row(s, ` (${n} use${n === 1 ? '' : 's'})`))
    }
    if (load.length > ORIENT_MAX) lines.push(`- …and ${load.length - ORIENT_MAX} more`)
    lines.push('')
  }

  if (doors.length) {
    lines.push(
      '*No other file references these — each is a way in, a helper used only' +
        ' inside its own file, or dead. The index cannot tell which:*',
      ''
    )
    for (const s of doors.slice(0, ORIENT_MAX)) lines.push(row(s, ''))
    if (doors.length > ORIENT_MAX) lines.push(`- …and ${doors.length - ORIENT_MAX} more`)
    lines.push('')
  }

  lines.push(
    'A ranked sample, not an inventory, and it says what each thing *is* —' +
      ' never how any of it works. Searching the index by purpose covers all of them.',
    ''
  )
  return lines
}

/**
 * A fingerprint of the code each doc file speaks for: every symbol it owns, by
 * name and body hash. Compared later, it answers one question and refuses the
 * neighbouring one — *the ground under this file moved*, never *this file is
 * now wrong*. The first is arithmetic; the second would need to understand both
 * the prose and the code, and a gate that claims that gets switched off.
 *
 * This is what lets a doc file explain something. An explanation is allowed to
 * be unverifiable as long as it is marked when the thing it explains changes.
 */
export function scopeFingerprints(docs, g) {
  const out = new Map()
  if (!g) return out
  for (const d of docs) {
    const mine = g.index.symbols
      .filter((s) => docOwning(docs, s.file)?.path === d.path)
      .map((s) => `${s.file}#${s.name}#${s.bodyHash}`)
      .sort()
    out.set(d.path, hash(mine.join('\n')))
  }
  return out
}

/** Where the baseline lives. Committed: a fresh clone must know when a doc was
 *  last reviewed, or the signal resets to "fine" for everyone but its author. */
export function freshnessPath(root) {
  return join(outDirFor(root), 'freshness.json')
}

/** The last recorded baseline per doc file, or an empty map. A missing file is
 *  "nobody has reviewed anything yet", never an error. */
export function readFreshness(root) {
  try {
    return JSON.parse(readFileSync(freshnessPath(root), 'utf8')).docs || {}
  } catch {
    return {}
  }
}

/**
 * The generated block for every doc file, keyed by path. Rendered in memory by
 * check.mjs too, which is how staleness is detected without writing — so both
 * callers must pass the same `g`, or the gate reports a staleness that no
 * --write can clear.
 */
export function renderMaps(docs, root = '.', g = null) {
  const blocks = new Map()

  // who → where they say they ripple to. A target that does not exist on disk
  // produces no backlink: check.mjs reports it, and inventing an edge from it
  // would put a false claim in a generated block, where it looks authoritative.
  const backlinks = new Map()
  for (const d of docs) {
    for (const target of d.data?.ripples_to || []) {
      if (!pathExists(root, norm(target))) continue
      const owner = ownerOf(docs, target)
      if (!owner || owner.path === d.path) continue
      if (!backlinks.has(owner.path)) backlinks.set(owner.path, [])
      backlinks.get(owner.path).push({ from: d, target: norm(target) })
    }
  }

  for (const d of docs) {
    const lines = [MARK_START, '']

    if (d.layer === 'surface') {
      const below = docs
        .filter((x) => x.parent === d.dir)
        .sort((a, b) => (a.dir < b.dir ? -1 : 1))
      if (below.length) {
        lines.push('**Read one of these before working below:**', '')
        for (const b of below) {
          const why = (b.data?.read_before || [])[0] || 'no read_before declared'
          lines.push(`- \`${b.dir}\` — ${why}`)
        }
        lines.push('')
      }
    }

    if (g) lines.push(...orientation(d, docs, g))

    const incoming = (backlinks.get(d.path) || []).sort((a, b) => (a.from.dir < b.from.dir ? -1 : 1))
    if (incoming.length) {
      lines.push('**Changes here ripple from:**', '')
      for (const i of incoming) {
        const why = (i.from.data?.read_before || [])[0] || 'declares ripples_to here'
        lines.push(`- \`${i.from.dir}\` — ${why}`)
      }
      lines.push('')
    }

    const out = (d.data?.ripples_to || []).map(norm)
    if (out.length) {
      lines.push(`**Changes here ripple into:** ${out.map((o) => `\`${o}\``).join(', ')}`, '')
    }

    lines.push(REMINDER(d.path.split('/').pop()), '', MARK_END)
    blocks.set(d.path, lines.join('\n'))
  }

  return blocks
}

function main() {
  ignoreEpipe()
  const argv = process.argv.slice(2)
  const rootIdx = argv.indexOf('--root')
  const root = rootIdx >= 0 ? argv[rootIdx + 1] : '.'
  const apply = argv.includes('--write')
  const reviewed = argv.includes('--reviewed')

  const docs = classify(findDocFiles(root).map((p) => readDoc(root, p)))
  if (!docs.length) {
    process.stdout.write('No CLAUDE.md or AGENTS.md files found. Nothing to generate.\n')
    return
  }

  const g = tryLoad(root)
  const blocks = renderMaps(docs, root, g)
  const noMarkers = []
  const changed = []

  for (const d of docs) {
    const next = splice(d.text, blocks.get(d.path))
    if (next === null) { noMarkers.push(d.path); continue }
    if (next === d.text) continue
    changed.push(d.path)
    if (apply) writeFileSync(join(root, d.path), next)
  }

  // Deliberately NOT --write. Regenerating a block is mechanical and runs on
  // every build; declaring a file reviewed is a person saying they read it
  // against the code. Coupled, the mechanical step clears the human signal on
  // every run and it never fires once.
  if (reviewed && g) {
    const prints = scopeFingerprints(docs, g)
    mkdirSync(outDirFor(root), { recursive: true })
    writeFileSync(
      freshnessPath(root),
      `${JSON.stringify({ version: 1, docs: Object.fromEntries(prints) }, null, 2)}\n`
    )
  }

  const out = []
  if (reviewed) out.push(`Baseline recorded for ${docs.length} file(s): reviewed against their code.`, '')
  if (changed.length) {
    out.push(apply ? `Rewrote ${changed.length} generated block(s):` : `${changed.length} generated block(s) are stale:`)
    for (const c of changed) out.push(`  ${c}`)
    if (!apply) out.push('', 'Run with --write to bring them up to date.')
  } else {
    out.push('All generated blocks are up to date.')
  }
  if (noMarkers.length) {
    out.push('', 'No @map markers — place them by hand, once, where the block belongs:')
    for (const n of noMarkers) out.push(`  ${n}`)
    out.push('', MARK_START, MARK_END)
  }
  process.stdout.write(`${out.join('\n')}\n`)
}

// check.mjs imports renderMaps from here; only run as a command.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
