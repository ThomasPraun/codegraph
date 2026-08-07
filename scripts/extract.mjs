#!/usr/bin/env node
// Builds docs-graph/index.json: every exported symbol, its harvested comment,
// and who names whom.
//
//   node scripts/extract.mjs [root] [--out DIR] [--full]
//
// Pass 1 finds declarations and the comment above them. Pass 2 finds, for each
// file, which known symbol names appear in it — and then uses the file's own
// imports to decide whether that occurrence is certain, guessed, or a name
// collision. Without the import check, substring matching produces garbage:
// `get`, `format` and `index` appear everywhere.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { walk, readFile, extOf, LANG_BY_EXT } from './lib/scan.mjs'
import { parseFile } from './lib/parse.mjs'

const TS_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.astro']

// A name this short carries no information: it collides with everything and
// resolving it would cost more confidence than it buys.
const MIN_NAME_LENGTH = 3

// A name declared in more places than this is ambient, not a symbol worth
// tracking edges for.
const MAX_COLLISION = 3

function normalize(p) {
  const out = []
  for (const part of p.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

/** The file an import specifier points at, or null when it leaves the repo. */
function resolveSpec(fromFile, spec, lang, fileSet) {
  const dir = fromFile.split('/').slice(0, -1).join('/')
  let bases = []

  if (spec.startsWith('.')) {
    bases = [normalize(`${dir}/${spec}`)]
  } else if (lang === 'dart' && spec.startsWith('package:')) {
    bases = [`lib/${spec.slice(8).split('/').slice(1).join('/')}`]
  } else if (/^[@~]\//.test(spec)) {
    const rest = spec.slice(2)
    bases = [rest, `src/${rest}`, `lib/${rest}`]
  } else if (/^(src|lib|app)\//.test(spec)) {
    bases = [spec]
  } else {
    return null // a bare package name: not ours to index
  }

  const exts = lang === 'dart' ? ['.dart'] : TS_EXTS
  for (const base of bases) {
    if (fileSet.has(base)) return base
    for (const e of exts) if (fileSet.has(base + e)) return base + e
    for (const e of exts) if (fileSet.has(`${base}/index${e}`)) return `${base}/index${e}`
  }
  return null
}

function loadCache(outDir) {
  const p = join(outDir, '.cache.json')
  if (!existsSync(p)) return {}
  try {
    return JSON.parse(readFileSync(p, 'utf8')).files || {}
  } catch {
    return {} // a corrupt cache is a slow run, never a failed one
  }
}

/** Builds and writes the whole index. Affects: every command, and the gate's
 *  ability to check citations at all. */
export function extract(root, outDir, { full = false } = {}) {
  const files = walk(root)
  const fileSet = new Set(files.map((f) => f.path))
  const cache = full ? {} : loadCache(outDir)
  const parsed = {}
  let reused = 0

  // -- pass 1 -------------------------------------------------------------
  for (const f of files) {
    const hit = cache[f.path]
    if (hit && hit.size === f.size && hit.mtime === f.mtime) {
      parsed[f.path] = hit
      reused++
      continue
    }
    const text = readFile(root, f.path)
    if (text === null) continue
    const lang = LANG_BY_EXT[extOf(f.path)]
    parsed[f.path] = { size: f.size, mtime: f.mtime, lang, ...parseFile(f.path, lang, text) }
  }

  const symbols = []
  const byName = new Map()
  for (const [path, p] of Object.entries(parsed)) {
    for (const s of p.symbols) {
      const entry = { ...s, file: path }
      symbols.push(entry)
      if (!byName.has(s.name)) byName.set(s.name, [])
      byName.get(s.name).push(entry)
    }
  }

  // -- pass 2 -------------------------------------------------------------
  const edges = []
  for (const [path, p] of Object.entries(parsed)) {
    const declaredHere = new Set(p.symbols.map((s) => s.name))
    const importedNames = new Set(p.importNames)
    const importedFiles = new Set()
    for (const spec of p.importSpecs) {
      const hit = resolveSpec(path, spec, p.lang, fileSet)
      if (hit) importedFiles.add(hit)
    }

    for (const ident of p.idents) {
      if (ident.length < MIN_NAME_LENGTH || declaredHere.has(ident)) continue
      const candidates = byName.get(ident)
      if (!candidates || candidates.length > MAX_COLLISION) continue

      const viaFile = candidates.filter((c) => importedFiles.has(c.file))
      if (viaFile.length) {
        for (const c of viaFile) edges.push({ from: path, to: ident, at: c.file, conf: 'EXTRACTED' })
        continue
      }
      if (importedNames.has(ident) && candidates.length === 1) {
        edges.push({ from: path, to: ident, at: candidates[0].file, conf: 'EXTRACTED' })
        continue
      }
      const conf = candidates.length === 1 ? 'INFERRED' : 'AMBIGUOUS'
      for (const c of candidates) {
        if (c.file === path) continue
        edges.push({ from: path, to: ident, at: c.file, conf })
      }
    }
  }

  const counts = { EXTRACTED: 0, INFERRED: 0, AMBIGUOUS: 0 }
  for (const e of edges) counts[e.conf]++

  const index = {
    version: 1,
    root: '.',
    stats: {
      files: files.length,
      symbols: symbols.length,
      documented: symbols.filter((s) => s.desc).length,
      edges: edges.length,
      confidence: counts,
    },
    symbols: symbols.sort((a, b) => (a.file + a.name < b.file + b.name ? -1 : 1)),
    edges: edges.sort((a, b) => (a.from + a.to + a.at < b.from + b.to + b.at ? -1 : 1)),
  }

  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`)
  writeFileSync(join(outDir, '.cache.json'), `${JSON.stringify({ files: parsed })}\n`)

  return { index, reused }
}

function main() {
  const args = process.argv.slice(2)
  const flags = new Set(args.filter((a) => a.startsWith('--')))
  const positional = args.filter((a) => !a.startsWith('--'))
  const outIdx = args.indexOf('--out')
  const root = positional[0] || '.'
  const outDir = outIdx >= 0 ? args[outIdx + 1] : join(root, 'docs-graph')

  const { index, reused } = extract(root, outDir, { full: flags.has('--full') })
  const s = index.stats
  const gaps = s.symbols - s.documented

  process.stdout.write(
    `${s.files} files · ${s.symbols} symbols · ${s.edges} edges` +
      ` (${s.confidence.EXTRACTED} certain, ${s.confidence.INFERRED} inferred,` +
      ` ${s.confidence.AMBIGUOUS} ambiguous)\n` +
      `${s.documented} documented · ${gaps} without a comment` +
      `${gaps ? '  → codegraph gaps' : ''}\n` +
      `${reused} files reused from cache\n` +
      `written to ${join(outDir, 'index.json')}\n`
  )
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
