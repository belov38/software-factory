// Usage: pnpm --dir tools/check validate <schema-name> <file.yaml|file.json>
// The file path is taken relative to the directory pnpm was started from.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'
import { validateDocument } from './schemas.js'

const [name, file] = process.argv.slice(2)
if (!name || !file) {
  console.error('usage: validate <schema-name> <file>')
  process.exit(2)
}
const root = resolve(import.meta.dirname, '../../..')
const path = resolve(process.env.INIT_CWD ?? process.cwd(), file)
const text = readFileSync(path, 'utf8')
const errors = validateDocument(root, name, path.endsWith('.json') ? JSON.parse(text) : parse(text))
if (errors.length) {
  for (const error of errors) console.error(`${file}: ${error}`)
  process.exit(1)
}
console.log(`${file} matches ${name}.schema.json`)
