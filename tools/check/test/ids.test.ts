import { describe, expect, it } from 'vitest'
import { checkIds } from '../src/ids.js'
import { tree } from './helpers.js'

const verify = ['# Verify', '', '| Id | Check |', '|---|---|', '| INSTALL-1 | Flux is Ready. |', '| INSTALL-2 | Health answers. |'].join('\n')

describe('checkIds', () => {
  it('reports undefined references and unreferenced definitions', () => {
    const root = tree({
      'prompts/verify.md': verify,
      'prompts/install.md': 'Checks INSTALL-1.\nAlso CORE-9.',
    })
    expect(checkIds(root)).toEqual([
      { file: 'prompts/install.md', line: 2, message: 'acceptance id CORE-9 is not defined in prompts/verify.md' },
      { file: 'prompts/verify.md', line: 6, message: 'acceptance id INSTALL-2 is not referenced by any prompt' },
    ])
  })

  it('accepts a consistent set and ignores ids outside prompts/', () => {
    const root = tree({
      'prompts/verify.md': verify,
      'prompts/install.md': 'INSTALL-1 and INSTALL-2.',
      'docs/design.md': 'REVIEW-7 is only discussed here.',
    })
    expect(checkIds(root)).toEqual([])
  })
})
