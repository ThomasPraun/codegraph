// The two staleness signals, and the one thing they must never do: clear
// themselves.
//
// Neither rebuilds anything. The index is rebuilt when a person says so and a
// doc file is declared reviewed when a person says so — the tool's whole job
// here is to make sure they are told, and then to stay out of the way.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { extract } from '../scripts/extract.mjs'
import { staleness } from '../scripts/lib/graph.mjs'
import { languagesFor, OUT_DIR } from '../scripts/lib/scan.mjs'
import { run } from '../scripts/check.mjs'

const SCRIPTS = new URL('../scripts/', import.meta.url).pathname

const DOC = `---
scope: .
---

# Fixture

The house rule is that money is rounded in exactly one place.

<!-- @codegraph:start — generated. Do not edit. -->
<!-- @codegraph:end -->
`

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'codegraph-fresh-'))
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'src', 'money.ts'), '/** Rounds. */\nexport function round(n) { return n }\n')
  writeFileSync(join(dir, 'CLAUDE.md'), DOC)
  extract(dir, join(dir, OUT_DIR), { full: true })
  return dir
}

const maps = (dir, ...args) =>
  execFileSync('node', [join(SCRIPTS, 'write-maps.mjs'), '--root', dir, ...args], { encoding: 'utf8' })

const noted = (dir, re) => run(dir).notes.some((n) => re.test(n.msg))

test('a tree that moved past the index is reported, and nothing rebuilds', () => {
  const dir = repo()
  try {
    assert.equal(staleness(dir, languagesFor(dir).byExt).total, 0)

    writeFileSync(join(dir, 'src', 'extra.ts'), '/** New. */\nexport function extra() { return 1 }\n')
    const s = staleness(dir, languagesFor(dir).byExt)
    assert.equal(s.added, 1, 'a new file must show as drift')

    // The index on disk is untouched: reporting is not rebuilding.
    const index = JSON.parse(readFileSync(join(dir, OUT_DIR, 'index.json'), 'utf8'))
    assert.equal(index.symbols.length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a doc file with no baseline says so', () => {
  const dir = repo()
  try {
    maps(dir, '--write')
    assert.ok(noted(dir, /never reviewed/))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('code moving under a doc raises a note, and never a finding', () => {
  const dir = repo()
  try {
    maps(dir, '--write')
    maps(dir, '--reviewed')
    assert.ok(!noted(dir, /changed since/), 'just reviewed: nothing to say')

    writeFileSync(join(dir, 'src', 'money.ts'), '/** Rounds. */\nexport function round(n) { return n + 1 }\n')
    extract(dir, join(dir, OUT_DIR), { full: true })
    maps(dir, '--write')

    const { findings, notes } = run(dir)
    assert.ok(notes.some((n) => /changed since/.test(n.msg)), 'the ground moved and must be flagged')
    assert.ok(
      !findings.some((f) => /changed since/.test(f.msg)),
      'it is a note: only a person can say whether the prose is still true'
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--write does not clear the signal; only --reviewed does', () => {
  const dir = repo()
  try {
    maps(dir, '--write')
    maps(dir, '--reviewed')
    writeFileSync(join(dir, 'src', 'money.ts'), '/** Rounds. */\nexport function round(n) { return n * 2 }\n')
    extract(dir, join(dir, OUT_DIR), { full: true })

    maps(dir, '--write')
    assert.ok(noted(dir, /changed since/), 'a mechanical rebuild must not count as a review')

    maps(dir, '--reviewed')
    assert.ok(!noted(dir, /changed since/), '--reviewed is the human saying they looked')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
