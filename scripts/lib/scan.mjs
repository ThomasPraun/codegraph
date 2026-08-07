// Tree walking and file reading. Node builtins only — no dependency may be
// added to this skill; it has to run in a repo that has installed nothing.

import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

// Directories that are never source. Kept as a list rather than read from
// .gitignore alone, because a repo that ignores nothing still should not be
// walked into node_modules.
const ALWAYS_SKIP = new Set([
  'node_modules', '.git', '.svn', '.hg',
  'dist', 'build', 'out', 'coverage', 'tmp',
  '.next', '.nuxt', '.astro', '.svelte-kit', '.turbo', '.cache',
  '.dart_tool', 'Pods', '.gradle', '.idea', '.vscode',
  '.venv', 'venv', '__pycache__', 'vendor',
  'docs-graph', 'graphify-out',
])

const MAX_FILE_BYTES = 1_000_000

/** Which extensions are indexed at all. Adding one here is step 1 of adding a
 *  language; see references/languages.md for the other two. */
export const LANG_BY_EXT = {
  '.ts': 'ts', '.tsx': 'ts', '.mts': 'ts', '.cts': 'ts',
  '.js': 'ts', '.jsx': 'ts', '.mjs': 'ts', '.cjs': 'ts',
  '.dart': 'dart',
  '.astro': 'astro',
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

/** The extension including its dot, or '' — the key into `LANG_BY_EXT`. */
export function extOf(name) {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i)
}

/** Every source file under root, as repo-relative POSIX paths. */
export function walk(root) {
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
        if (!LANG_BY_EXT[extOf(e.name)]) continue
      }
      if (ALWAYS_SKIP.has(e.name) || ignored.has(e.name)) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        visit(full)
      } else if (e.isFile() && LANG_BY_EXT[extOf(e.name)]) {
        let st
        try {
          st = statSync(full)
        } catch {
          continue
        }
        if (st.size > MAX_FILE_BYTES) continue
        found.push({
          path: relative(root, full).split(sep).join('/'),
          size: st.size,
          mtime: Math.floor(st.mtimeMs),
        })
      }
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
