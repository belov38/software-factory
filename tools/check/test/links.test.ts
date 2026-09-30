import { describe, expect, it } from 'vitest'
import { listMarkdown } from '../src/files.js'
import { checkLinks } from '../src/links.js'
import { tree } from './helpers.js'

describe('listMarkdown', () => {
  it('lists markdown files and skips generated and tooling directories', () => {
    const root = tree({ 'a.md': '', 'prompts/b.md': '', 'apps/x.md': '', 'node_modules/y.md': '', 'c.txt': '' })
    expect(listMarkdown(root)).toEqual(['a.md', 'prompts/b.md'])
  })
})

describe('checkLinks', () => {
  it('reports relative links to missing files, with the line', () => {
    const root = tree({
      'prompts/a.md': [
        '# A',
        'See [b](b.md), [c](c.md) and [section](b.md#steps).',
        'Also [web](https://example.com), [mail](mailto:x@y.z) and [here](#top).',
        '```',
        '[not a link](missing-in-code.md)',
        '```',
        '~~~~markdown',
        '```bash',
        'echo',
        '```',
        '[still inside the outer fence](missing-in-outer-fence.md)',
        '~~~~',
      ].join('\n'),
      'prompts/b.md': '# B',
    })
    expect(checkLinks(root)).toEqual([{ file: 'prompts/a.md', line: 2, message: 'broken link: c.md' }])
  })
})
