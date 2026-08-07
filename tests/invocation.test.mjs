// How the scripts are invoked, which is the one thing no other test exercises:
// every test here imports the scripts, and the bug this file exists for only
// appears when they are run as commands from somewhere else.
//
// A skill is installed as a symlink — `~/.claude/skills/<name>` pointing at
// wherever it was cloned — so through-a-link is the normal invocation, not an
// exotic one. Node resolves `import.meta.url` to the real path and leaves
// `process.argv[1]` on the link, so a guard comparing the two never matches:
// every command exited 0 having done nothing, with no output and no error.
// Nothing about that looks broken, which is what makes it worth a test.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { OUT_DIR } from '../scripts/lib/scan.mjs'

const REPO = new URL('../', import.meta.url).pathname

const DOC = `---
scope: .
---

# Fixture

<!-- @codegraph:start — generated. Do not edit. -->
<!-- @codegraph:end -->
`

// A project, plus a symlink standing in for ~/.claude/skills/codegraph.
function installed() {
  const dir = mkdtempSync(join(tmpdir(), 'codegraph-invoke-'))
  const proj = join(dir, 'proj')
  mkdirSync(join(proj, 'src'), { recursive: true })
  writeFileSync(join(proj, 'src', 'money.ts'), '/** Formats. */\nexport function formatMoney(n) { return n }\n')
  writeFileSync(join(proj, 'CLAUDE.md'), DOC)
  symlinkSync(REPO, join(dir, 'skill'))
  return { dir, proj, script: (n) => join(dir, 'skill', 'scripts', n) }
}

const node = (args, opts) => execFileSync('node', args, { encoding: 'utf8', ...opts })

test('a command invoked through a symlinked install actually runs', () => {
  const { dir, proj, script } = installed()
  try {
    const out = node([script('extract.mjs'), proj])
    assert.match(out, /1 symbols/, 'silence here is the whole bug: exit 0, nothing done')
    assert.ok(existsSync(join(proj, OUT_DIR, 'index.json')))

    // The query side reads the index it just wrote, still through the link.
    assert.match(node([script('query.mjs'), 'find', 'formats', '--root', proj]), /formatMoney/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--preserve-symlinks-main is the other half of the guard', () => {
  const { dir, proj, script } = installed()
  try {
    // With resolution off, argv[1] and import.meta.url both keep the link.
    // Only the unresolved comparison matches, so both must be tried.
    const out = node(['--preserve-symlinks-main', script('extract.mjs'), proj])
    assert.match(out, /1 symbols/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('importing a script is never a side effect, even with no argv[1]', () => {
  const { dir, proj, script } = installed()
  try {
    node([script('extract.mjs'), proj])
    const before = readFileSync(join(proj, 'CLAUDE.md'), 'utf8')

    // `node -e` leaves process.argv[1] undefined. Unguarded, this rewrites the
    // doc file; guarded by a bare `import.meta.url === pathToFileURL(argv[1])`
    // it throws instead of returning false.
    const out = node(['-e', `import(${JSON.stringify(script('write-maps.mjs'))})`], { cwd: proj })

    assert.equal(out, '', 'an import must not print')
    assert.equal(readFileSync(join(proj, 'CLAUDE.md'), 'utf8'), before, 'an import must not write')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
