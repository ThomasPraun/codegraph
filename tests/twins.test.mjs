// What twin detection stops comparing, and whether it admits to it.
//
// `AMBIENT_BUCKET` drops any feature shared by too many symbols, on the theory
// that it is boilerplate. The theory is fine and the failure mode inverts: the
// more copy-paste a repo has, the more buckets go ambient, so the repo most in
// need of this is the one it goes quietest about. Reporting the skip is what
// keeps "no candidates" from being read as "no duplicates".

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extract } from '../scripts/extract.mjs'
import { OUT_DIR } from '../scripts/lib/scan.mjs'
import { candidates } from '../scripts/twins.mjs'

/** `count` files each holding the same function under a different name. */
function clones(count) {
  const dir = mkdtempSync(join(tmpdir(), 'codegraph-twins-'))
  mkdirSync(join(dir, 'src'))
  for (let i = 0; i < count; i++) {
    writeFileSync(join(dir, 'src', `f${i}.ts`), [
      `/** Totals the cart for tenant ${i}. */`,
      `export function total${i}(items, rate) {`,
      '  let sum = 0',
      '  for (const it of items) { sum += it.price }',
      '  if (rate > 0) { sum = sum * rate }',
      '  return sum',
      '}',
      '',
    ].join('\n'))
  }
  const { index } = extract(dir, join(dir, OUT_DIR), { full: true })
  return { dir, index }
}

test('a handful of clones are raised as candidates', () => {
  const { dir, index } = clones(6)
  try {
    const pairs = candidates(index)
    assert.ok(pairs.length > 0, 'six identical functions must pair')
    assert.equal(pairs.skippedAsAmbient, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('past the ambient threshold it goes quiet, and says how quiet', () => {
  const { dir, index } = clones(220) // AMBIENT_BUCKET is 200
  try {
    const pairs = candidates(index)
    assert.ok(pairs.skippedAsAmbient > 0, 'the skip must be reported, not swallowed')
    assert.ok(
      pairs.skippedAsAmbient <= index.symbols.length,
      'a symbol ambient on both routes is one symbol, not two'
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
