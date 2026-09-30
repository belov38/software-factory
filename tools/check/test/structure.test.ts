import { describe, expect, it } from 'vitest'
import { checkStructure } from '../src/structure.js'
import { tree } from './helpers.js'

const phase = '# X\n\n## Purpose\n\nx\n\n## Steps\n\n1. x\n\n## Done when\n\n- x\n'
const card = '# Y\n\nTested with: k3s v1 (2026-10-01)\n\n## Facts\n\n## Pitfalls\n\n## Smoke test\n'

describe('checkStructure', () => {
  it('accepts complete phase prompts and cards and ignores other files', () => {
    const root = tree({
      'prompts/doctor.md': phase,
      'prompts/operate/upgrade.md': phase,
      'prompts/integrations/k3s.md': card,
      'prompts/README.md': '# Conventions',
      'prompts/spec/core.md': '# Core',
    })
    expect(checkStructure(root)).toEqual([])
  })

  it('names each missing section and the missing Tested with line', () => {
    const root = tree({
      'prompts/install.md': '# Install\n\n## Purpose\n',
      'prompts/integrations/flux.md': '# Flux\n\n## Facts\n',
    })
    expect(checkStructure(root).map((p) => `${p.file}: ${p.message}`)).toEqual([
      'prompts/install.md: missing section "## Steps"',
      'prompts/install.md: missing section "## Done when"',
      'prompts/integrations/flux.md: missing section "## Pitfalls"',
      'prompts/integrations/flux.md: missing section "## Smoke test"',
      'prompts/integrations/flux.md: missing "Tested with:" line',
    ])
  })
})
