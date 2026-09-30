import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// Generated code and tooling state are not checked.
const SKIP = new Set(['node_modules', '.git', '.factory', 'apps'])

/** Markdown files under root, relative to root with forward slashes, sorted. */
export function listMarkdown(root: string, dir = root): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...listMarkdown(root, path))
    else if (name.endsWith('.md')) out.push(relative(root, path).split('\\').join('/'))
  }
  return out.sort()
}
