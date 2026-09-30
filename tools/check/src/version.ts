import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Problem } from './types.js'

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/

/** VERSION is semver and CHANGELOG.md has an entry for it. */
export function checkVersion(root: string): Problem[] {
  if (!existsSync(join(root, 'VERSION'))) return [{ file: 'VERSION', line: 1, message: 'VERSION is missing' }]
  const version = readFileSync(join(root, 'VERSION'), 'utf8').trim()
  if (!SEMVER.test(version)) return [{ file: 'VERSION', line: 1, message: `VERSION is not semver: ${version}` }]
  const changelog = existsSync(join(root, 'CHANGELOG.md')) ? readFileSync(join(root, 'CHANGELOG.md'), 'utf8') : ''
  const heading = new RegExp(`^## ${version.replace(/[.]/g, '\\.')}(\\s|$)`, 'm')
  return heading.test(changelog) ? [] : [{ file: 'CHANGELOG.md', line: 1, message: `CHANGELOG.md has no "## ${version}" entry` }]
}
