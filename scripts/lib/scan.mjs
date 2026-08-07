// Tree walking, file reading and the language table. Node builtins only — no
// dependency may be added to this skill; it has to run in a repo that has
// installed nothing.

import { readdirSync, statSync, readFileSync, existsSync, realpathSync } from 'node:fs'
import { join, relative, sep, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Directories that are never source. Kept as a list rather than read from
// .gitignore alone, because a repo that ignores nothing still should not be
// walked into node_modules.
const ALWAYS_SKIP = new Set([
  'node_modules', '.git', '.svn', '.hg',
  'dist', 'build', 'out', 'coverage', 'tmp',
  '.next', '.nuxt', '.astro', '.svelte-kit', '.turbo', '.cache',
  '.dart_tool', 'Pods', '.gradle', '.idea', '.vscode',
  '.venv', 'venv', '__pycache__', 'vendor', 'target',
  'codegraph', 'docs-graph', 'graphify-out',
])

/** The one directory this skill writes into a project, and the only trace it
 *  leaves. Named after the skill so it is obvious what created it and safe to
 *  delete. Changing this orphans every existing index. */
export const OUT_DIR = 'codegraph'

const MAX_FILE_BYTES = 1_000_000

// A tier-0 file contributes identifiers with no comment syntax to strip them
// by, so junk costs more there than a missed edge. The cap is tighter than for
// a known language on purpose.
const MAX_TIER0_BYTES = 200_000

/**
 * Extensions never indexed, at any tier. Prose and data are the reason: a
 * README that says "run this first" would make every file naming `run` look
 * like a caller, and that count reorders the gaps list.
 */
export const NEVER_INDEXED = new Set([
  '.md', '.mdx', '.markdown', '.txt', '.rst', '.adoc',
  '.json', '.jsonc', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.env',
  '.csv', '.tsv', '.xml', '.plist', '.lock', '.sum',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp',
  '.pdf', '.zip', '.gz', '.tar', '.jar', '.war', '.class', '.o', '.a',
  '.so', '.dylib', '.dll', '.exe', '.wasm', '.bin', '.pyc',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.mp4', '.mov', '.wav', '.webm',
  '.snap', '.map', '.min.js', '.log',
])

const HERE = dirname(fileURLToPath(import.meta.url))

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/** The built-in language table, as shipped. */
export const BUILTIN_LANGS = readJson(join(HERE, 'languages.json')) || {}

function byExtOf(langs) {
  const map = {}
  for (const [id, spec] of Object.entries(langs)) {
    for (const ext of spec.exts || []) map[ext] = id
  }
  return map
}

/** Which extensions are indexed as a known language, in the shipped table. */
export const LANG_BY_EXT = byExtOf(BUILTIN_LANGS)

/**
 * Languages whose patterns actually compile, and a line about each that does
 * not. A hand-written table is the one input here that a stranger edits, so a
 * bad regex in one entry must cost that entry and nothing else — never the run.
 */
function usable(langs) {
  const ok = {}
  const problems = []
  for (const [id, spec] of Object.entries(langs)) {
    if (!spec || typeof spec !== 'object' || !Array.isArray(spec.exts)) {
      problems.push(`language "${id}" ignored: no exts array`)
      continue
    }
    try {
      for (const d of spec.decls || []) new RegExp(d.re, 'gm')
      for (const i of spec.imports || []) new RegExp(i.re, 'gm')
      ok[id] = spec
    } catch (e) {
      problems.push(`language "${id}" ignored: ${e.message}`)
    }
  }
  return { ok, problems }
}

/**
 * The language table for one repo: the shipped one, with any entry in
 * `<root>/codegraph/languages.json` replacing or adding to it. That is the same
 * directory the index is written to, on purpose — one folder is the whole
 * footprint, and a second dot-prefixed twin of it would be found by nobody.
 * Written by hand and never overwritten: nothing here generates that filename.
 *
 * A repo that writes a bad table loses that language, with a line saying so —
 * never the whole index.
 */
export function languagesFor(root) {
  const override = readJson(join(root, OUT_DIR, 'languages.json'))
  const merged = override && typeof override === 'object'
    ? { ...BUILTIN_LANGS, ...override }
    : BUILTIN_LANGS
  const { ok, problems } = usable(merged)
  return { langs: ok, byExt: byExtOf(ok), problems }
}

// Only the coarse forms are honoured: a bare directory name, `name/`, and
// `/name`. Globs are not interpreted — guessing at gitignore semantics would
// silently drop source files, which is worse than walking a few extra ones.
function readIgnoreNames(root) {
  const names = new Set()
  for (const f of ['.gitignore', '.codegraphignore']) {
    const p = join(root, f)
    if (!existsSync(p)) continue
    for (let line of readFileSync(p, 'utf8').split('\n')) {
      line = line.trim()
      if (!line || line.startsWith('#') || line.startsWith('!')) continue
      if (line.includes('*') || line.includes('?')) continue
      names.add(line.replace(/^\/+|\/+$/g, ''))
    }
  }
  return names
}

/** The extension including its dot, or '' — the key into the language table. */
export function extOf(name) {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i)
}

