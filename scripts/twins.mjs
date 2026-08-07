#!/usr/bin/env node
// Duplicate detection: pairs that do the same thing under different names.
//
//   node scripts/twins.mjs [--root .] [--limit 10]      list candidates with no verdict
//   node scripts/twins.mjs --record verdicts.json       persist an agent's verdicts
//   node scripts/twins.mjs --all                        include settled pairs
//
// The script proposes; it never decides. Merging two functions is a design
// decision, and a tool that takes it unasked is a tool nobody runs twice.
//
// Verdicts are stored against both body hashes, so a pair ruled "different" is
// never asked about again — until one of the bodies changes, at which point the
// verdict reopens by itself. Without that, the detector either re-asks forever
// (noise, and it gets switched off) or seals a verdict that ages into a lie.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { load, words, overlap, capped, outDirFor, stalenessLine } from './lib/graph.mjs'
import { languagesFor, ignoreEpipe } from './lib/scan.mjs'
import { sketchSimilarity } from './lib/parse.mjs'
import { pathToFileURL } from 'node:url'

// Thresholds start high on purpose. Five real pairs beat forty candidates: a
// noisy detector is a disabled detector.
// The path this run was invoked with, so printed commands are copy-pasteable
// from wherever the skill is installed. `scripts/...` is only right while
// codegraph is the repo being indexed.
const here = (name) => `node ${join(dirname(process.argv[1] || '.'), name)}`

const SHAPE_MIN = 0.55
const DESC_MIN = 0.5
const MIN_TOKENS = 12
const AMBIENT_BUCKET = 200 // a shingle shared by this many symbols says nothing

function key(a, b) {
  const one = `${a.file}#${a.name}`
  const two = `${b.file}#${b.name}`
  return one < two ? `${one}|${two}` : `${two}|${one}`
}

function loadVerdicts(outDir) {
  const p = join(outDir, 'twins.json')
  if (!existsSync(p)) return { version: 1, verdicts: {} }
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return { version: 1, verdicts: {} }
  }
}

function saveVerdicts(outDir, store) {
  writeFileSync(join(outDir, 'twins.json'), `${JSON.stringify(store, null, 2)}\n`)
}

/**
 * Inverted index so pairing stays linear-ish instead of comparing everything to
 * everything: only symbols that share a feature are ever compared.
 *
 * Reports what it skipped, and that reporting is not decoration. A feature
 * shared by more than `AMBIENT_BUCKET` symbols is boilerplate rather than a
 * duplicate — but the failure mode inverts: the more copy-paste a repo has, the
 * more buckets go ambient, and a repo drowning in duplication is the one this
 * would go quietest about. Silent, that reads as "no duplicates".
 */
function pairsSharing(symbols, featuresOf) {
  const buckets = new Map()
  symbols.forEach((s, i) => {
    for (const f of featuresOf(s)) {
      if (!buckets.has(f)) buckets.set(f, [])
      buckets.get(f).push(i)
    }
  })
  const seen = new Set()
  const out = []
  const skipped = new Set()
  for (const idxs of buckets.values()) {
    if (idxs.length > AMBIENT_BUCKET) {
      for (const i of idxs) skipped.add(i)
      continue
    }
    for (let a = 0; a < idxs.length; a++) {
      for (let b = a + 1; b < idxs.length; b++) {
        const k = `${idxs[a]}:${idxs[b]}`
        if (seen.has(k)) continue
        seen.add(k)
        out.push([idxs[a], idxs[b]])
      }
    }
  }
  // Only symbols that landed in no comparable bucket at all are truly unseen.
  for (const [i, j] of out) { skipped.delete(i); skipped.delete(j) }
  out.skipped = new Set([...skipped].map((i) => symbols[i]))
  return out
}

/** Candidate pairs, best first. Candidates — not findings: nothing here is a
 *  duplicate until something that understands the code has said so. */
export function candidates(index) {
  const symbols = index.symbols
  const found = new Map()

  const add = (i, j, route, score) => {
    const a = symbols[i]
    const b = symbols[j]
    if (a.file === b.file) return // same file, same author, same minute: not the problem
    const k = key(a, b)
    const prev = found.get(k)
    if (prev) {
      prev.routes.add(route)
      prev.score = Math.max(prev.score, score)
      return
    }
    found.set(k, { a, b, routes: new Set([route]), score })
  }

  const globalIdx = new Map(symbols.map((s, i) => [s, i]))

  // Route 1 — shape. Strip names and literals, compare what is left.
  const shaped = symbols.filter((s) => s.tokenCount >= MIN_TOKENS && s.sketch?.length)
  const shapePairs = pairsSharing(shaped, (s) => s.sketch)
  for (const [i, j] of shapePairs) {
    const score = sketchSimilarity(shaped[i].sketch, shaped[j].sketch)
    if (score >= SHAPE_MIN) add(globalIdx.get(shaped[i]), globalIdx.get(shaped[j]), 'shape', score)
  }

  // Route 2 — description. Finds the twin whose code looks nothing alike.
  const described = symbols.filter((s) => words(s.desc).length >= 3)
  const descPairs = pairsSharing(described, (s) => words(s.desc))
  for (const [i, j] of descPairs) {
    const score = overlap(words(described[i].desc), words(described[j].desc))
    if (score >= DESC_MIN) {
      add(globalIdx.get(described[i]), globalIdx.get(described[j]), 'description', score)
    }
  }

  const pairs = [...found.values()].sort((x, y) => y.score - x.score)
  // A union, never a sum: a symbol ambient on both routes is one symbol.
  pairs.skippedAsAmbient = new Set([...shapePairs.skipped, ...descPairs.skipped]).size
  return pairs
}

