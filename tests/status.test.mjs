// `status` — where a repo stands — and `orient`, which is what nothing after
// the command means.
//
// Two properties matter more than the wording. It must survive having no index
// — that is the state it exists to report, and every other command exits 2 on
// it. And it must not repair anything: a status that rebuilds what it finds
// stale is one nobody can run to find out where they stand.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { extract } from '../scripts/extract.mjs'
import { languagesFor, OUT_DIR } from '../scripts/lib/scan.mjs'
import { status, orient } from '../scripts/query.mjs'

const QUERY = new URL('../scripts/query.mjs', import.meta.url).pathname

function repo({ indexed = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'codegraph-status-'))
  mkdirSync(join(dir, 'src', 'api'), { recursive: true })
  mkdirSync(join(dir, 'src', 'db'), { recursive: true })
  writeFileSync(join(dir, 'src', 'api', 'money.ts'),
    '/** Formats an amount. */\nexport function formatMoney(n) { return n }\n' +
    'export function helper(a) { return a }\nexport function other(a) { return a }\n')
  writeFileSync(join(dir, 'src', 'db', 'conn.ts'), 'export function connect(a) { return a }\n')
  if (indexed) extract(dir, join(dir, OUT_DIR), { full: true })
  return dir
}

const of = (dir) => status(dir, languagesFor(dir).byExt)

test('with no index it reports that, instead of exiting', () => {
  const dir = repo({ indexed: false })
  try {
    const out = of(dir)
    assert.match(out, /Index\s+none yet/)
    assert.match(out, /extract\.mjs/, 'the one command that changes it')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the bare invocation orients and offers, rather than reporting', () => {
  const dir = repo()
  try {
    const out = execFileSync('node', [QUERY, '--root', dir], { encoding: 'utf8' })
    assert.match(out, /--status/, 'the options are the point')
    assert.match(out, /Ask in words/, 'questions belong in prose, and it has to say so')
    // Someone with no command has not asked how stale anything is. Counts are
    // an answer to a question they have not formed, and they bury the one
    // thing that helps, which is what to type next.
    assert.doesNotMatch(out, /Drift/)
    assert.doesNotMatch(out, /worst:/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('orienting works before there is anything to report', () => {
  const dir = repo({ indexed: false })
  try {
    const out = orient(dir)
    assert.match(out, /No index here yet/)
    assert.match(out, /--index/, 'which makes one option the obvious first')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a command written with dashes is an error, never a quiet status', () => {
  const dir = repo()
  try {
    // Adding status made "no command" meaningful, which turned every unknown
    // flag into one: `--gaps` fell through and answered with status, exit 0.
    // Someone who asked for gaps got a different question answered.
    assert.throws(
      () => execFileSync('node', [QUERY, '--gaps', '--root', dir], { encoding: 'utf8', stdio: 'pipe' }),
      (e) => e.status === 2 && /Unknown flag/.test(String(e.stderr))
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('it names the worst directory, not just a total', () => {
  const dir = repo()
  try {
    // A count is a number nobody can start on; a directory is an afternoon.
    assert.match(of(dir), /worst: src\/api \(2\)/)
    assert.match(of(dir), /gaps src\/api/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a suggested command carries --root, so it works pasted elsewhere', () => {
  const dir = repo()
  try {
    for (const l of of(dir).split('\n')) {
      if (!l.includes('query.mjs') && !l.includes('twins.mjs')) continue
      assert.ok(l.includes(`--root ${dir}`), `no --root in: ${l.trim()}`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('it reports drift and repairs nothing', () => {
  const dir = repo()
  try {
    const before = readFileSync(join(dir, OUT_DIR, 'index.json'), 'utf8')
    writeFileSync(join(dir, 'src', 'db', 'extra.ts'), 'export function extra() { return 1 }\n')

    assert.match(of(dir), /Drift\s+1 new file\(s\)/)
    assert.equal(readFileSync(join(dir, OUT_DIR, 'index.json'), 'utf8'), before,
      'reporting drift must never be rebuilding')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('twins is reported as verdicts recorded, never as "never run"', () => {
  const dir = repo()
  try {
    // twins.json only appears once a verdict is recorded, so a clean run leaves
    // nothing behind. Claiming "never run" would be wrong on every repo that
    // has no duplicates — which is the repo this is most likely to run in.
    assert.ok(!existsSync(join(dir, OUT_DIR, 'twins.json')))
    const out = of(dir)
    assert.match(out, /Twins\s+no verdict recorded/)
    assert.doesNotMatch(out, /never run/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
