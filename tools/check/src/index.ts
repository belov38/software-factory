// Usage: pnpm --dir tools/check check  (checks the repository two levels up)
import { resolve } from 'node:path'
import { checkIds } from './ids.js'
import { checkLinks } from './links.js'
import { checkSchemas } from './schemas.js'
import { checkStructure } from './structure.js'
import { checkVersion } from './version.js'

const root = resolve(process.argv[2] ?? '.')
const problems = [...checkLinks(root), ...checkIds(root), ...checkSchemas(root), ...checkStructure(root), ...checkVersion(root)]
for (const p of problems) console.error(`${p.file}:${p.line}: ${p.message}`)
if (problems.length) process.exit(1)
console.log('check: ok')
