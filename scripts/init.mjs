#!/usr/bin/env node
// Writes the standing orders into a repo's root CLAUDE.md — how to use the
// index, and the three rules that make it worth using.
//
//   node scripts/init.mjs [root] [--force]
//
// The text is fixed. It names no symbol, counts nothing and cites no path
// inside the repo, so there is nothing in it that can stop being true — which
// is why this needs no marker, no freshness record and no gate. A generated
// block would need all three, and each of them is a thing that can be wrong.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { ignoreEpipe, isMain } from './lib/scan.mjs'

const DOC_NAMES = ['CLAUDE.md', 'AGENTS.md']

// Distinctive enough that finding it means these orders are already installed,
// and short enough to survive someone rewording the section around it. Checked
// instead of a marker: a marker is a promise to keep the block current, and
// fixed text has nothing to keep current.
export const SENTINEL = 'holds an index of every exported symbol'

/** The section installed into a repo's root doc file. Fixed text: it names no
 *  symbol and counts nothing, so there is no version of it that can be behind
 *  the code, and nothing to regenerate, prove fresh or re-review. */
export const ORDERS = `## The index

\`codegraph/\` holds an index of every exported symbol, its comment, and who
uses it. It is **never rebuilt automatically** — ask before rebuilding.

\`\`\`bash
<skill>/scripts/query.mjs find "<purpose>"    # does this exist already?
<skill>/scripts/query.mjs ripples <path>      # what reaches what I touched
<skill>/scripts/query.mjs who <symbol>        # who calls this
<skill>/scripts/query.mjs gaps [dir]          # exported, uncommented, most-used first
<skill>/scripts/extract.mjs .                 # rebuild — only when asked
\`\`\`

- **Search by purpose, in plain words** — never by the name you were going to
  use. The duplicate has a different name; that is why nobody found it.
- **A thin result is a miss, not proof of absence.** This matches text, it does
  not understand code. Grep before concluding something does not exist.
- **Descriptions live above the symbol, in the code**, and nowhere else. The
  index harvests them. To fix one, edit the comment.
- Every command says when the tree has moved past the index. Report that and
  **offer** to rebuild. Never rebuild unasked.
- When you touch a symbol that carries no comment, **offer to write one**.
`

/**
 * Installs the standing orders, or reports that they are already there.
 *
 * Appends; never rewrites. Whatever else is in the file is somebody's, and a
 * tool that reformats a CLAUDE.md to install itself is one that gets removed
 * along with its section.
 */
export function install(root, { force = false } = {}) {
  const existing = DOC_NAMES.map((n) => join(root, n)).find((p) => existsSync(p))
  const path = existing || join(root, DOC_NAMES[0])
  const before = existing ? readFileSync(path, 'utf8') : ''

  if (!force && before.includes(SENTINEL)) {
    return { path, action: 'present' }
  }

  const head = existing ? '' : `# ${root === '.' ? 'This repo' : root.split('/').filter(Boolean).pop()}\n\n`
  const gap = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : ''
  writeFileSync(path, `${before}${gap}${head}${ORDERS}`)
  return { path, action: existing ? 'appended' : 'created' }
}

function main() {
  ignoreEpipe()
  const argv = process.argv.slice(2)
  const root = argv.find((a) => !a.startsWith('--')) || '.'
  const { path, action } = install(root, { force: argv.includes('--force') })

  process.stdout.write(
    {
      present: `${path} already carries the index rules. Nothing written.\n` +
        'Pass --force to append them again.\n',
      appended: `Index rules appended to ${path}.\n`,
      created: `Created ${path} with the index rules.\n`,
    }[action] +
      (action === 'present'
        ? ''
        : '\nReplace <skill> with the path this was run from, and add anything the\n' +
          'owner wants remembered every session below it.\n')
  )
}

// Only run as a command: an unguarded main() turns `import` into a side effect.
if (isMain(import.meta.url)) main()
