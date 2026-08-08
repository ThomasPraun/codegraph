// One fixture per language, asserting the symbols its table entry finds.
//
//   node --test "tests/*.test.mjs"
//
// A regex in languages.json breaks nothing when it rots — it simply stops
// matching, and the language quietly returns fewer symbols. This file is what
// makes that loud.
//
// Every source lives in fixtures.json, never inline here. Declarations match
// the raw text on purpose (see `collect`), so an `export function` inside a
// template literal in this file would be a real symbol in the skill's own
// index. `.json` is in NEVER_INDEXED, which is what keeps it out.

import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { BUILTIN_LANGS, languagesFor } from '../scripts/lib/scan.mjs'
import { parseFile } from '../scripts/lib/parse.mjs'

const { cases, snippets } = JSON.parse(
  readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8')
)

const names = (path, langId, src) =>
  parseFile(path, BUILTIN_LANGS[langId], src).symbols.map((s) => s.name).sort()

const parsed = (path, langId, src) => parseFile(path, BUILTIN_LANGS[langId], src).symbols

for (const { lang, path, src, expected, documented } of cases) {
  test(`${lang}: finds its public symbols`, () => {
    assert.deepEqual(names(path, lang, src), expected)
  })

  // A found symbol with no description lands in `gaps` and cannot be searched
  // by purpose, which is most of what the index is for. Annotations are what
  // breaks this — `@Service`, `[HttpGet]`, `#[Attribute]` sit between the
  // comment and the declaration and were counted as a blank line, costing the
  // description of exactly the classes most likely to carry one.
  if (documented) {
    test(`${lang}: keeps the description attached`, () => {
      const missing = parsed(path, lang, src)
        .filter((s) => documented.includes(s.name) && !s.desc)
        .map((s) => s.name)
      assert.deepEqual(missing, [], 'these lost their comment')
    })
  }
}

test('every shipped language compiles and declares extensions', () => {
  const { langs, problems } = languagesFor('.')
  assert.deepEqual(problems, [])
  for (const [id, spec] of Object.entries(langs)) {
    assert.ok(spec.exts.length, `${id} declares no extensions`)
    assert.ok(spec.decls?.length || spec.fileIsComponent, `${id} finds nothing`)
  }
})

test('no two languages claim the same extension', () => {
  const seen = new Map()
  for (const [id, spec] of Object.entries(BUILTIN_LANGS)) {
    for (const ext of spec.exts) {
      assert.equal(seen.get(ext), undefined, `${ext} claimed by ${seen.get(ext)} and ${id}`)
      seen.set(ext, id)
    }
  }
})

test('a description harvested from the code reaches the symbol', () => {
  const { symbols } = parseFile('src/money.py', BUILTIN_LANGS.python, snippets.pythonDoc)
  assert.equal(symbols[0].desc, 'Formats an amount with its currency symbol.')
})

test('a blank line between comment and declaration breaks the association', () => {
  const { symbols } = parseFile('src/a.ts', BUILTIN_LANGS.ts, snippets.blankLineBreaks)
  assert.equal(symbols[0].desc, '')
})

test('tier 0 yields identifiers and never a symbol', () => {
  const out = parseFile('deploy.sh', null, '# calls formatMoney\nrun Wallet\n')
  assert.deepEqual(out.symbols, [])
  assert.ok(out.idents.includes('Wallet'))
})

test('a body only appears where the table says one can be found', () => {
  const braces = parseFile('a.ts', BUILTIN_LANGS.ts, snippets.bracedBody)
  const none = parseFile('a.rb', BUILTIN_LANGS.ruby, snippets.noBody)
  assert.ok(braces.symbols[0].tokenCount > 0)
  assert.equal(none.symbols[0].tokenCount, 0, 'ruby is tier 1 on purpose — see references/languages.md')
})

test('an unterminated quote blanks to end of line, never past it', () => {
  // A quote inside a regex literal used to open a string that ran to the end of
  // the file, taking every edge after it. See `stringEnd`.
  const { idents } = parseFile('a.ts', BUILTIN_LANGS.ts,
    'const RE = /[\'"]([^\'"]+)[\'"]/g\nexport function afterTheRegex() {}\nconst x = laterIdentifier\n')
  assert.ok(idents.includes('laterIdentifier'), 'blanking ran past the line')
})
