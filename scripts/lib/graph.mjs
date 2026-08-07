// Loading and querying the index. The index is read by these scripts, never by
// an agent — that is the whole reason it may grow without limit.

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { walk, OUT_DIR } from './scan.mjs'

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

/** The command the caller actually invoked, so printed advice is copy-pasteable
 *  from wherever the skill is installed rather than only from inside it. */
const here = (name) => `node ${join(dirname(process.argv[1] || '.'), name)}`

/** Where every artefact lives. Changing this orphans existing indexes. */
export function outDirFor(root) {
  return join(root, OUT_DIR)
}

/**
 * How far the working tree has drifted from the index, or null when there is no
 * cache to compare against.
 *
 * Nothing here rebuilds anything. The index is rebuilt when a person says so,
 * and the only job of this is to make sure they are told — a stale index
 * answers `find` with yesterday's repo and looks exactly like a fresh one.
 */
export function staleness(root, byExt) {
  const p = join(outDirFor(root), '.cache.json')
  if (!existsSync(p)) return null
  let cached
  try {
    cached = JSON.parse(readFileSync(p, 'utf8')).files || {}
  } catch {
    return null
  }

  const seen = new Set()
  let changed = 0
  let added = 0
  for (const f of walk(root, byExt)) {
    seen.add(f.path)
    const hit = cached[f.path]
    if (!hit) added++
    else if (hit.size !== f.size || hit.mtime !== f.mtime) changed++
  }
  const removed = Object.keys(cached).filter((k) => !seen.has(k)).length
  return { changed, added, removed, total: changed + added + removed }
}

/** One line for a person, or '' when the index still matches the tree. Every
 *  command that reads the index prints it; a silent stale index is the failure
 *  this whole file exists to prevent. */
export function stalenessLine(root, byExt) {
  const s = staleness(root, byExt)
  if (!s || !s.total) return ''
  const bits = [
    s.changed && `${s.changed} changed`,
    s.added && `${s.added} new`,
    s.removed && `${s.removed} deleted`,
  ].filter(Boolean)
  return `! Index is behind the tree: ${bits.join(', ')} file(s). ` +
    `Answers below are from the last build.\n  Rebuild when you want to: ${here('extract.mjs')} <root>\n`
}

/**
 * The index plus the lookups every command needs, or null when there is none.
 * For a caller that can carry on without it — the generator renders a smaller
 * block rather than refusing to run.
 */
export function tryLoad(root) {
  const p = join(outDirFor(root), 'index.json')
  if (!existsSync(p)) return null
  let index
  try {
    index = JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }

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

  // MENTIONED is excluded on purpose. It comes from a file whose language is
  // unknown, so its comments could not be blanked and the name may be sitting
  // in prose. Those still answer `who` and `ripples`, where a human reads the
  // label — but they must never reorder gaps, which is ranked by this number
  // and is the one ordering that has to be trustworthy.
  const usageCount = (s) =>
    (usedBy.get(s.name) || [])
      .filter((e) => e.at === s.file && e.from !== s.file && e.conf !== 'MENTIONED').length

  return { index, usedBy, uses, byName, usageCount }
}

/**
 * The index, or an exit. Every query command needs one and the fix is always
 * the same single command, which a stack trace would bury.
 */
export function load(root) {
  const g = tryLoad(root)
  if (!g) {
    process.stderr.write(
      `No index at ${join(outDirFor(root), 'index.json')}\n` +
        `Build it first:  ${here('extract.mjs')} ${root}\n`
    )
    process.exit(2)
  }
  return g
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
