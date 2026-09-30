import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { listMarkdown } from './files.js'
import type { Problem } from './types.js'

const VERIFY = 'prompts/verify.md'
const ID = /\b(?:INSTALL|CORE|REVIEW|FEEDBACK|ISOLATION|HARNESS)-\d+\b/g
const DEFINITION = /^\|\s*([A-Z]+-\d+)\s*\|/

/** Acceptance ids: defined in the table of prompts/verify.md, referenced by the other prompts. */
export function checkIds(root: string): Problem[] {
  const files = listMarkdown(root).filter((f) => f.startsWith('prompts/'))
  const defined = new Map<string, number>()
  if (files.includes(VERIFY)) {
    readFileSync(join(root, VERIFY), 'utf8').split('\n').forEach((text, i) => {
      const match = DEFINITION.exec(text)
      if (match) defined.set(match[1], i + 1)
    })
  }
  const problems: Problem[] = []
  const referenced = new Set<string>()
  for (const file of files.filter((f) => f !== VERIFY)) {
    readFileSync(join(root, file), 'utf8').split('\n').forEach((text, i) => {
      for (const match of text.matchAll(ID)) {
        referenced.add(match[0])
        if (!defined.has(match[0])) {
          problems.push({ file, line: i + 1, message: `acceptance id ${match[0]} is not defined in ${VERIFY}` })
        }
      }
    })
  }
  for (const [id, line] of defined) {
    if (!referenced.has(id)) problems.push({ file: VERIFY, line, message: `acceptance id ${id} is not referenced by any prompt` })
  }
  return problems
}
