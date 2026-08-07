#!/usr/bin/env node
// Generates the block inside each doc file's @map markers.
//
//   node scripts/write-maps.mjs [--root .]           show what would change
//   node scripts/write-maps.mjs --write              apply it
//
// The backlinks — who declares they ripple into here — are the half of the
// graph nobody writes by hand, and therefore the half no repo has. They are
// generated, so they cannot drift, and `check.mjs` proves it.
//
// Markers are hand-placed, once. If they are absent this reports and does
// nothing: a generator that guessed at placement would drop an index above the
// part of the file that actually matters.

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  findDocFiles, readDoc, classify, splice, pathExists, MARK_START, MARK_END,
} from './lib/docs.mjs'

const REMINDER = (docName) =>
  `**Before writing anything new**, check it does not exist: \`node scripts/query.mjs find "<what you are about to write>"\`. ` +
  `A thin result is a miss, not proof of absence. Full rules: this file's ancestors — every one of them loads, not just the nearest ${docName}.`

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

/** The generated block for every doc file, keyed by path. Rendered in memory
 *  by check.mjs too, which is how staleness is detected without writing. */
export function renderMaps(docs, root = '.') {
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
  const argv = process.argv.slice(2)
  const rootIdx = argv.indexOf('--root')
  const root = rootIdx >= 0 ? argv[rootIdx + 1] : '.'
  const apply = argv.includes('--write')

  const docs = classify(findDocFiles(root).map((p) => readDoc(root, p)))
  if (!docs.length) {
    process.stdout.write('No CLAUDE.md or AGENTS.md files found. Nothing to generate.\n')
    return
  }

  const blocks = renderMaps(docs, root)
  const noMarkers = []
  const changed = []

  for (const d of docs) {
    const next = splice(d.text, blocks.get(d.path))
    if (next === null) { noMarkers.push(d.path); continue }
    if (next === d.text) continue
    changed.push(d.path)
    if (apply) writeFileSync(join(root, d.path), next)
  }

  const out = []
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
if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
