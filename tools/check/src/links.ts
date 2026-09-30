import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { listMarkdown } from './files.js'
import type { Problem } from './types.js'

const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g
const FENCE = /^\s*(`{3,}|~{3,})/

/** Relative links in markdown files that point to files that do not exist; code blocks are skipped. */
export function checkLinks(root: string): Problem[] {
  const problems: Problem[] = []
  for (const file of listMarkdown(root)) {
    // A block closes only with the same fence character, at least as long (CommonMark), so a
    // ``` block nested inside a ~~~~ block does not end the outer one.
    let fence: string | null = null
    readFileSync(join(root, file), 'utf8').split('\n').forEach((text, i) => {
      const marker = FENCE.exec(text)?.[1]
      if (marker) {
        if (!fence) fence = marker
        else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null
        return
      }
      if (fence) return
      for (const match of text.matchAll(LINK)) {
        const target = match[1]
        if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue
        if (!existsSync(join(root, dirname(file), target.split('#')[0]))) {
          problems.push({ file, line: i + 1, message: `broken link: ${target}` })
        }
      }
    })
  }
  return problems
}
