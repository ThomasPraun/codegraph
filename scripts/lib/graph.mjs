// Loading and querying the index. The index is read by these scripts, never by
// an agent — that is the whole reason it may grow without limit.

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const STOPWORDS = new Set([
  'a', 'al', 'de', 'del', 'la', 'las', 'el', 'los', 'un', 'una', 'unos', 'unas',
  'en', 'con', 'por', 'para', 'que', 'y', 'o', 'su', 'sus', 'lo', 'se', 'es',
  'the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'is', 'it',
  'this', 'that', 'with', 'from', 'by', 'as', 'be',
])

/** Lowercase, unaccented, punctuation-free. Comparing "número" to "numero"
 *  has to work: the code is English, the comments frequently are not. */
export function normalize(text) {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

/** Significant words only — stopwords and two-letter noise removed, so that
 *  overlap scores reflect meaning rather than grammar. */
export function words(text) {
  return normalize(text)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
}

/** camelCase / PascalCase / snake_case all split the same way. */
export function nameWords(name) {
  return words(name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' '))
}

/** Shared words over the larger set. Normalising by the larger side keeps a
 *  three-word description from scoring high against every long one. */
export function overlap(a, b) {
  if (!a.length || !b.length) return 0
  const setB = new Set(b)
  let hits = 0
  for (const w of new Set(a)) if (setB.has(w)) hits++
  return hits / Math.max(new Set(a).size, setB.size)
}

/** Where every artefact lives. Changing this orphans existing indexes. */
export function outDirFor(root) {
  return join(root, 'docs-graph')
}

/**
 * The index plus the lookups every command needs. Exits rather than throwing
 * when there is no index: the fix is always the same one command, and a stack
 * trace would bury it.
 */
export function load(root) {
  const p = join(outDirFor(root), 'index.json')
  if (!existsSync(p)) {
    process.stderr.write(
      `No index at ${p}\nBuild it first:  node scripts/extract.mjs ${root}\n`
    )
    process.exit(2)
  }
  const index = JSON.parse(readFileSync(p, 'utf8'))

  const usedBy = new Map() // symbol name -> [{from, conf, at}]
  const uses = new Map() // file -> [{to, at, conf}]
  for (const e of index.edges) {
    if (!usedBy.has(e.to)) usedBy.set(e.to, [])
    usedBy.get(e.to).push(e)
    if (!uses.has(e.from)) uses.set(e.from, [])
    uses.get(e.from).push(e)
  }

  const byName = new Map()
  for (const s of index.symbols) {
    if (!byName.has(s.name)) byName.set(s.name, [])
    byName.get(s.name).push(s)
  }

  const usageCount = (s) =>
    (usedBy.get(s.name) || []).filter((e) => e.at === s.file && e.from !== s.file).length

  return { index, usedBy, uses, byName, usageCount }
}

/** Every command truncates. A command that can dump is a command that will. */
export function capped(rows, limit, render) {
  const shown = rows.slice(0, limit)
  const out = shown.map(render)
  if (rows.length > limit) {
    out.push(`  …and ${rows.length - limit} more — narrow the query or pass --limit`)
  }
  return out.join('\n')
}

/** Printed by every command that can come back empty. Removing it turns an
 *  honest miss into permission to write the duplicate. */
export const NOT_PROOF =
  'A thin result is a miss, not proof of absence: this tool matches text, it does not understand code.'
