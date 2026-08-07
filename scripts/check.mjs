#!/usr/bin/env node
// The gate.
//
//   node scripts/check.mjs [--root .]      report findings, always exit 0
//   node scripts/check.mjs --check         exit 1 if there is any finding (CI)
//
// It verifies FORM, never TRUTH: that a path resolves, that a cited symbol
// exists, that a generated block is fresh, that a budget holds. It never
// decides whether a documented invariant is still true — that would require
// understanding the code, and a gate that can be wrong about meaning gets
// `continue-on-error: true` bolted onto it within a month.

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  findDocFiles, readDoc, classify, splice, bodyLineCount, pathExists, conventionOf,
} from './lib/docs.mjs'
import { renderMaps, scopeFingerprints, readFreshness } from './write-maps.mjs'
import { tryLoad, outDirFor } from './lib/graph.mjs'
import { ignoreEpipe } from './lib/scan.mjs'
import { pathToFileURL } from 'node:url'

// A target, not a wall. Past it the answer is almost never "delete a sentence":
// it is "this directory is carrying two subjects, split it". Only past
// HARD_MULTIPLE does the file stop being readable at all, and only then does it
// fail — a gate that fires on 201 lines teaches people to raise the number.
const DEFAULT_BUDGET = 200
const HARD_MULTIPLE = 1.5

function loadBudgets(root) {
  const p = join(outDirFor(root), 'budgets.json')
  if (!existsSync(p)) return {}
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return {}
  }
}

/**
 * Every identifier the repo contains — the haystack a citation has to be found
 * in. `index.json` is read first because it is the committed half; `.cache.json`
 * is a fallback for an index written before `idents` was carried there.
 */
function loadHaystack(root) {
  const read = (name) => {
    const p = join(outDirFor(root), name)
    if (!existsSync(p)) return null
    try {
      return JSON.parse(readFileSync(p, 'utf8'))
    } catch {
      return null
    }
  }

  const index = read('index.json')
  if (index?.idents?.length) return new Set(index.idents)

  const cache = read('.cache.json')
  if (!cache) return null
  const all = new Set()
  for (const f of Object.values(cache.files || {})) for (const id of f.idents || []) all.add(id)
  return all.size ? all : null
}

function stripped(body) {
  return body
    .replace(/```[\s\S]*?```/g, '')       // fenced code is illustration, not citation
    .replace(/<!--\s*@map:start[\s\S]*?@map:end\s*-->/g, '') // generated, not authored
}

/**
 * Backticked tokens that look like a symbol. Deliberately narrow: an all-
 * lowercase word is prose, anything with a space, slash or dot is a path, and
 * SCREAMING_SNAKE is usually an env var living in files this tool never
 * indexes. Flagging those would make the gate noisy, and a noisy gate is a
 * disabled gate.
 */
