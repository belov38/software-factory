import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { checkSchemas, validateDocument } from '../src/schemas.js'
import { tree } from './helpers.js'

const repo = fileURLToPath(new URL('../../..', import.meta.url))
const schema = (name: string) => readFileSync(`${repo}/prompts/spec/${name}.schema.json`, 'utf8')

const factory = `name: acme-factory
home: { forge: github, repo: acme/acme-factory }
runtime:
  server: { ssh: root@203.0.113.10 }
  ingress: { host: factory.acme.example, email: admin@acme.example }
  harness: { kind: claude, models: { work: opus, review: sonnet } }
  limits: { concurrentTurns: 2, turnDeadlineSeconds: 3600, maxAgentTurns: 100 }
projects:
  - name: shop
    forge: { kind: github, repo: acme/shop }
    tracker: { kind: github-issues, repo: acme/shop }
    channels: [ { kind: github-comments } ]
`

describe('factory schema', () => {
  it('accepts the example from the spec', () => {
    expect(validateDocument(repo, 'factory', parse(factory))).toEqual([])
  })

  it('accepts opencode with openrouter', () => {
    const doc = parse(factory)
    doc.runtime.harness = { kind: 'opencode', provider: 'openrouter', models: { work: 'a/b', review: 'c/d' } }
    expect(validateDocument(repo, 'factory', doc)).toEqual([])
  })

  it('rejects an IPv6 server, a missing project list and an unknown key', () => {
    const doc = parse(factory)
    doc.runtime.server.ssh = 'root@2001:db8::1'
    delete doc.projects
    doc.extra = true
    const errors = validateDocument(repo, 'factory', doc).join('\n')
    expect(errors).toContain('/runtime/server/ssh')
    expect(errors).toContain("must have required property 'projects'")
    expect(errors).toContain('must NOT have additional properties')
  })

  it('requires a host name in a domain and an email for the ingress', () => {
    const doc = parse(factory)
    doc.runtime.ingress = { host: '203.0.113.10' }
    const errors = validateDocument(repo, 'factory', doc).join('\n')
    expect(errors).toContain('/runtime/ingress/host must match pattern')
    expect(errors).toContain("/runtime/ingress must have required property 'email'")
  })
})

describe('state schema', () => {
  it('accepts recorded phases with scalar outputs and rejects a missing done', () => {
    const ok = { promptsVersion: '0.1.0-alpha.1', phases: { home: { done: '2026-10-01T10:00:00Z', repo: 'acme/f' } } }
    expect(validateDocument(repo, 'state', ok)).toEqual([])
    const bad = { promptsVersion: '0.1.0', phases: { server: { k3sVersion: 'v1' } } }
    expect(validateDocument(repo, 'state', bad).join('\n')).toContain("must have required property 'done'")
  })
})

describe('checkSchemas', () => {
  it('validates fenced examples that name a schema and reports the fence line', () => {
    const root = tree({
      'prompts/spec/factory.schema.json': schema('factory'),
      'prompts/interview.md': ['# Interview', '', '~~~yaml schema=factory', 'name: x', '~~~', '', '```yaml', 'not: checked', '```'].join('\n'),
    })
    const problems = checkSchemas(root)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({ file: 'prompts/interview.md', line: 3 })
    expect(problems[0].message).toContain('example does not match factory.schema.json')
  })

  it('validates an indented example inside a list item', () => {
    const root = tree({
      'prompts/spec/state.schema.json': schema('state'),
      'prompts/doctor.md': ['# Doctor', '', '1. Write the state:', '', '   ```json schema=state', '   { "phases": {} }', '   ```'].join('\n'),
    })
    expect(checkSchemas(root)).toMatchObject([{ file: 'prompts/doctor.md', line: 5 }])
  })

  it('reports a fence that names a schema that does not exist', () => {
    const root = tree({ 'prompts/a.md': '```json schema=nope\n{}\n```' })
    expect(checkSchemas(root)[0].message).toContain('no schema prompts/spec/nope.schema.json')
  })
})
