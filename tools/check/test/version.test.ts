import { describe, expect, it } from 'vitest'
import { checkVersion } from '../src/version.js'
import { tree } from './helpers.js'

describe('checkVersion', () => {
  it('accepts a semver VERSION with a changelog entry', () => {
    expect(checkVersion(tree({ VERSION: '0.1.0-alpha.1\n', 'CHANGELOG.md': '# Changelog\n\n## 0.1.0-alpha.1 — 2026-10-01\n' }))).toEqual([])
  })

  it('reports a bad version and a missing entry', () => {
    expect(checkVersion(tree({ VERSION: 'one\n', 'CHANGELOG.md': '# Changelog\n' })).map((p) => p.message)).toEqual([
      'VERSION is not semver: one',
    ])
    expect(checkVersion(tree({ VERSION: '0.2.0\n', 'CHANGELOG.md': '# Changelog\n\n## 0.1.0\n' })).map((p) => p.message)).toEqual([
      'CHANGELOG.md has no "## 0.2.0" entry',
    ])
    expect(checkVersion(tree({})).map((p) => p.message)).toEqual(['VERSION is missing'])
  })
})