function citations(body) {
  const out = []
  for (const m of stripped(body).matchAll(/`([^`\n]+)`/g)) {
    const raw = m[1].trim()
    const bare = raw.replace(/\(\)$/, '')
    if (!/^[A-Za-z_$][\w$]*$/.test(bare)) continue
    if (/^[A-Z0-9_]+$/.test(bare)) continue
    if (raw === bare && !/[A-Z]/.test(bare)) continue
    out.push(bare)
  }
  return [...new Set(out)]
}

function allowlist(text) {
  const out = new Set()
  for (const m of text.matchAll(/<!--\s*codegraph:\s*allow-symbol\s+([\w$]+)\s*-->/g)) out.add(m[1])
  return out
}

/** Every finding in the tree. Form only — a finding is a broken reference, a
 *  stale block or an over-budget file, never a claim judged wrong. */
export function run(root) {
  const findings = []
  const add = (file, msg) => findings.push({ file, msg })
  // Findings fail the build; notes never do. A note is something only a person
  // can settle — whether prose that describes moved code is still true. Making
  // it fail would put the gate in the business of judging meaning, and force
  // people to clear it by editing nothing.
  const notes = []
  const note = (file, msg) => notes.push({ file, msg })

  const convention = conventionOf(root)
  if (convention.mixed) {
    add('.', 'both CLAUDE.md and AGENTS.md exist — pick one convention for the repo')
  }

  const docs = classify(findDocFiles(root).map((p) => readDoc(root, p)))
  if (!docs.length) return { findings, notes, docs: [] }

  const budgets = loadBudgets(root)
  const haystack = loadHaystack(root)
  // A gate that could not run a check must never report Green. Silence here is
  // indistinguishable from a pass, and CI reads the exit code, not the prose.
  if (!haystack) {
    add('.', 'no indexed identifiers — run extract.mjs; symbol citations were NOT checked')
  }
  // Same `g` as write-maps.mjs passes, or the block renders differently here
  // and every file reads as permanently stale.
  const g = tryLoad(root)
  const blocks = renderMaps(docs, root, g)

  // The code a doc file speaks for, against the fingerprint taken the last time
  // someone reviewed it. Says the ground moved; never says the prose is wrong.
  const prints = scopeFingerprints(docs, g)
  const baseline = readFreshness(root)

  for (const d of docs) {
    for (const p of d.problems) add(d.path, p)

    if (d.data) {
      if (d.data.scope === undefined) {
        add(d.path, 'frontmatter has no `scope`')
      } else if (d.data.scope !== d.dir) {
        add(d.path, `scope is "${d.data.scope}" but the file lives in "${d.dir}"`)
      }
      if (d.layer === 'domain' && !(d.data.read_before || []).length) {
        add(d.path, 'no `read_before` — a domain file has to say when it is worth opening')
      }
      for (const r of d.data.ripples_to || []) {
        if (!pathExists(root, r.replace(/\/+$/, ''))) {
          add(d.path, `ripples_to "${r}" does not exist on disk`)
        }
      }
    }

    if (haystack) {
      const allowed = allowlist(d.text)
      for (const c of citations(d.body)) {
        if (!allowed.has(c) && !haystack.has(c)) {
          add(d.path, `cites \`${c}\`, which exists nowhere in the indexed code`)
        }
      }
    }

    const next = splice(d.text, blocks.get(d.path))
    if (next === null) add(d.path, 'no @map markers — place them by hand, then run write-maps.mjs --write')
    else if (next !== d.text) add(d.path, 'generated block is stale — run write-maps.mjs --write')

    const print = prints.get(d.path)
    if (print && baseline[d.path] === undefined) {
      note(d.path, 'never reviewed against its scope — run write-maps.mjs --reviewed to set the baseline')
    } else if (print && baseline[d.path] !== print) {
      note(d.path, `the code under "${d.dir}" changed since this file was last reviewed` +
        ' — re-read it, fix what stopped being true, then write-maps.mjs --reviewed')
    }

    const budget = budgets[d.path] ?? DEFAULT_BUDGET
    const count = bodyLineCount(d.body)
    if (count > budget * HARD_MULTIPLE) {
      add(d.path, `${count} written lines against a ${budget} target — too long to stay read.` +
        ' Split a subtree into its own file, or say it in fewer words. Never raise the target')
    } else if (count > budget) {
      note(d.path, `${count} written lines against a ${budget} target — worth asking whether a` +
        ' subtree deserves its own file, or whether this says something twice')
    }
  }

  return { findings, notes, docs, haystack: !!haystack }
}

function main() {
  ignoreEpipe()
  const argv = process.argv.slice(2)
  const rootIdx = argv.indexOf('--root')
  const root = rootIdx >= 0 ? argv[rootIdx + 1] : '.'
  const strict = argv.includes('--check')

  const { findings, notes, docs } = run(root)

  if (!docs.length) {
    process.stdout.write('No CLAUDE.md or AGENTS.md files found. Nothing to check.\n')
    return
  }
  // The budget counts what a human wrote; a reader loads the whole file, and
  // every ancestor of it. Left unsaid, the gate reports 72/200 while working in
  // that directory costs 128 lines, and the generated half reads as free when
  // it is only exempt from the budget.
  const lines = (t) => t.split('\n').filter((l) => l.trim()).length
  const byDir = new Map(docs.map((d) => [d.dir, d]))
  let worst = { chain: 0, path: '' }
  for (const d of docs) {
    let total = 0
    for (let cur = d; cur; cur = cur.parent ? byDir.get(cur.parent) : null) total += lines(cur.text)
    if (total > worst.chain) worst = { chain: total, path: d.path }
  }
  const written = docs.reduce((n, d) => n + bodyLineCount(d.body), 0)
  const generated = docs.reduce((n, d) => n + lines(d.text) - bodyLineCount(d.body), 0)
  const cost =
    `${docs.length} doc file(s) · ${written} written, ${generated} generated\n` +
    `Deepest chain a reader loads: ${worst.chain} lines (${worst.path} and its ancestors)\n`

  const asNotes = notes.length
    ? [`${notes.length} note(s) — yours to judge, they do not fail the build:`, '']
        .concat(notes.map((n) => `  · ${n.file}: ${n.msg}`))
        .concat('')
        .join('\n')
    : ''

  if (!findings.length) {
    process.stdout.write(`${cost}${asNotes}Green.\n`)
    return
  }
  process.stdout.write(`${cost}${asNotes}`)

  const byFile = new Map()
  for (const f of findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, [])
    byFile.get(f.file).push(f.msg)
  }
  const out = [`${findings.length} finding(s) across ${byFile.size} file(s):`, '']
  for (const [file, msgs] of byFile) {
    out.push(file)
    for (const m of msgs) out.push(`  · ${m}`)
    out.push('')
  }
  out.push('The gate checks form, never truth. A finding here is a broken reference,')
  out.push('a stale generated block or an over-budget file — never a wrong claim.')
  process.stdout.write(`${out.join('\n')}\n`)

  if (strict) process.exit(1)
}

// Only run as a command. An unguarded main() turns `import` into a side
// effect, and argv[1] is undefined under `node -e` and the REPL.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