/**
 * A NUL byte in the first kilobyte means binary. Cheap, and wrong only for text
 * that nobody writes code in — the alternative is a dependency.
 */
export function isProbablyText(text) {
  return !text.slice(0, 1024).includes('\0')
}

/**
 * Every file under root worth reading, as repo-relative POSIX paths, each with
 * the language id it was recognised as — or `null` for tier 0, a file indexed
 * only as a source of identifiers.
 */
export function walk(root, byExt = LANG_BY_EXT) {
  const ignored = readIgnoreNames(root)
  const found = []

  const visit = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return // unreadable directory is not a reason to fail the whole run
    }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.') {
        if (!byExt[extOf(e.name)]) continue
      }
      if (ALWAYS_SKIP.has(e.name) || ignored.has(e.name)) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        visit(full)
        continue
      }
      if (!e.isFile()) continue

      const ext = extOf(e.name)
      const lang = byExt[ext] || null
      if (!lang && (!ext || NEVER_INDEXED.has(ext))) continue

      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.size > (lang ? MAX_FILE_BYTES : MAX_TIER0_BYTES)) continue
      found.push({
        path: relative(root, full).split(sep).join('/'),
        size: st.size,
        mtime: Math.floor(st.mtimeMs),
        lang,
      })
    }
  }

  visit(root)
  found.sort((a, b) => (a.path < b.path ? -1 : 1))
  return found
}

/** File contents, or null. An unreadable file is skipped rather than fatal:
 *  one bad path must not cost the whole index. */
export function readFile(root, relPath) {
  try {
    return readFileSync(join(root, relPath), 'utf8')
  } catch {
    return null
  }
}

/**
 * Stop a closed pipe from becoming a stack trace. `| head`, `| less` and every
 * pager close stdout mid-write; unhandled, that surfaces as an EPIPE crash that
 * reads like the tool broke, and it only happens once the output outgrows the
 * pipe buffer — so it looks intermittent too. Called first thing in every main.
 */
export function ignoreEpipe() {
  process.stdout.on('error', (e) => {
    if (e.code === 'EPIPE') process.exit(0)
    throw e
  })
}

/**
 * Whether this module is the script being run, rather than one being imported.
 * Every main is guarded by it: unguarded, importing `write-maps.mjs` makes the
 * gate rewrite files as a side effect of checking them.
 *
 * Comparing `import.meta.url` to `process.argv[1]` directly is the obvious
 * version and it is wrong through a symlink. Node resolves `import.meta.url`
 * to the real path while `argv[1]` keeps the link, so the guard never matches
 * and the command exits 0 having done nothing — no output, no error, nothing
 * that looks broken. Skills are almost always installed as a link into
 * `~/.claude/skills`, so that is the normal case, not the exotic one.
 *
 * Both comparisons are needed: `--preserve-symlinks-main` turns the resolution
 * off, and then only the unresolved one matches. `argv[1]` is undefined under
 * `node -e` and the REPL, where nothing is the main module.
 */
export function isMain(metaUrl) {
  const argv = process.argv[1]
  if (!argv) return false
  if (metaUrl === pathToFileURL(argv).href) return true
  try {
    return metaUrl === pathToFileURL(realpathSync(argv)).href
  } catch {
    return false // argv[1] is not a path we can resolve; not the main module
  }
}

/** Cheap, stable, dependency-free. Only ever compared for equality. */
export function hash(text) {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0
  }
  return (h1.toString(36) + h2.toString(36)).slice(0, 12)
}
