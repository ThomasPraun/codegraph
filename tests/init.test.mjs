// Installing the index rules into a repo's root doc file.
//
// This is the only thing in the skill that writes into somebody's source tree
// rather than into `codegraph/`, so the property that matters is not what it
// writes but what it leaves alone: run twice it must not duplicate, and it
// must never rewrite what was already in the file.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { install, SENTINEL } from '../scripts/init.mjs'

const dir = () => mkdtempSync(join(tmpdir(), 'codegraph-init-'))
const withDir = (fn) => {
  const d = dir()
  try {
    fn(d)
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
}

test('with no doc file it creates one', () => {
  withDir((d) => {
    const { path, action } = install(d)
    assert.equal(action, 'created')
    assert.ok(existsSync(path))
    assert.match(readFileSync(path, 'utf8'), /A thin result is a miss/)
  })
})

test('an existing file keeps everything it already had', () => {
  withDir((d) => {
    const p = join(d, 'CLAUDE.md')
    const owner = '# my-app\n\nRun the migrations before the seeds. Always.\n'
    writeFileSync(p, owner)

    const { action } = install(d)
    assert.equal(action, 'appended')
    const after = readFileSync(p, 'utf8')
    assert.ok(after.startsWith(owner), 'what the owner wrote comes first and untouched')
    assert.match(after, /## The index/)
  })
})

test('running twice does not install twice', () => {
  withDir((d) => {
    install(d)
    const once = readFileSync(join(d, 'CLAUDE.md'), 'utf8')

    const { action } = install(d)
    assert.equal(action, 'present')
    assert.equal(readFileSync(join(d, 'CLAUDE.md'), 'utf8'), once, 'a second run changes nothing')
  })
})

test('AGENTS.md is used when that is the repo convention', () => {
  withDir((d) => {
    writeFileSync(join(d, 'AGENTS.md'), '# my-app\n')
    const { path, action } = install(d)
    assert.equal(action, 'appended')
    assert.match(path, /AGENTS\.md$/, 'never a second convention alongside the first')
    assert.ok(!existsSync(join(d, 'CLAUDE.md')))
  })
})

test('the sentinel is text the rules actually contain', () => {
  withDir((d) => {
    // Checked rather than marked. If these drift apart, every run reinstalls
    // and the file grows a copy of the rules each time.
    install(d)
    assert.ok(readFileSync(join(d, 'CLAUDE.md'), 'utf8').includes(SENTINEL))
  })
})