function isSettled(store, pair) {
  const v = store.verdicts[key(pair.a, pair.b)]
  if (!v) return false
  // Reopens the moment either body changes.
  return v.hashes.includes(pair.a.bodyHash) && v.hashes.includes(pair.b.bodyHash)
}

function render(pair) {
  const { a, b } = pair
  return [
    `  ${a.name}  ·  ${a.file}`,
    `  ${b.name}  ·  ${b.file}`,
    `      matched on ${[...pair.routes].join(' + ')} (${pair.score.toFixed(2)})`,
    a.desc ? `      a: ${a.desc}` : '      a: (no comment)',
    b.desc ? `      b: ${b.desc}` : '      b: (no comment)',
    a.shape || b.shape ? `      shape: ${a.shape || '-'}  vs  ${b.shape || '-'}` : '',
  ].filter(Boolean).join('\n')
}

function record(root, file) {
  const outDir = outDirFor(root)
  const store = loadVerdicts(outDir)
  const incoming = JSON.parse(readFileSync(file, 'utf8'))
  const rows = Array.isArray(incoming) ? incoming : incoming.verdicts || []

  let written = 0
  for (const r of rows) {
    if (!r.a || !r.b || !r.verdict) continue
    store.verdicts[key(r.a, r.b)] = {
      verdict: r.verdict,
      reason: (r.reason || '').slice(0, 200),
      hashes: [r.a.bodyHash, r.b.bodyHash],
      pair: [`${r.a.file}#${r.a.name}`, `${r.b.file}#${r.b.name}`],
    }
    written++
  }
  saveVerdicts(outDir, store)
  return `${written} verdict${written === 1 ? '' : 's'} recorded in ${join(outDir, 'twins.json')}`
}

function main() {
  ignoreEpipe()
  const argv = process.argv.slice(2)
  const val = (f) => {
    const i = argv.indexOf(f)
    return i >= 0 ? argv[i + 1] : null
  }
  const root = val('--root') || '.'

  const recordFile = val('--record')
  if (recordFile) {
    process.stdout.write(`${record(root, recordFile)}\n`)
    return
  }

  const { index } = load(root)
  process.stdout.write(stalenessLine(root, languagesFor(root).byExt))
  const store = loadVerdicts(outDirFor(root))
  const all = candidates(index)
  const showAll = argv.includes('--all')
  const open = showAll ? all : all.filter((p) => !isSettled(store, p))
  const settled = all.length - open.length
  const limit = Number(val('--limit') || 10)

  // Never printed as a footnote to a clean result: on a repo where one shape
  // repeats past AMBIENT_BUCKET, this is the whole answer, and "no candidates"
  // without it is the tool going quiet exactly where it should be loudest.
  const ambient = all.skippedAsAmbient
    ? `${all.skippedAsAmbient} symbol(s) were never compared: their shape or wording is shared by more\n` +
      `than ${AMBIENT_BUCKET} others, which reads as boilerplate rather than as duplication. If this\n` +
      `repo is heavily copy-pasted, that is the reason for a thin result, not an absence of\n` +
      `twins. Index one subtree on its own to bring the buckets back under the threshold:\n` +
      `  ${here('extract.mjs')} <subdir> && ${here('twins.mjs')} --root <subdir>\n`
    : ''

  if (!open.length) {
    process.stdout.write(
      `No open twin candidates${settled ? ` (${settled} already judged)` : ''}.\n${ambient}`
    )
    return
  }
  if (ambient) process.stdout.write(`${ambient}\n`)

  process.stdout.write(
    [
      `${open.length} candidate pair${open.length === 1 ? '' : 's'} with no verdict` +
        `${settled ? ` (${settled} already judged and unchanged)` : ''}:`,
      '',
      capped(open, limit, render),
      '',
      'These are candidates, not findings. Judge each pair, then persist the answer:',
      `  ${here('twins.mjs')} --record verdicts.json`,
      'so that a pair ruled "different" is never raised again unless a body changes.',
      '',
      'verdicts.json: [{ "a": {"name","file","bodyHash"}, "b": {…},',
      '                 "verdict": "twins" | "different", "reason": "one line" }]',
      '',
    ].join('\n')
  )
}

// Only run as a command. An unguarded main() turns `import` into a side
// effect, and argv[1] is undefined under `node -e` and the REPL.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
