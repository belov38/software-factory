import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { listMarkdown } from './files.js'
import type { Problem } from './types.js'

const PHASE = ['## Purpose', '## Steps', '## Done when']
const CARD = ['## Facts', '## Pitfalls', '## Smoke test']

function kind(file: string): 'phase' | 'card' | null {
  if (/^prompts\/integrations\/[^/]+\.md$/.test(file)) return 'card'
  if (/^prompts\/operate\/[^/]+\.md$/.test(file)) return 'phase'
  if (/^prompts\/[^/]+\.md$/.test(file) && file !== 'prompts/README.md') return 'phase'
  return null
}

/** Phase prompts and integration cards must have their fixed sections (see prompts/README.md). */
export function checkStructure(root: string): Problem[] {
  const problems: Problem[] = []
  for (const file of listMarkdown(root)) {
    const k = kind(file)
    if (!k) continue
    const text = readFileSync(join(root, file), 'utf8')
    const lines = text.split('\n').map((l) => l.trim())
    for (const heading of k === 'card' ? CARD : PHASE) {
      if (!lines.includes(heading)) problems.push({ file, line: 1, message: `missing section "${heading}"` })
    }
    if (k === 'card' && !/^Tested with: .+$/m.test(text)) problems.push({ file, line: 1, message: 'missing "Tested with:" line' })
  }
  return problems
}
