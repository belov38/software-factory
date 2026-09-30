import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { parse } from 'yaml'
import { listMarkdown } from './files.js'
import type { Problem } from './types.js'

// Examples inside list items are indented, so the fence may be too.
const OPEN = /^\s*(```|~~~)(yaml|json)\s+schema=([a-z][a-z0-9-]*)\s*$/

const schemaPath = (root: string, name: string) => join(root, 'prompts/spec', `${name}.schema.json`)

/** Error messages for doc against prompts/spec/<name>.schema.json; empty when it matches. */
export function validateDocument(root: string, name: string, doc: unknown): string[] {
  // allowUnionTypes: the state schema allows a phase output to be a string, number or boolean.
  const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true })
  const validate = ajv.compile(JSON.parse(readFileSync(schemaPath(root, name), 'utf8')))
  if (validate(doc)) return []
  return (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? 'is invalid'}`)
}

/** Fenced examples that declare a schema (```yaml schema=factory) must match it. */
export function checkSchemas(root: string): Problem[] {
  const problems: Problem[] = []
  for (const file of listMarkdown(root)) {
    const lines = readFileSync(join(root, file), 'utf8').split('\n')
    for (let i = 0; i < lines.length; i++) {
      const open = OPEN.exec(lines[i])
      if (!open) continue
      const [, fence, format, name] = open
      const end = lines.findIndex((l, j) => j > i && l.trim() === fence)
      const body = lines.slice(i + 1, end === -1 ? lines.length : end).join('\n')
      const line = i + 1
      i = end === -1 ? lines.length : end
      if (!existsSync(schemaPath(root, name))) {
        problems.push({ file, line, message: `no schema prompts/spec/${name}.schema.json` })
        continue
      }
      let doc: unknown
      try {
        doc = format === 'json' ? JSON.parse(body) : parse(body)
      } catch (err) {
        problems.push({ file, line, message: `example is not valid ${format}: ${err instanceof Error ? err.message : String(err)}` })
        continue
      }
      const errors = validateDocument(root, name, doc)
      if (errors.length) problems.push({ file, line, message: `example does not match ${name}.schema.json: ${errors.join('; ')}` })
    }
  }
  return problems
}
