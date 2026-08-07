// What `find` can still answer when the repo has no comments in it.
//
// That is the state every repo starts in, and the state the tool is least
// useful in: with no descriptions harvested, only the symbol's own name is left
// to match against, and the name is exactly what the person searching does not
// know — it is why they never found the duplicate.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extract } from '../scripts/extract.mjs'
import { OUT_DIR } from '../scripts/lib/scan.mjs'
import { tryLoad } from '../scripts/lib/graph.mjs'
import { find } from '../scripts/query.mjs'

function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'codegraph-query-'))
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(dir, path.split('/').slice(0, -1).join('/')), { recursive: true })
    writeFileSync(join(dir, path), body)
  }
  extract(dir, join(dir, OUT_DIR), { full: true })
  return dir
}

const withRepo = (files, fn) => {
  const dir = repo(files)
  try {
    return fn(tryLoad(dir))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('the path answers when the name and the comment cannot', () => {
  const out = withRepo({
    'src/checkout/totals.ts': 'export function compute(a, b) { return a + b }\n',
    'src/mail/sender.ts': 'export function build() { return 1 }\n',
  }, (g) => find(g, 'checkout total', 8))

  assert.match(out, /compute/, 'src/checkout/totals.ts should answer "checkout total"')
  assert.doesNotMatch(out, /build/, 'the mail module is not a checkout total')
})

test('a harvested description still outranks a path', () => {
  const out = withRepo({
    'src/misc/a.ts': '/** Totals a checkout cart. */\nexport function tally(x) { return x }\n',
    'src/checkout/b.ts': 'export function compute(x) { return x }\n',
  }, (g) => find(g, 'totals a checkout cart', 8))

  assert.ok(out.indexOf('tally') < out.indexOf('compute'), 'description must win over path')
})

test('an empty result says so instead of implying absence', () => {
  const out = withRepo(
    { 'src/a.ts': 'export function alpha() { return 1 }\n' },
    (g) => find(g, 'quantum entanglement scheduler', 8)
  )
  assert.match(out, /not proof of absence/)
})
