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
import { renderMaps } from './write-maps.mjs'

const DEFAULT_BUDGET = 200

function loadBudgets(root) {
  const p = join(root, 'docs-graph', 'budgets.json')
  if (!existsSync(p)) return {}
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return {}
  }
}

/** Every identifier the repo contains, from the extractor's cache. This is the
 *  haystack a citation has to be found in. */
function loadHaystack(root) {
  const p = join(root, 'docs-graph', '.cache.json')
  if (!existsSync(p)) return null
  try {
    const files = JSON.parse(readFileSync(p, 'utf8')).files || {}
    const all = new Set()
    for (const f of Object.values(files)) for (const id of f.idents || []) all.add(id)
    return all
  } catch {
    return null
  }
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

  const convention = conventionOf(root)
  if (convention.mixed) {
    add('.', 'both CLAUDE.md and AGENTS.md exist — pick one convention for the repo')
  }

  const docs = classify(findDocFiles(root).map((p) => readDoc(root, p)))
  if (!docs.length) return { findings, docs: [] }

  const budgets = loadBudgets(root)
  const haystack = loadHaystack(root)
  const blocks = renderMaps(docs, root)

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

    const budget = budgets[d.path] ?? DEFAULT_BUDGET
    const count = bodyLineCount(d.body)
    if (count > budget) {
      add(d.path, `${count} body lines, budget ${budget} — cut prose, do not raise the budget`)
    }
  }

  return { findings, docs, haystack: !!haystack }
}

function main() {
  const argv = process.argv.slice(2)
  const rootIdx = argv.indexOf('--root')
  const root = rootIdx >= 0 ? argv[rootIdx + 1] : '.'
  const strict = argv.includes('--check')

  const { findings, docs, haystack } = run(root)

  if (!docs.length) {
    process.stdout.write('No CLAUDE.md or AGENTS.md files found. Nothing to check.\n')
    return
  }
  if (!haystack) {
    process.stdout.write('No docs-graph/.cache.json — symbol citations were not checked.\n' +
      'Run extract.mjs first to enable that check.\n\n')
  }

  if (!findings.length) {
    process.stdout.write(`${docs.length} doc file(s) checked. Green.\n`)
    return
  }

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

main()
