#!/usr/bin/env node
// Builds codegraph/index.json: every exported symbol, its harvested comment,
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
import { walk, readFile, languagesFor, isProbablyText, OUT_DIR, ignoreEpipe } from './lib/scan.mjs'
import { parseFile } from './lib/parse.mjs'

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

/**
 * The file an import specifier points at, or null when it leaves the repo.
 * Every rule comes from the language's `resolve` block; nothing here knows
 * which language it is looking at. A specifier this cannot place is not an
 * error — it costs the edge its EXTRACTED label and nothing else.
 */
function resolveSpec(fromFile, spec, langSpec, fileSet) {
  const r = (langSpec && langSpec.resolve) || {}
  const dir = fromFile.split('/').slice(0, -1).join('/')
  const alias = r.aliasRoots || []
  let bases = []

  if (r.packagePrefix && spec.startsWith(r.packagePrefix)) {
    const rest = spec.slice(r.packagePrefix.length).split('/')
    rest.splice(0, r.packageDropSegments || 0)
    bases = [[r.packageRoot, ...rest].filter(Boolean).join('/')]
  } else if (/^[@~]\//.test(spec)) {
    const rest = spec.slice(2)
    bases = [rest, ...alias.map((a) => `${a}/${rest}`)]
  } else if (r.specSep && !/[/'"]/.test(spec)) {
    let p = spec
    for (const pre of r.stripSpecPrefixes || []) {
      if (p.startsWith(pre + r.specSep)) p = p.slice(pre.length + r.specSep.length)
    }
    const path = p.split(r.specSep).filter(Boolean).join('/')
    if (!path) return null
    bases = [path, ...alias.map((a) => `${a}/${path}`)]
    if (dir) bases.push(normalize(`${dir}/${path}`))
  } else if (spec.startsWith('.')) {
    bases = [normalize(`${dir}/${spec}`)]
  } else if (r.lastSegments) {
    // A module path whose prefix is a host name, not a directory. Try every
    // suffix: the repo-relative part is one of them, or the import is external.
    const parts = spec.split('/')
    for (let i = 0; i < parts.length; i++) bases.push(parts.slice(i).join('/'))
  } else if (alias.length && new RegExp(`^(?:${alias.join('|')})/`).test(spec)) {
    bases = [spec]
  } else {
    return null // a bare package name: not ours to index
  }

  const exts = langSpec?.exts || []
  const indexName = r.indexName || 'index'
  for (const base of bases) {
    if (fileSet.has(base)) return base
    for (const e of exts) if (fileSet.has(base + e)) return base + e
    if (r.index) {
      for (const e of exts) if (fileSet.has(`${base}/${indexName}${e}`)) return `${base}/${indexName}${e}`
    }
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
  const { langs, byExt, problems } = languagesFor(root)
  const files = walk(root, byExt)
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
    // Tier 0 walks extensions nobody registered, so an unlabelled binary can
    // reach here. Its bytes would become identifiers.
    if (!f.lang && !isProbablyText(text)) continue
    const spec = f.lang ? langs[f.lang] : null
    parsed[f.path] = { size: f.size, mtime: f.mtime, lang: f.lang, ...parseFile(f.path, spec, text) }
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
    const langSpec = p.lang ? langs[p.lang] : null
    for (const spec of p.importSpecs) {
      const hit = resolveSpec(path, spec, langSpec, fileSet)
      if (hit) importedFiles.add(hit)
    }

    for (const ident of p.idents) {
      if (ident.length < MIN_NAME_LENGTH || declaredHere.has(ident)) continue
      const candidates = byName.get(ident)
      if (!candidates || candidates.length > MAX_COLLISION) continue

      // A tier-0 file had no comment syntax to blank, so the name may well be
      // sitting in prose. That is a weaker claim than INFERRED, and it gets a
      // weaker label rather than being quietly folded in with it.
      if (!p.lang) {
        for (const c of candidates) {
          if (c.file === path) continue
          edges.push({ from: path, to: ident, at: c.file, conf: 'MENTIONED' })
        }
        continue
      }

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

  const counts = { EXTRACTED: 0, INFERRED: 0, AMBIGUOUS: 0, MENTIONED: 0 }
  for (const e of edges) counts[e.conf]++

  const index = {
    version: 1,
    root: '.',
    // Counted from what was parsed, never from what was walked: a binary that
    // tier 0 reached and dropped is not a file this index knows anything about.
    stats: {
      files: Object.keys(parsed).length,
      tier0: Object.values(parsed).filter((p) => !p.lang).length,
      languages: [...new Set(Object.values(parsed).map((p) => p.lang).filter(Boolean))].sort(),
      symbols: symbols.length,
      documented: symbols.filter((s) => s.desc).length,
      edges: edges.length,
      confidence: counts,
    },
    symbols: symbols.sort((a, b) => (a.file + a.name < b.file + b.name ? -1 : 1)),
    edges: edges.sort((a, b) => (a.from + a.to + a.at < b.from + b.to + b.at ? -1 : 1)),
    // Every identifier in the repo, so the gate can check a citation from a
    // clean clone. It lived only in .cache.json, which is not committed, so CI
    // checked nothing and said Green. The index is read by scripts and never by
    // an agent, which is what lets it carry this.
    idents: [...new Set(Object.values(parsed).flatMap((p) => p.idents || []))].sort(),
  }

  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`)
  writeFileSync(join(outDir, '.cache.json'), `${JSON.stringify({ files: parsed })}\n`)

  return { index, reused, problems }
}

function main() {
  ignoreEpipe()
  const args = process.argv.slice(2)
  const flags = new Set(args.filter((a) => a.startsWith('--')))
  const positional = args.filter((a) => !a.startsWith('--'))
  const outIdx = args.indexOf('--out')
  const root = positional[0] || '.'
  const outDir = outIdx >= 0 ? args[outIdx + 1] : join(root, OUT_DIR)

  const { index, reused, problems } = extract(root, outDir, { full: flags.has('--full') })

  // Every reader resolves the index as <root>/codegraph. Writing it anywhere
  // else does not move them; it leaves them reading whatever was there before,
  // with no sign that they are answering from a different index than this run.
  if (outDir !== join(root, OUT_DIR)) {
    process.stdout.write(
      `! Written outside ${join(root, OUT_DIR)}, where query/twins/check look.\n` +
      '  They will not read this index. Use --out only to inspect, never to work from.\n'
    )
  }
  const s = index.stats
  const gaps = s.symbols - s.documented

  // Printed before the summary, never swallowed: a dropped language looks
  // exactly like a language with no symbols in it.
  for (const p of problems) process.stdout.write(`! ${p}\n`)

  process.stdout.write(
    `${s.files} files (${s.languages.join(', ') || 'none recognised'}` +
      `${s.tier0 ? ` · ${s.tier0} tier 0` : ''}) · ${s.symbols} symbols · ${s.edges} edges\n` +
      `  ${s.confidence.EXTRACTED} certain, ${s.confidence.INFERRED} inferred,` +
      ` ${s.confidence.AMBIGUOUS} ambiguous, ${s.confidence.MENTIONED} mentioned\n` +
      `${s.documented} documented · ${gaps} without a comment` +
      `${gaps ? '  → codegraph gaps' : ''}\n` +
      `${reused} files reused from cache\n` +
      `written to ${join(outDir, 'index.json')}\n`
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
