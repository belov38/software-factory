# Software Factory, Plan 1: foundation and installer to a running cluster — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person runs their coding agent in a clone of this repository and ends with a private factory repository, `factory.yaml`, encrypted secrets, a GitHub App, k3s on their Hetzner server, Flux syncing from the private repository and a valid certificate for a host in the user's domain — proven by the acceptance checks INSTALL-1 and INSTALL-2.

**Architecture:** The upstream repository holds prompts plus a small TypeScript checker (`tools/check`) that keeps them consistent: relative links, acceptance ids, JSON-schema examples, prompt structure, version. Installer prompts are phase files with fixed sections; integration cards hold tested facts about each external system. The prompts themselves are tested by running the installer end to end on a real server.

**Tech Stack:** Markdown prompts; `tools/check`: TypeScript on Node 22, pnpm, vitest, tsx, ajv, yaml. Target: Hetzner (Ubuntu 24.04), k3s, Flux, SOPS with age, cert-manager, Traefik, Let's Encrypt, GitHub App manifest flow.

**Spec:** `docs/superpowers/specs/2026-10-01-software-factory-design.md`

**Amended 2026-10-01, after Task 5:** a host in the user's own domain replaces `<ip>.sslip.io` (spec decision 9 and "Check results (Plan 1, 2026-10-01)"), and `factory.yaml` gains `runtime.ingress.email` for the Let's Encrypt account. Task 6 is reduced to check 3, which needs no server; check 6 moves to Plan 2; checks 4 and 5 are covered by the end-to-end run in Task 13. Tasks 1-5 are unchanged below and record what was done.

**Amended 2026-10-01, after Task 12:** v1 supports Claude Code only, as the agent that runs the installer and as the factory's runtime agent (spec decision 5); the model access is a subscription token from `claude setup-token` or an Anthropic API key. The README becomes a short guide for the user. After the final review, Task 14 publishes the repository first, and in Task 13 the user follows the README from the published repository in a directory of their choice; you watch the transcript and push fixes.

**Plans in this series:**
1. This plan: foundation, pre-writing check 3, installer phases doctor → gitops, INSTALL-1 and INSTALL-2 against a placeholder health endpoint; the end-to-end run covers checks 4 and 5.
2. The factory: spec prompts (architecture, core, capabilities, ports), runtime integration cards, checks 1, 2, 6, 7 and 8, phases build and deploy, the remaining acceptance checks.
3. Operation: `operate/*` prompts, upgrades through `CHANGELOG.md` migrations, release 0.1.0.

## Global Constraints

- Tooling: Node 22 or newer, pnpm, TypeScript (spec decision 6).
- Upstream-owned paths (after Task 4): `AGENTS.md`, `CLAUDE.md`, `README.md`, `LICENSE`, `CONTRIBUTING.md`, `.gitignore`, `VERSION`, `CHANGELOG.md`, `docs/`, `prompts/`, `tools/`, `.github/workflows/upstream-ci.yml`.
- Secrets rule, verbatim from the spec: "the harness works with paths to secret files, never with their values. It does not print env files or put values on command lines."
- The Kubernetes API is reached only through an SSH tunnel; the server's firewall allows 22, 80 and 443 only.
- The cluster changes only through commits to `main` that Flux applies; direct `kubectl apply` is allowed only while bootstrapping.
- Ingress host: a name in the user's domain with an A record to the server's public IPv4 (v1 needs a public IPv4: GitHub is not reachable over IPv6); the user's email registers the Let's Encrypt account.
- Everything written into the repository is in English.
- Commit messages are plain sentences without a type prefix and without any session trailer or link.
- Commands run from the repository root `~/prj-other/software-factory` unless a step says otherwise.

## Review Focus

1. **Re-running after an interruption.** A person stops the installer mid-phase and starts it again: every phase must see its recorded `done`, skip it, and never create a second repository, App or cluster, or force-push. Test: Task 13, steps 4 and 5.
2. **A secret reaching the agent's transcript.** The agent prints the env file or passes a value on a command line. Test: Task 13, step 2 (canary value) and step 7 (grep the transcript).
3. **A server that is not fresh.** k3s, another web server on 80/443 or an unknown firewall already exists. Expected: the server phase stops and asks instead of overwriting. Test: Task 11, step 1 (the preflight in the phase) and Task 13, step 6.
4. **An organisation instead of a personal account.** The App creation URL and `flux bootstrap --personal` differ. Test: Task 10 covers both URLs in the helper; Task 13, step 8 repeats the github-app phase with an organisation when the user has one.
5. **A host that does not point at the server.** The A record is missing, still propagating or points elsewhere. Expected: the interview waits until `dig +short <host>` prints the server's IPv4 and writes `factory.yaml` only then, so no certificate is requested for a wrong address. Test: Task 13, step 3 (give the host before creating the record).

---

### Task 1: Checker scaffold and link check

**Files:**
- Create: `tools/check/package.json`, `tools/check/tsconfig.json`, `tools/check/src/types.ts`, `tools/check/src/files.ts`, `tools/check/src/links.ts`, `tools/check/test/helpers.ts`, `tools/check/test/links.test.ts`, `.gitignore`

**Interfaces:**
- Produces: `interface Problem { file: string; line: number; message: string }` (`src/types.ts`); `listMarkdown(root: string): string[]` — markdown paths relative to `root`, forward slashes, sorted, skipping `node_modules`, `.git`, `.factory`, `apps` (`src/files.ts`); `checkLinks(root: string): Problem[]` (`src/links.ts`); `tree(files: Record<string, string>): string` — writes files into a temp dir and returns its path (`test/helpers.ts`).

- [ ] **Step 1: Create the package**

```bash
mkdir -p ~/prj-other/software-factory/tools/check/src ~/prj-other/software-factory/tools/check/test
cd ~/prj-other/software-factory/tools/check
cat > package.json <<'EOF'
{
  "name": "software-factory-check",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "check": "tsx src/index.ts ../..",
    "validate": "tsx src/validate.ts"
  }
}
EOF
pnpm add ajv yaml
pnpm add -D typescript tsx vitest @types/node
npm pkg set packageManager="pnpm@$(pnpm --version)"
cat > tsconfig.json <<'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "types": ["node"],
    "skipLibCheck": true
  },
  "include": ["src", "test"]
}
EOF
printf 'node_modules/\n' > ~/prj-other/software-factory/.gitignore
```

- [ ] **Step 2: Write the shared types, file listing and test helper**

`tools/check/src/types.ts`:

```ts
/** One finding of a check, pointing at a line of a file relative to the repository root. */
export interface Problem {
  file: string
  line: number
  message: string
}
```

`tools/check/src/files.ts`:

```ts
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
```

`tools/check/test/helpers.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** Writes the given files into a fresh temp directory and returns its path. */
export function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'sf-check-'))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}
```

- [ ] **Step 3: Write the failing test**

`tools/check/test/links.test.ts`:

```ts
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
```

- [ ] **Step 4: Run it to see it fail**

Run: `pnpm --dir tools/check test`
Expected: FAIL — `Cannot find module '../src/links.js'`.

- [ ] **Step 5: Implement the link check**

`tools/check/src/links.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { listMarkdown } from './files.js'
import type { Problem } from './types.js'

const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g
const FENCE = /^\s*(`{3,}|~{3,})/

/** Relative links in markdown files that point to files that do not exist; code blocks are skipped. */
export function checkLinks(root: string): Problem[] {
  const problems: Problem[] = []
  for (const file of listMarkdown(root)) {
    // A block closes only with the same fence character, at least as long (CommonMark), so a
    // ``` block nested inside a ~~~~ block does not end the outer one.
    let fence: string | null = null
    readFileSync(join(root, file), 'utf8').split('\n').forEach((text, i) => {
      const marker = FENCE.exec(text)?.[1]
      if (marker) {
        if (!fence) fence = marker
        else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null
        return
      }
      if (fence) return
      for (const match of text.matchAll(LINK)) {
        const target = match[1]
        if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue
        if (!existsSync(join(root, dirname(file), target.split('#')[0]))) {
          problems.push({ file, line: i + 1, message: `broken link: ${target}` })
        }
      }
    })
  }
  return problems
}
```

- [ ] **Step 6: Run the tests and the typecheck**

Run: `pnpm --dir tools/check test && pnpm --dir tools/check typecheck`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
cd ~/prj-other/software-factory
git add .gitignore tools/check
git commit -m "Add the prompt checker with a check for broken relative links"
```

---

### Task 2: Acceptance id check

**Files:**
- Create: `tools/check/src/ids.ts`, `tools/check/test/ids.test.ts`

**Interfaces:**
- Consumes: `listMarkdown`, `Problem` (Task 1).
- Produces: `checkIds(root: string): Problem[]` — ids are defined only as the first cell of a table row in `prompts/verify.md` (`| CORE-4 | …`) and referenced anywhere else under `prompts/`. Reports references to undefined ids and defined ids nobody references.

- [ ] **Step 1: Write the failing test**

`tools/check/test/ids.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --dir tools/check exec vitest run ids`
Expected: FAIL — `Cannot find module '../src/ids.js'`.

- [ ] **Step 3: Implement**

`tools/check/src/ids.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { listMarkdown } from './files.js'
import type { Problem } from './types.js'

const VERIFY = 'prompts/verify.md'
const ID = /\b(?:INSTALL|CORE|REVIEW|FEEDBACK|ISOLATION|HARNESS)-\d+\b/g
const DEFINITION = /^\|\s*([A-Z]+-\d+)\s*\|/

/** Acceptance ids: defined in the table of prompts/verify.md, referenced by the other prompts. */
export function checkIds(root: string): Problem[] {
  const files = listMarkdown(root).filter((f) => f.startsWith('prompts/'))
  const defined = new Map<string, number>()
  if (files.includes(VERIFY)) {
    readFileSync(join(root, VERIFY), 'utf8').split('\n').forEach((text, i) => {
      const match = DEFINITION.exec(text)
      if (match) defined.set(match[1], i + 1)
    })
  }
  const problems: Problem[] = []
  const referenced = new Set<string>()
  for (const file of files.filter((f) => f !== VERIFY)) {
    readFileSync(join(root, file), 'utf8').split('\n').forEach((text, i) => {
      for (const match of text.matchAll(ID)) {
        referenced.add(match[0])
        if (!defined.has(match[0])) {
          problems.push({ file, line: i + 1, message: `acceptance id ${match[0]} is not defined in ${VERIFY}` })
        }
      }
    })
  }
  for (const [id, line] of defined) {
    if (!referenced.has(id)) problems.push({ file: VERIFY, line, message: `acceptance id ${id} is not referenced by any prompt` })
  }
  return problems
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --dir tools/check test && pnpm --dir tools/check typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/check/src/ids.ts tools/check/test/ids.test.ts
git commit -m "Check that acceptance ids are defined in verify.md and referenced by a prompt"
```

---

### Task 3: Schemas for factory.yaml and the state file, their check and a validate command

**Files:**
- Create: `prompts/spec/factory.schema.json`, `prompts/spec/state.schema.json`, `tools/check/src/schemas.ts`, `tools/check/src/validate.ts`, `tools/check/test/schemas.test.ts`

**Interfaces:**
- Consumes: `listMarkdown`, `Problem` (Task 1).
- Produces: `validateDocument(root: string, name: string, doc: unknown): string[]` — error messages, empty when valid, schema at `prompts/spec/<name>.schema.json`; `checkSchemas(root: string): Problem[]` — validates every fenced block opened with `yaml schema=<name>` or `json schema=<name>` (backticks or tildes); CLI `pnpm --dir tools/check validate <name> <file>` — the file path is resolved against the directory pnpm was started from (`INIT_CWD`), exit code 1 on errors.

- [ ] **Step 1: Write the schemas**

`prompts/spec/factory.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "factory.schema.json",
  "title": "factory.yaml",
  "type": "object",
  "required": ["name", "home", "runtime", "projects"],
  "additionalProperties": false,
  "properties": {
    "name": { "type": "string", "pattern": "^[a-z][a-z0-9-]{1,38}[a-z0-9]$" },
    "home": {
      "type": "object",
      "required": ["forge", "repo"],
      "additionalProperties": false,
      "properties": {
        "forge": { "const": "github" },
        "repo": { "type": "string", "pattern": "^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$" }
      }
    },
    "runtime": {
      "type": "object",
      "required": ["server", "ingress", "harness", "limits"],
      "additionalProperties": false,
      "properties": {
        "server": {
          "type": "object",
          "required": ["ssh"],
          "additionalProperties": false,
          "properties": { "ssh": { "type": "string", "pattern": "^[a-z_][a-z0-9_-]*@(\\d{1,3}\\.){3}\\d{1,3}$" } }
        },
        "ingress": {
          "type": "object",
          "required": ["host"],
          "additionalProperties": false,
          "properties": { "host": { "type": "string", "pattern": "^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$" } }
        },
        "harness": {
          "oneOf": [
            {
              "type": "object",
              "required": ["kind", "models"],
              "additionalProperties": false,
              "properties": { "kind": { "const": "claude" }, "models": { "$ref": "#/$defs/models" } }
            },
            {
              "type": "object",
              "required": ["kind", "provider", "models"],
              "additionalProperties": false,
              "properties": {
                "kind": { "const": "opencode" },
                "provider": { "const": "openrouter" },
                "models": { "$ref": "#/$defs/models" }
              }
            }
          ]
        },
        "limits": {
          "type": "object",
          "required": ["concurrentTurns", "turnDeadlineSeconds", "maxAgentTurns"],
          "additionalProperties": false,
          "properties": {
            "concurrentTurns": { "type": "integer", "minimum": 1, "maximum": 20 },
            "turnDeadlineSeconds": { "type": "integer", "minimum": 300, "maximum": 14400 },
            "maxAgentTurns": { "type": "integer", "minimum": 10, "maximum": 500 }
          }
        }
      }
    },
    "projects": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/project" } }
  },
  "$defs": {
    "models": {
      "type": "object",
      "required": ["work", "review"],
      "additionalProperties": false,
      "properties": { "work": { "type": "string", "minLength": 1 }, "review": { "type": "string", "minLength": 1 } }
    },
    "binding": {
      "type": "object",
      "required": ["kind"],
      "properties": { "kind": { "type": "string", "pattern": "^[a-z][a-z0-9-]*$" } }
    },
    "project": {
      "type": "object",
      "required": ["name", "forge", "tracker", "channels"],
      "additionalProperties": false,
      "properties": {
        "name": { "type": "string", "pattern": "^[a-z][a-z0-9-]*$" },
        "forge": { "$ref": "#/$defs/binding" },
        "tracker": { "$ref": "#/$defs/binding" },
        "channels": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/binding" } }
      }
    }
  }
}
```

`prompts/spec/state.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "state.schema.json",
  "title": ".factory/state.json",
  "type": "object",
  "required": ["promptsVersion", "phases"],
  "additionalProperties": false,
  "properties": {
    "promptsVersion": { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.-]+)?$" },
    "phases": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "doctor": { "$ref": "#/$defs/phase" },
        "home": { "$ref": "#/$defs/phase" },
        "interview": { "$ref": "#/$defs/phase" },
        "secrets": { "$ref": "#/$defs/phase" },
        "github-app": { "$ref": "#/$defs/phase" },
        "server": { "$ref": "#/$defs/phase" },
        "gitops": { "$ref": "#/$defs/phase" },
        "build": { "$ref": "#/$defs/phase" },
        "deploy": { "$ref": "#/$defs/phase" },
        "verify": { "$ref": "#/$defs/phase" },
        "handoff": { "$ref": "#/$defs/phase" }
      }
    }
  },
  "$defs": {
    "phase": {
      "type": "object",
      "required": ["done"],
      "properties": { "done": { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$" } },
      "additionalProperties": { "type": ["string", "number", "boolean"] }
    }
  }
}
```

- [ ] **Step 2: Write the failing test**

`tools/check/test/schemas.test.ts`:

```ts
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
  ingress: { host: 203.0.113.10.sslip.io }
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

  it('reports a fence that names a schema that does not exist', () => {
    const root = tree({ 'prompts/a.md': '```json schema=nope\n{}\n```' })
    expect(checkSchemas(root)[0].message).toContain('no schema prompts/spec/nope.schema.json')
  })
})
```

- [ ] **Step 3: Run it to see it fail**

Run: `pnpm --dir tools/check exec vitest run schemas`
Expected: FAIL — `Cannot find module '../src/schemas.js'`.

- [ ] **Step 4: Implement the schema check and the validate command**

`tools/check/src/schemas.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { parse } from 'yaml'
import { listMarkdown } from './files.js'
import type { Problem } from './types.js'

const OPEN = /^(```|~~~)(yaml|json)\s+schema=([a-z][a-z0-9-]*)\s*$/

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
```

`tools/check/src/validate.ts`:

```ts
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
```

- [ ] **Step 5: Run the tests and try the command**

Run: `pnpm --dir tools/check test && pnpm --dir tools/check typecheck`
Expected: PASS.

Run: `printf '{"promptsVersion":"0.1.0","phases":{}}' > /tmp/sf-state.json && pnpm --dir tools/check validate state /tmp/sf-state.json`
Expected: `/tmp/sf-state.json matches state.schema.json`.

- [ ] **Step 6: Commit**

```bash
git add prompts/spec tools/check/src/schemas.ts tools/check/src/validate.ts tools/check/test/schemas.test.ts
git commit -m "Add the schemas of factory.yaml and the state file, check schema-tagged examples and add a validate command"
```

---

### Task 4: Structure and version checks, the check command, upstream CI and the ownership rule

**Files:**
- Create: `tools/check/src/structure.ts`, `tools/check/src/version.ts`, `tools/check/src/index.ts`, `tools/check/test/structure.test.ts`, `tools/check/test/version.test.ts`, `VERSION`, `CHANGELOG.md`, `.github/workflows/upstream-ci.yml`
- Modify: `docs/superpowers/specs/2026-10-01-software-factory-design.md` (ownership list, layout, `.sops.yaml` location)

**Interfaces:**
- Consumes: `listMarkdown`, `Problem`, `checkLinks`, `checkIds`, `checkSchemas`.
- Produces: `checkStructure(root: string): Problem[]` — phase prompts (`prompts/*.md` except `prompts/README.md`, and `prompts/operate/*.md`) need `## Purpose`, `## Steps`, `## Done when`; cards (`prompts/integrations/*.md`) need `## Facts`, `## Pitfalls`, `## Smoke test` and a `Tested with: …` line. `checkVersion(root: string): Problem[]` — `VERSION` is semver and `CHANGELOG.md` has a `## <version>` heading. `pnpm --dir tools/check check` runs every check on the repository and exits 1 on problems.

- [ ] **Step 1: Write the failing tests**

`tools/check/test/structure.test.ts`:

```ts
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
```

`tools/check/test/version.test.ts`:

```ts
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
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --dir tools/check exec vitest run structure version`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement both checks and the command**

`tools/check/src/structure.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { listMarkdown } from './files.js'
import type { Problem } from './types.js'

const PHASE = ['## Purpose', '## Steps', '## Done when']
const CARD = ['## Facts', '## Pitfalls', '## Smoke test']

function kind(file: string): 'phase' | 'card' | null {
  if (/^prompts\/integrations\/[^/]+\.md$/.test(file)) return 'card'
  if (/^prompts\/operate\/[^/]+\.md$/.test(file)) return 'phase'
  if (/^prompts\/[^/]+\.md$/.test(file) && file !== 'prompts/README.md') return 'phase'
  return null
}

/** Phase prompts and integration cards must have their fixed sections (see prompts/README.md). */
export function checkStructure(root: string): Problem[] {
  const problems: Problem[] = []
  for (const file of listMarkdown(root)) {
    const k = kind(file)
    if (!k) continue
    const text = readFileSync(join(root, file), 'utf8')
    const lines = text.split('\n').map((l) => l.trim())
    for (const heading of k === 'card' ? CARD : PHASE) {
      if (!lines.includes(heading)) problems.push({ file, line: 1, message: `missing section "${heading}"` })
    }
    if (k === 'card' && !/^Tested with: .+$/m.test(text)) problems.push({ file, line: 1, message: 'missing "Tested with:" line' })
  }
  return problems
}
```

`tools/check/src/version.ts`:

```ts
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
```

`tools/check/src/index.ts`:

```ts
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
```

- [ ] **Step 4: Add VERSION, CHANGELOG and the upstream CI**

```bash
cd ~/prj-other/software-factory
printf '0.1.0-alpha.1\n' > VERSION
cat > CHANGELOG.md <<'EOF'
# Changelog

Each version lists what changed in the prompts. From 0.1.0 on, a version that
changes the specification has a Migration section: a prompt that
`prompts/operate/upgrade.md` applies to an installation's code.

## 0.1.0-alpha.1 — unreleased

- Installer phases doctor, home, interview, secrets, github-app, server and
  gitops, and the install checks INSTALL-1 and INSTALL-2 against a placeholder
  health endpoint. The factory itself comes in a later version.
EOF
mkdir -p .github/workflows
cat > .github/workflows/upstream-ci.yml <<'EOF'
name: upstream-ci
on: [push, pull_request]
jobs:
  check:
    # Private factory copies carry this file too; it runs only in the public repository.
    if: github.repository == 'belov38/software-factory'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          package_json_file: tools/check/package.json
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: tools/check/pnpm-lock.yaml
      - run: pnpm --dir tools/check install --frozen-lockfile
      - run: pnpm --dir tools/check typecheck
      - run: pnpm --dir tools/check test
      - run: pnpm --dir tools/check check
EOF
```

- [ ] **Step 5: Update the spec's ownership rule and layout**

In `docs/superpowers/specs/2026-10-01-software-factory-design.md`:

- In "Rules", replace the path-ownership sentence with: "Path ownership: upstream owns `AGENTS.md`, `CLAUDE.md`, `README.md`, `LICENSE`, `CONTRIBUTING.md`, `.gitignore`, `VERSION`, `CHANGELOG.md`, `docs/`, `prompts/`, `tools/` and `.github/workflows/upstream-ci.yml`. Everything else belongs to the installation. `git merge upstream/main` therefore never touches generated code."
- In the upstream layout block, add the lines `  CONTRIBUTING.md      how to change the prompts themselves` and `  tools/check/         checker of the prompts: links, acceptance ids, schema examples, structure, version`.
- In the private-copy layout block, replace `infra/               cert-manager, ClusterIssuer, namespaces, .sops.yaml` with `infra/               cert-manager, ClusterIssuer, namespaces` and add `  .sops.yaml           sops creation rule for secrets/, with the installation's age recipient`.

- [ ] **Step 6: Run the tests and the check on the repository**

Run: `pnpm --dir tools/check test && pnpm --dir tools/check typecheck && pnpm --dir tools/check check`
Expected: tests PASS; `check: ok` (the spec's links are valid, no prompts exist yet besides schemas).

- [ ] **Step 7: Commit**

```bash
git add tools/check VERSION CHANGELOG.md .github/workflows/upstream-ci.yml docs/superpowers/specs/2026-10-01-software-factory-design.md
git commit -m "Check the structure of prompts and cards and the version, run all checks in upstream CI and name the upstream-owned paths"
```

---

### Task 5: Entry points and conventions

**Files:**
- Create: `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `prompts/README.md`
- Modify: `README.md`

**Interfaces:**
- Produces: the rules every later prompt relies on: where to start, the secrets rule, state recording, the GitOps rule, upstream-owned paths, human steps.

- [ ] **Step 1: Write `AGENTS.md`**

~~~~markdown
# Software Factory

This repository installs and operates a software factory: a service that takes
issues, runs coding agents on them in isolated runners, has each change
reviewed by an independent agent and hands pull requests to a human. The
prompts under `prompts/` tell you, the coding agent reading this, how to do it.

## Where to start

- The user is developing Software Factory itself (changing prompts, docs or
  tools): do not start an installation; follow `CONTRIBUTING.md`.
- `.factory/state.json` does not exist: this is a fresh clone. Follow
  `prompts/doctor.md`, then `prompts/install.md`.
- `.factory/state.json` exists and a phase in `prompts/install.md` has no
  `done`: continue `prompts/install.md` at the first such phase.
- Every phase is done: do what the user asks, using `prompts/operate/` where
  it applies.

## Rules

1. Follow each prompt's Steps in order and check every item of its Done when
   before moving on.
2. Secrets: work with paths to secret files, never with their values. Do not
   print env files, do not put secret values on command lines, and do not
   repeat them in this conversation. When the user starts to paste a secret
   into the chat, stop them and point to the env file instead.
3. After every phase, record it in `.factory/state.json` (format:
   `prompts/spec/state.schema.json`), commit and push. Record no secret values
   there.
4. Change the cluster only by committing to `main` and letting Flux apply it.
   Direct `kubectl apply` or `kubectl create` is allowed only in steps that
   say so.
5. In an installation, do not edit the upstream-owned paths: `AGENTS.md`,
   `CLAUDE.md`, `README.md`, `LICENSE`, `CONTRIBUTING.md`, `.gitignore`,
   `VERSION`, `CHANGELOG.md`, `docs/`, `prompts/`, `tools/`,
   `.github/workflows/upstream-ci.yml`. They change only by merging
   `upstream/main`.
6. When a step needs the human (a click, a secret, a decision), say exactly
   what to do and wait for their answer.
7. Never force-push and never push to `upstream`.
8. Write everything you create (code, comments, commit messages, documents)
   in English. Commit messages are plain sentences.
~~~~

- [ ] **Step 2: Write `CLAUDE.md`, `CONTRIBUTING.md` and `prompts/README.md`**

`CLAUDE.md` (Claude Code reads this file; the import makes it read `AGENTS.md`):

```markdown
@AGENTS.md
```

`CONTRIBUTING.md`:

~~~~markdown
# Contributing

Software Factory is a set of prompts. A change to the prompts is a change to
every factory built from them, so:

- Follow the conventions in `prompts/README.md`.
- Run `pnpm --dir tools/check install` once, then before every commit:
  `pnpm --dir tools/check test && pnpm --dir tools/check check`.
- A change to what the factory does updates `docs/superpowers/specs/` first,
  then the prompts, then `VERSION` and `CHANGELOG.md`. From 0.1.0 on, a
  specification change needs a Migration section in `CHANGELOG.md`.
- Facts in integration cards are verified on a real system; the card's
  `Tested with:` line says on which versions and when.
~~~~

`prompts/README.md`:

~~~~markdown
# Prompt conventions

## Phase prompts

`prompts/*.md` (except this file) and `prompts/operate/*.md` have these
sections, in this order:

- `## Purpose`: one paragraph on what the prompt achieves.
- `## Inputs` (optional): the files and state it reads.
- `## Steps`: numbered actions, each with the exact command where there is
  one. Placeholders in commands are written `<like-this>` and each one says
  where its value comes from.
- `## Done when`: checks that must all pass; each can be run or observed.
- `## Never` (optional): what must not happen.

## Integration cards

`prompts/integrations/*.md` describe one external system each:

- a `Tested with:` line: versions and the date they were verified;
- `## Facts`: verified behaviour the prompts rely on;
- `## Pitfalls`: what goes wrong and how to avoid it;
- `## Smoke test`: commands that show the integration works.

## Acceptance ids

Ids such as `INSTALL-1` are defined only in the table of `verify.md` and
referenced by the prompts whose work they check.

## Schema examples

An example that must match a schema is fenced with `yaml schema=<name>` or
`json schema=<name>`; `tools/check` validates it against
`prompts/spec/<name>.schema.json`.
~~~~

- [ ] **Step 3: Point the README at the entry point**

Replace the body of `README.md` below the first paragraph with:

~~~~markdown
## Install a factory

You need a Hetzner server with your SSH key (Ubuntu 24.04 or Debian 12,
public IPv4), a GitHub account and a key for Claude or OpenRouter. Then:

```bash
git clone https://github.com/belov38/software-factory.git
cd software-factory
claude        # or: opencode
```

and ask the agent to install the factory. It follows `AGENTS.md`.

Status: early alpha. The installer brings up the cluster and GitOps; the
factory itself arrives in a later version. Design:
[`docs/superpowers/specs/2026-10-01-software-factory-design.md`](docs/superpowers/specs/2026-10-01-software-factory-design.md).

Licensed under the [Apache License 2.0](LICENSE).
~~~~

- [ ] **Step 4: Run the check**

Run: `pnpm --dir tools/check check`
Expected: `check: ok`.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md CLAUDE.md CONTRIBUTING.md prompts/README.md README.md
git commit -m "Add the entry point for coding agents, the prompt conventions and the contributing guide"
```

---

### Task 6: Pre-writing check 3: the GitHub App manifest flow

Spec section "Checks before writing prompts", item 3; its result decides the github-app phase in Task 10. Check 4 is shown by INSTALL-2 and check 5 is measured in the end-to-end run (Task 13); check 6 moves to Plan 2. The findings about wildcard DNS hostnames and conditional requests are already in the spec's "Check results (Plan 1, 2026-10-01)".

**Files:**
- Modify: `docs/superpowers/specs/2026-10-01-software-factory-design.md` (section "Check results (Plan 1, 2026-10-01)")
- Create: scratch files only, outside the repository.

**Interfaces:**
- Produces: whether a `127.0.0.1` redirect works in the manifest flow, what the conversion returns, and the `gh` version for the GitHub App card.

- [ ] **Step 1: Run the manifest flow with a `127.0.0.1` redirect**

Write `/tmp/sf-manifest-check.mjs` (or the same file in the session's scratch directory):

```js
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'

const state = randomBytes(8).toString('hex')
const manifest = {
  name: `sf-check-${state}`,
  url: 'https://github.com',
  hook_attributes: { url: 'https://example.com/webhook', active: false },
  redirect_url: 'http://127.0.0.1:8765/callback',
  public: false,
  default_permissions: { contents: 'read', metadata: 'read' },
  default_events: [],
}
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:8765')
  if (url.pathname === '/') {
    res.setHeader('content-type', 'text/html')
    res.end(`<form id="f" method="post" action="https://github.com/settings/apps/new?state=${state}">
<input type="hidden" name="manifest" value='${JSON.stringify(manifest)}'></form><script>f.submit()</script>`)
    return
  }
  if (url.pathname === '/callback' && url.searchParams.get('state') === state) {
    const r = await fetch(`https://api.github.com/app-manifests/${url.searchParams.get('code')}/conversions`, {
      method: 'POST', headers: { accept: 'application/vnd.github+json' },
    })
    const app = await r.json()
    console.log(JSON.stringify({ status: r.status, id: app.id, slug: app.slug, hasPem: Boolean(app.pem), hasWebhookSecret: 'webhook_secret' in app }))
    res.end(`Done: ${app.slug}. Delete it at https://github.com/settings/apps/${app.slug}/advanced`)
    process.exit(0)
  }
  res.statusCode = 404
  res.end()
}).listen(8765, '127.0.0.1', () => console.log('open http://127.0.0.1:8765/'))
```


Run: `node /tmp/sf-manifest-check.mjs`, ask the user to open the printed URL and click "Create GitHub App".
Expected: `{"status":201,"id":…,"slug":"sf-check-…","hasPem":true,"hasWebhookSecret":true}`. Then ask the user to delete the test App from the link in the browser.

- [ ] **Step 2: Record the result**

Add a paragraph for check 3 to the spec's "Check results (Plan 1, 2026-10-01)": what ran, the observed result, the `gh` version, and any change to the design. If the redirect to `127.0.0.1` is refused, stop and discuss the change with the user before Task 7.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-10-01-software-factory-design.md
git commit -m "Record the result of the manifest flow check"
```

---

### Task 7: Integration cards for the server and the cluster

**Files:**
- Create: `prompts/integrations/hetzner-ssh.md`, `prompts/integrations/k3s.md`, `prompts/integrations/sops-age.md`, `prompts/integrations/flux.md`, `prompts/integrations/ingress.md`

**Interfaces:**
- Consumes: the current stable versions of k3s, Flux, cert-manager, sops and age (sops 3.13.3, age 1.3.2 and the Flux CLI 2.9.5 are installed locally); the spec's Check results. Task 13 confirms the versions on a real server.
- Produces: facts the phase prompts cite by file name: the pinned k3s version (`k3s.md`), the recommended server size (`hetzner-ssh.md`), the ufw rules, the Flux bootstrap command, the sops encrypt command, the ClusterIssuer and placeholder manifests (`ingress.md`).

- [ ] **Step 1: Write the cards**

Each card follows `prompts/README.md`. A value marked "(current)" is the current stable release on the day the card is written: k3s from `https://update.k3s.io/v1-release/channels` (channel `stable`), Flux, cert-manager, sops and age from their latest GitHub releases. Until Task 13 passes, a `Tested with:` line names these versions and adds "pending the end-to-end run"; Task 13 replaces it with the versions and date of the passing run.

`prompts/integrations/hetzner-ssh.md` must contain:
- `Tested with:` Ubuntu 24.04, pending the end-to-end run.
- Facts: the recommended server type: CX22 (2 vCPU, 4 GB) or larger until Task 13 measures k3s, Flux and cert-manager; root login with the SSH key given at creation; the metadata service at `http://169.254.169.254/hetzner/v1/metadata`, reachable from the server and, without a policy, from pods; a public IPv4 is included unless the server was created IPv6-only; an attached Hetzner Cloud Firewall, if any, must allow 22, 80 and 443.
- Pitfalls: IPv6-only servers are refused in v1 (GitHub is not reachable over IPv6); an existing web server on 80/443 blocks Traefik; a rebuilt server gets a new host key (`ssh-keygen -R <ip>`).
- Smoke test: `ssh -o BatchMode=yes -o ConnectTimeout=10 <user>@<ip> 'cat /etc/os-release; nproc; free -m; df -h /'`.

`prompts/integrations/k3s.md` must contain:
- `Tested with:` the k3s version (current) and the date.
- Facts: the install command `curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION=<version> sh -s - server --write-kubeconfig-mode 600`; bundled Traefik with ingress class `traefik`; ServiceLB publishes 80 and 443 on the node; kubeconfig at `/etc/rancher/k3s/k3s.yaml` pointing at `https://127.0.0.1:6443`; pod CIDR `10.42.0.0/16`, service CIDR `10.43.0.0/16`; `local-path` is the default storage class; uninstall with `/usr/local/bin/k3s-uninstall.sh`.
- The ufw commands:

```bash
apt-get update && apt-get install -y ufw
ufw default deny incoming && ufw default allow outgoing
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
ufw allow from 10.42.0.0/16 && ufw allow from 10.43.0.0/16
ufw --force enable
```

- Pitfalls: without the two `allow from` rules pods cannot reach each other or DNS; never open 6443; a local port 6443 may already be taken by another cluster, so the tunnel uses local port 16443.
- Smoke test: `KUBECONFIG=<kubeconfig> kubectl get nodes` shows the node Ready through the tunnel; `nc -z -w5 <ip> 6443` from outside fails.

`prompts/integrations/sops-age.md` must contain:
- `Tested with:` sops and age versions (current) and the date; run the card's smoke test locally before committing it.
- Facts: key creation `age-keygen -o <key-file>`; the recipient `age-keygen -y <key-file>` (public, safe to show); encryption of a Secret manifest read from stdin without naming a file that holds plaintext:

```bash
kubectl create secret generic <secret-name> --namespace factory \
  --from-env-file <env-file> --dry-run=client -o yaml \
| sops --encrypt --age "$(age-keygen -y <key-file>)" \
    --encrypted-regex '^(data|stringData)$' \
    --input-type yaml --output-type yaml /dev/stdin > secrets/<secret-name>.sops.yaml
```

  decryption check without printing: `SOPS_AGE_KEY_FILE=<key-file> sops --decrypt secrets/<file> > /dev/null`; the repository's `.sops.yaml`:

```yaml
creation_rules:
  - path_regex: secrets/.*\.sops\.yaml$
    encrypted_regex: ^(data|stringData)$
    age: <recipient>
```

  Flux decrypts with a Kustomization's `spec.decryption: { provider: sops, secretRef: { name: sops-age } }`, where `sops-age` in `flux-system` holds the key under a name ending in `.agekey`.
- Pitfalls: a lost age key means every secret must be created again; `sops` without `--age` uses `.sops.yaml` only when the file path matches `path_regex`; never write plaintext into the repository, not even temporarily.
- Smoke test: encrypt a Secret with a dummy value `x=1`, check that the file contains `ENC[`, decrypt it to `/dev/null`.

`prompts/integrations/flux.md` must contain:
- `Tested with:` the Flux version (current) and the date.
- Facts: `flux check --pre`; bootstrap `GITHUB_TOKEN=$(gh auth token) flux bootstrap github --owner=<owner> --repository=<repo> --branch=main --path=clusters/<name> --private=true --personal=<true|false>` (true when the owner is a user account) — it commits `clusters/<name>/flux-system/` to `main`, so run `git pull --rebase origin main` afterwards; Kustomizations with `dependsOn` and `wait: true` order CRDs before their objects; `flux get kustomizations -A`, `flux get helmreleases -A`, `flux reconcile source git flux-system`.
- Pitfalls: a ClusterIssuer in the same Kustomization as the cert-manager HelmRelease fails on the first run (CRDs missing), so they live in two Kustomizations; the bootstrap token only creates the deploy key and is not stored in the cluster.
- Smoke test: `flux check` passes and `flux get kustomizations -A` lists `flux-system` Ready.

`prompts/integrations/ingress.md` must contain:
- `Tested with:` cert-manager version (current), Traefik bundled with the k3s version, the date.
- Facts: the host is a name in the user's domain with an A record to the server's IPv4 (`dig +short <host>` prints it); HTTP-01 through Traefik; why not `sslip.io` or a bare IP address (one sentence, pointing to the spec's Check results); the ClusterIssuer and the placeholder Deployment, Service and Ingress, with `<host>` and `<email>` from `factory.yaml`:

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata: { name: letsencrypt }
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: <email>
    privateKeySecretRef: { name: letsencrypt-account }
    solvers: [ { http01: { ingress: { ingressClassName: traefik } } } ]
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: healthz, namespace: factory }
spec:
  selector: { matchLabels: { app: healthz } }
  template:
    metadata: { labels: { app: healthz } }
    spec: { containers: [ { name: whoami, image: traefik/whoami:v1.10, ports: [ { containerPort: 80 } ] } ] }
---
apiVersion: v1
kind: Service
metadata: { name: healthz, namespace: factory }
spec: { selector: { app: healthz }, ports: [ { port: 80 } ] }
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: healthz
  namespace: factory
  annotations: { cert-manager.io/cluster-issuer: letsencrypt }
spec:
  ingressClassName: traefik
  tls: [ { hosts: [ <host> ], secretName: healthz-tls } ]
  rules:
    - host: <host>
      http: { paths: [ { path: /healthz, pathType: Prefix, backend: { service: { name: healthz, port: { number: 80 } } } } ] }
```

- Pitfalls: a new server address needs the A record changed (the host, the certificate and the App webhook URL stay); a CAA record on the domain must allow `letsencrypt.org`; an A record that is still propagating fails HTTP-01, so wait for `dig` first; Let's Encrypt allows 5 certificates for the same host per week, so do not delete and re-create the certificate in a loop.
- Smoke test: `curl -fsS --max-time 10 https://<host>/healthz` (no `-k`) and `echo | openssl s_client -connect <host>:443 -servername <host> 2>/dev/null | openssl x509 -noout -issuer`.

- [ ] **Step 2: Run the check**

Run: `pnpm --dir tools/check check`
Expected: `check: ok` (every card has its sections and `Tested with:` line).

- [ ] **Step 3: Commit**

```bash
git add prompts/integrations
git commit -m "Add integration cards for the Hetzner server, k3s, sops with age, Flux and the ingress"
```

---

### Task 8: Doctor prompt (phases doctor and home)

**Files:**
- Create: `prompts/doctor.md`

**Interfaces:**
- Consumes: `prompts/spec/state.schema.json` (Task 3), `pnpm --dir tools/check validate` (Task 3), rules in `AGENTS.md` (Task 5).
- Produces: `.factory/state.json` with phases `doctor` and `home` (`home.repo` = `<owner>/<name>`); remotes `origin` (private copy) and `upstream`; `tools/check` dependencies installed.

- [ ] **Step 1: Write the prompt**

~~~~markdown
# Doctor

## Purpose

Check that this machine can install a factory, install what is missing, and
turn this clone into the user's private factory repository.

## Inputs

- This clone of the upstream repository.
- `.factory/state.json`, when it exists (then skip the phases it records as done).

## Steps

1. Check the OS: `uname -s` prints `Darwin` or `Linux`. On Windows the user
   runs everything inside WSL; say so and stop otherwise.
2. Check each tool and list every missing one at once:

   | Tool | Check | macOS | Debian or Ubuntu |
   |---|---|---|---|
   | git | `git --version` | `brew install git` | `sudo apt-get install -y git` |
   | gh | `gh --version` | `brew install gh` | https://github.com/cli/cli/blob/trunk/docs/install_linux.md |
   | ssh | `ssh -V` | built in | `sudo apt-get install -y openssh-client` |
   | kubectl | `kubectl version --client` | `brew install kubectl` | https://kubernetes.io/docs/tasks/tools/install-kubectl-linux/ |
   | flux | `flux --version` | `brew install fluxcd/tap/flux` | `curl -s https://fluxcd.io/install.sh \| sudo bash` |
   | sops | `sops --version` | `brew install sops` | a release binary from https://github.com/getsops/sops/releases |
   | age | `age --version` | `brew install age` | `sudo apt-get install -y age` |
   | node 22+ | `node --version` | `brew install node@22` | https://github.com/nodesource/distributions |
   | pnpm | `pnpm --version` | `corepack enable pnpm` | `corepack enable pnpm` |
   | jq | `jq --version` | `brew install jq` | `sudo apt-get install -y jq` |
   | dig | `dig -v` | built in | `sudo apt-get install -y dnsutils` |

   Ask the user before installing, then install with the commands above.
3. Install the checker's dependencies: `pnpm --dir tools/check install --frozen-lockfile`.
4. Check GitHub access: `gh auth status` shows a logged-in account whose token
   scopes include `repo` and `workflow`. When not, ask the user to run
   `gh auth login --scopes repo,workflow` (or `gh auth refresh --scopes repo,workflow`)
   and wait.
5. When `.factory/state.json` records `phases.home`, skip to step 8.
   Otherwise ask the user who owns the factory repository (their account or
   an organisation they administer) and its name (default
   `software-factory`; allowed characters `A-Z a-z 0-9 . _ -`). Check the
   owner type: `gh api users/<owner> -q .type` prints `User` or
   `Organization`.
6. When `gh repo view <owner>/<name>` succeeds, the repository exists: ask
   whether it is this factory (continue with it: set the remotes as in step 7
   and `git pull --rebase origin main`) or another name should be used. Do
   not push into an existing repository that is not this factory.
7. Create the private copy:

   ```bash
   gh repo create <owner>/<name> --private --description "Software factory"
   git remote rename origin upstream
   git remote add origin https://github.com/<owner>/<name>.git
   git push origin main
   ```

8. Write `.factory/state.json` (times in UTC from `date -u +%Y-%m-%dT%H:%M:%SZ`,
   the version from `VERSION`), for example:

   ```json schema=state
   {
     "promptsVersion": "0.1.0-alpha.1",
     "phases": {
       "doctor": { "done": "2026-10-01T10:00:00Z" },
       "home": { "done": "2026-10-01T10:02:00Z", "repo": "acme/software-factory", "ownerType": "User" }
     }
   }
   ```

   Validate, commit and push:

   ```bash
   pnpm --dir tools/check validate state .factory/state.json
   git add .factory/state.json
   git commit -m "Start the factory installation"
   git push origin main
   ```

9. Continue with `install.md`.

## Done when

- Every tool in step 2 prints a version, and node's major version is 22 or more.
- `gh auth status` shows the `repo` and `workflow` scopes.
- `git remote get-url origin` is the private repository and
  `git remote get-url upstream` is the public one.
- `gh repo view <owner>/<name> --json visibility -q .visibility` prints `PRIVATE`.
- `pnpm --dir tools/check validate state .factory/state.json` passes and the
  file is pushed.

## Never

- Force-push, or push to `upstream`.
- Make the factory repository public.
~~~~

- [ ] **Step 2: Run the check**

Run: `pnpm --dir tools/check check`
Expected: `check: ok` (the `json schema=state` example validates; `install.md` does not exist yet, and `doctor.md` links to it only as text, not as a markdown link).

- [ ] **Step 3: Commit**

```bash
git add prompts/doctor.md
git commit -m "Add the doctor prompt that checks the machine and creates the private factory repository"
```

---

### Task 9: Install orchestration and interview (phase interview)

**Files:**
- Create: `prompts/install.md`, `prompts/interview.md`

**Interfaces:**
- Consumes: `doctor.md` (Task 8), `factory.schema.json` (Task 3), `hetzner-ssh.md` (Task 7).
- Produces: `install.md` with the phase table and the resume rule, and the sections `### Phase secrets`, `### Phase github-app`, `### Phase server`, `### Phase gitops`, `### Phase verify` that Tasks 10-12 fill in; `factory.yaml` written by the interview.

- [ ] **Step 1: Write `prompts/interview.md`**

~~~~markdown
# Interview

## Purpose

Ask the user for the factory's settings and write them to `factory.yaml`.

## Inputs

- `prompts/spec/factory.schema.json`
- `.factory/state.json` (`phases.home.repo`)
- `prompts/integrations/hetzner-ssh.md`

## Steps

1. Server. Ask for the SSH address of the Hetzner server as `user@ipv4`
   (for example `root@203.0.113.10`). Run the smoke test of
   `integrations/hetzner-ssh.md`. Refuse and explain when the login fails,
   the OS is not Ubuntu 24.04 or Debian 12, or the address is not a public
   IPv4 (an IPv6-only server cannot be used in this version: GitHub is not
   reachable over IPv6). Compare CPU,
   memory and disk with the recommended size in the card and tell the user.
2. Host and email. The factory needs a host name in a domain the user
   controls, for example `factory.example.com`; the App's webhooks and the
   certificate use it. Ask for the host and for an email for the Let's
   Encrypt account (it is written to the repository; it is not a secret).
   Tell the user to create an A record from the host to the server's IPv4 at
   their DNS provider, then check every 30 seconds, for up to 15 minutes,
   until `dig +short <host>` prints exactly that address. When it prints
   nothing or another address, say so and keep waiting; do not continue
   before it matches.
3. Projects. Ask which GitHub repositories the factory will serve (at least
   one). For each, `gh repo view <owner>/<repo>` must succeed. Name each
   project after its repository in lower case.
4. Runtime agent. Ask: `claude` (Claude Code; needs an Anthropic API key or a
   Claude Code OAuth token) or `opencode` with OpenRouter (needs an
   OpenRouter key). Ask for the model of work turns and of review turns;
   suggest `opus` and `sonnet` for `claude`; for `opencode` ask for two
   OpenRouter model ids.
5. Limits. Suggest and confirm `concurrentTurns: 2`,
   `turnDeadlineSeconds: 3600`, `maxAgentTurns: 100`.
6. Name. Suggest the repository name in lower case (pattern
   `^[a-z][a-z0-9-]{1,38}[a-z0-9]$`).
7. Write `factory.yaml`, for example:

   ```yaml schema=factory
   name: acme-factory
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
   ```

   Validate, commit and push:

   ```bash
   pnpm --dir tools/check validate factory factory.yaml
   git add factory.yaml && git commit -m "Record the factory settings" && git push origin main
   ```

## Done when

- `pnpm --dir tools/check validate factory factory.yaml` passes.
- The server smoke test passed and the host resolves to the server's IPv4.
- Every project repository exists.

## Never

- Ask for secret values here; keys are entered in the secrets phase, into a file.
~~~~

- [ ] **Step 2: Write `prompts/install.md`**

~~~~markdown
# Install

## Purpose

Take a factory from a private copy with `.factory/state.json` to a running
factory, one phase at a time, so that an interrupted installation resumes
where it stopped.

## Inputs

- `.factory/state.json`, `factory.yaml`
- the integration cards named in each phase

## Steps

1. Read `.factory/state.json`. Run the phases below in order, skipping every
   phase whose `done` is set.
2. After each phase, add it to `.factory/state.json` with `done` (UTC,
   `date -u +%Y-%m-%dT%H:%M:%SZ`) and the outputs in the table, validate with
   `pnpm --dir tools/check validate state .factory/state.json`, commit and push.
3. When a phase fails, record nothing for it, tell the user what failed and
   what you tried, and stop. Running `install.md` again resumes here.

| Phase | Where | Outputs recorded |
|---|---|---|
| doctor | `doctor.md` | — |
| home | `doctor.md` | `repo`, `ownerType` |
| interview | `interview.md` | — |
| secrets | below | `ageRecipient` |
| github-app | below | `appId`, `appSlug` |
| server | below | `k3sVersion` |
| gitops | below | `fluxVersion` |
| verify | below | `report` |

This version ends after the verify phase with the install checks. The phases
build, deploy and handoff arrive in a later version: tell the user what is
running and that the factory itself comes with the next version of the
prompts (`git merge upstream/main`).

### Phase secrets

(Task 10)

### Phase github-app

(Task 10)

### Phase server

(Task 11)

### Phase gitops

(Task 11)

### Phase verify

(Task 12)

## Done when

- `.factory/state.json` records every phase of this version as done and
  validates against the schema.
- `verify-report.md` shows INSTALL-1 and INSTALL-2 passed.
~~~~

The five `(Task N)` lines are replaced in Tasks 10-12; this task commits them so the phase order is fixed first. Task 12, step 3 checks that none is left.

- [ ] **Step 3: Run the check**

Run: `pnpm --dir tools/check check`
Expected: FAIL with exactly two problems — `prompts/install.md: acceptance id INSTALL-1 is not defined in prompts/verify.md` and the same for INSTALL-2 (verify.md arrives in Task 12). Any other problem must be fixed now.

- [ ] **Step 4: Commit**

```bash
git add prompts/install.md prompts/interview.md
git commit -m "Add the install prompt that runs resumable phases and the interview that writes factory.yaml"
```

---

### Task 10: Phases secrets and github-app, and the GitHub App card

**Files:**
- Create: `prompts/integrations/github-app.md`
- Modify: `prompts/install.md` (sections `### Phase secrets` and `### Phase github-app`)

**Interfaces:**
- Consumes: `sops-age.md` (Task 7), check 3 result (Task 6), `factory.yaml` fields `name`, `home.repo`, `runtime.ingress.host`, `runtime.harness.kind`.
- Produces: `~/.config/software-factory/<name>.agekey` and `<name>.env` (outside the repository); `.sops.yaml`; `secrets/factory-model.sops.yaml` and `secrets/github-app.sops.yaml` (Kubernetes Secrets `factory-model` and `github-app` in namespace `factory`); `.factory/bin/github-app.mjs`; state outputs `ageRecipient`, `appId`, `appSlug`.

- [ ] **Step 1: Write the GitHub App card**

`prompts/integrations/github-app.md` must contain:
- `Tested with:` the date of check 3 and the `gh` version.
- Facts: the manifest flow — an HTML form posts `manifest` (JSON) to `https://github.com/settings/apps/new?state=<state>` for a user or `https://github.com/organizations/<org>/settings/apps/new?state=<state>` for an organisation; GitHub redirects to `redirect_url` with `code` and `state`; `POST https://api.github.com/app-manifests/<code>/conversions` (no authentication) returns `id`, `slug`, `pem`, `webhook_secret`, `client_id`, `client_secret` (201); the result of check 3 for a `http://127.0.0.1:8765/callback` redirect; the permissions and events this factory requests:

```json
{
  "default_permissions": { "contents": "write", "pull_requests": "write", "issues": "write", "checks": "read", "actions": "read", "metadata": "read" },
  "default_events": ["issues", "issue_comment", "pull_request", "pull_request_review", "pull_request_review_comment", "check_run", "workflow_run"]
}
```

  App authentication — a JWT signed with RS256 by the private key, claims `iat` (now − 60 s), `exp` (now + 9 min), `iss` (the app id); `GET /app/installations` lists installations; `POST /app/installations/<id>/access_tokens` returns an installation token valid for one hour; `GET /installation/repositories` with that token lists the repositories; the install page is `https://github.com/apps/<slug>/installations/new`. A GitHub App cannot be assigned to issues and is not notified of mentions.
- Pitfalls: App names are unique across GitHub (the user can change the name on the creation page); the webhook URL fails until the factory's controller is deployed, which is expected in this version; the conversion `code` expires after one hour and works once.
- Smoke test: the helper's output lists the installation and its repositories.

- [ ] **Step 2: Write the section `### Phase secrets` in `install.md`**

~~~~markdown
### Phase secrets

Uses `integrations/sops-age.md`. `<name>` is `name` in `factory.yaml`.

1. `mkdir -p ~/.config/software-factory && chmod 700 ~/.config/software-factory`
2. When `~/.config/software-factory/<name>.agekey` does not exist:
   `age-keygen -o ~/.config/software-factory/<name>.agekey && chmod 600 ~/.config/software-factory/<name>.agekey`.
   Never overwrite an existing key.
3. Write `.sops.yaml` as in the card, with the recipient from
   `age-keygen -y ~/.config/software-factory/<name>.agekey`.
4. Create the env file `~/.config/software-factory/<name>.env` (mode 600)
   with empty keys for the runtime agent in `factory.yaml`:
   `claude` → `ANTHROPIC_API_KEY=` and `CLAUDE_CODE_OAUTH_TOKEN=` (the user
   fills one of them and deletes the other line); `opencode` →
   `OPENROUTER_API_KEY=`. Do not overwrite an existing file.
5. Tell the user: open `~/.config/software-factory/<name>.env` in an editor,
   fill in the value, save, and reply "done". Do not ask for the value in
   chat.
6. Check without reading the value: `grep -cE '^[A-Z_]+=.+' <env-file>` is at
   least 1 and `grep -cE '^[A-Z_]+=$' <env-file>` is 0.
7. `mkdir -p secrets` and encrypt the env file into
   `secrets/factory-model.sops.yaml` (Secret `factory-model`, namespace
   `factory`) with the command in the card.
8. Check: `grep -c 'ENC\[' secrets/factory-model.sops.yaml` is at least 1 and
   `SOPS_AGE_KEY_FILE=~/.config/software-factory/<name>.agekey sops --decrypt secrets/factory-model.sops.yaml > /dev/null`
   succeeds.
9. Tell the user to back up `~/.config/software-factory/<name>.agekey` now
   (a password manager): without it every secret must be created again.
10. Commit `.sops.yaml` and `secrets/`. Record `ageRecipient`.
~~~~

- [ ] **Step 3: Write the section `### Phase github-app` in `install.md`**

~~~~markdown
### Phase github-app

Uses `integrations/github-app.md`.

1. Write `.factory/bin/github-app.mjs`, a Node script without dependencies
   that:
   - listens on `127.0.0.1:8765`;
   - serves `/` as an HTML page that posts the manifest to the creation URL
     for the owner type in `phases.home.ownerType` (user or organisation
     URL from the card) with a random `state`;
   - uses this manifest: `name` `<name>-factory`, `url`
     `https://github.com/<home.repo>`, `hook_attributes`
     `{ url: "https://<runtime.ingress.host>/webhooks/github", active: true }`,
     `redirect_url` `http://127.0.0.1:8765/callback`, `public: false`, and the
     permissions and events from the card;
   - on `/callback` checks `state`, converts the code, redirects the browser
     to `https://github.com/apps/<slug>/installations/new`;
   - pipes a Secret manifest `github-app` (namespace `factory`, `stringData`:
     `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`,
     `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`) into
     `sops --encrypt --age <recipient> --encrypted-regex '^(data|stringData)$' --input-type yaml --output-type yaml /dev/stdin`
     and writes the result to `secrets/github-app.sops.yaml`; the plaintext
     exists only in the script's memory;
   - then polls `GET /app/installations` with an App JWT every 5 seconds,
     for at most 10 minutes, until one exists; lists its repositories with an
     installation token;
   - prints only `appId`, `slug`, the installation account and the
     repository names, and exits 0; exits 1 with a message on any error.
2. Start it in the background and tell the user: open
   `http://127.0.0.1:8765/`, check the name, click "Create GitHub App", then
   on the next page choose the project repositories and click "Install".
3. Wait for the script to exit. Every project repository in `factory.yaml`
   must be in its list; when one is missing, ask the user to add it at
   `https://github.com/apps/<slug>/installations/new` and run the check
   again (the script can be run with `--check-only` to skip creation: it then
   reads the App id from `secrets/github-app.sops.yaml` via `sops --decrypt`
   inside the script).
4. Commit `.factory/bin/github-app.mjs` and `secrets/github-app.sops.yaml`.
   Record `appId` and `appSlug`.
~~~~

- [ ] **Step 4: Run the check**

Run: `pnpm --dir tools/check check`
Expected: the same two INSTALL-id problems as after Task 9, nothing else.

- [ ] **Step 5: Commit**

```bash
git add prompts/install.md prompts/integrations/github-app.md
git commit -m "Add the secrets and GitHub App phases and the GitHub App card"
```

---

### Task 11: Phases server and gitops

**Files:**
- Modify: `prompts/install.md` (sections `### Phase server` and `### Phase gitops`)

**Interfaces:**
- Consumes: `hetzner-ssh.md`, `k3s.md`, `flux.md`, `sops-age.md`, `ingress.md` (Task 7); `phases.home.ownerType` (Task 8); `secrets/` (Task 10).
- Produces: `~/.config/software-factory/<name>.kubeconfig` (server `https://127.0.0.1:16443`); `.factory/bin/tunnel.sh`; in the repository: `clusters/<name>/flux-system/` (from bootstrap), `clusters/<name>/infra.yaml`, `clusters/<name>/secrets.yaml`, `clusters/<name>/apps.yaml`, `infra/base/`, `infra/config/`, `deploy/healthz/`; state outputs `k3sVersion`, `fluxVersion`.

- [ ] **Step 1: Write the section `### Phase server`**

~~~~markdown
### Phase server

Uses `integrations/hetzner-ssh.md` and `integrations/k3s.md`. `<ssh>` is
`runtime.server.ssh`, `<ip>` its address.

1. Preflight over SSH: `ssh <ssh> 'command -v k3s; ss -ltnp | grep -E ":(80|443) " ; ufw status'`.
   When k3s is present, or something already listens on 80 or 443, stop and
   ask the user: this phase installs on a fresh server only.
2. Firewall: run the ufw commands from the k3s card over SSH.
3. k3s: run the install command from the card with the pinned version; check
   `ssh <ssh> 'k3s --version'`.
4. Kubeconfig, without printing it:
   `ssh <ssh> 'cat /etc/rancher/k3s/k3s.yaml' > ~/.config/software-factory/<name>.kubeconfig && chmod 600 ~/.config/software-factory/<name>.kubeconfig`,
   then `KUBECONFIG=~/.config/software-factory/<name>.kubeconfig kubectl config set-cluster default --server=https://127.0.0.1:16443`.
5. Write `.factory/bin/tunnel.sh`, with `<ssh>` replaced by the value from `factory.yaml`:

   ```bash
   #!/usr/bin/env bash
   # Opens the SSH tunnel to the Kubernetes API unless it is already open.
   set -euo pipefail
   # Written by the server phase from runtime.server.ssh in factory.yaml.
   ssh_target='<ssh>'
   if ! nc -z 127.0.0.1 16443 2>/dev/null; then
     ssh -fN -o ExitOnForwardFailure=yes -L 16443:127.0.0.1:6443 "$ssh_target"
   fi
   ```

   `chmod +x .factory/bin/tunnel.sh`, run it, and check
   `KUBECONFIG=~/.config/software-factory/<name>.kubeconfig kubectl get nodes`
   shows the node Ready.
6. Check that the API is closed from outside: `nc -z -w5 <ip> 6443` fails.
7. Commit `.factory/bin/tunnel.sh`. Record `k3sVersion`.
~~~~

- [ ] **Step 2: Write the section `### Phase gitops`**

~~~~markdown
### Phase gitops

Uses `integrations/flux.md`, `integrations/sops-age.md` and
`integrations/ingress.md`. Run `.factory/bin/tunnel.sh` first and
`export KUBECONFIG=~/.config/software-factory/<name>.kubeconfig`.

1. `flux check --pre`.
2. Bootstrap with the command from the Flux card (`--personal=true` when
   `phases.home.ownerType` is `User`), then `git pull --rebase origin main`.
3. Give Flux the age key (a bootstrap step, so direct kubectl is allowed):
   `kubectl -n flux-system create secret generic sops-age --from-file=age.agekey=$HOME/.config/software-factory/<name>.agekey`.
   When it already exists, leave it.
4. Write `infra/base/`: `namespaces.yaml` (Namespace `factory`) and
   `cert-manager.yaml` (HelmRepository `jetstack`,
   `https://charts.jetstack.io`, and HelmRelease `cert-manager` in namespace
   `cert-manager` with `install.createNamespace: true`, the chart version
   from the ingress card and values `crds: { enabled: true }`).
5. Write `infra/config/cluster-issuer.yaml` with the ClusterIssuer from the
   ingress card, `email` from `runtime.ingress.email`.
6. Write `deploy/healthz/` with the placeholder Deployment, Service and
   Ingress from the ingress card, in namespace `factory`, host
   `runtime.ingress.host`. The factory's controller replaces it later.
7. Write the Flux Kustomizations in `clusters/<name>/`:
   - `infra.yaml`: Kustomization `infra` (path `./infra/base`, prune, wait,
     interval 10m) and Kustomization `infra-config` (path `./infra/config`,
     `dependsOn: [infra]`, prune, wait);
   - `secrets.yaml`: Kustomization `secrets` (path `./secrets`,
     `dependsOn: [infra]`, prune, `decryption: { provider: sops, secretRef: { name: sops-age } }`);
   - `apps.yaml`: Kustomization `apps` (path `./deploy`,
     `dependsOn: [infra-config, secrets]`, prune, wait).
8. Commit and push, then `flux reconcile source git flux-system` and wait up
   to 10 minutes until `flux get kustomizations -A` shows every row Ready.
9. Wait until `kubectl -n factory get certificate` shows `healthz-tls` Ready.
10. Record `fluxVersion` (`flux --version`).
~~~~

- [ ] **Step 3: Run the check**

Run: `pnpm --dir tools/check check`
Expected: the same two INSTALL-id problems, nothing else.

- [ ] **Step 4: Commit**

```bash
git add prompts/install.md
git commit -m "Add the server and GitOps phases: k3s behind a firewall and an SSH tunnel, Flux with sops and cert-manager"
```

---

### Task 12: Verify prompt with INSTALL-1 and INSTALL-2, and the verify phase

**Files:**
- Create: `prompts/verify.md`
- Modify: `prompts/install.md` (section `### Phase verify`)

**Interfaces:**
- Consumes: `.factory/bin/tunnel.sh`, the kubeconfig and `runtime.ingress.host` (Task 11).
- Produces: acceptance ids INSTALL-1, INSTALL-2; `verify-report.md` in the installation; state output `report` = `verify-report.md`.

- [ ] **Step 1: Write `prompts/verify.md`**

~~~~markdown
# Verify

## Purpose

Check the running factory from the outside against its acceptance criteria
and write the result to `verify-report.md`. Later versions add checks to the
table; every check has an id that the prompts refer to.

## Inputs

- `factory.yaml` (`runtime.ingress.host`)
- `~/.config/software-factory/<name>.kubeconfig` and `.factory/bin/tunnel.sh`

## Steps

1. Run `.factory/bin/tunnel.sh` and
   `export KUBECONFIG=~/.config/software-factory/<name>.kubeconfig`.
2. Run every check in the table with its procedure. Record pass or fail and
   the evidence (the command's relevant output).
3. Write `verify-report.md`: the date, `promptsVersion`, and one line per
   check: id, pass or fail, evidence. Commit and push it.

| Id | Check | Procedure |
|---|---|---|
| INSTALL-1 | Flux kustomizations and Helm releases are Ready. | `flux get kustomizations -A` and `flux get helmreleases -A`: every row shows Ready `True`. |
| INSTALL-2 | `https://<host>/healthz` answers over a valid certificate. | `curl -fsS --max-time 10 https://<host>/healthz` exits 0 without `-k`, and `echo \| openssl s_client -connect <host>:443 -servername <host> 2>/dev/null \| openssl x509 -noout -issuer` names Let's Encrypt. |

## Done when

- Every check in the table passed.
- `verify-report.md` is pushed.
~~~~

- [ ] **Step 2: Write the section `### Phase verify` in `install.md`**

~~~~markdown
### Phase verify

Run `verify.md`. This version has the install checks INSTALL-1 (Flux is
Ready) and INSTALL-2 (the health endpoint answers over a valid certificate).
When one fails, use the Pitfalls of the Flux and ingress cards, fix the
cause by committing, and run `verify.md` again. Record `report:
verify-report.md`.
~~~~

- [ ] **Step 3: Run the check**

Run: `pnpm --dir tools/check check && grep -n '(Task [0-9]*)' prompts/install.md`
Expected: `check: ok`, and the grep prints nothing (no section left unwritten).

- [ ] **Step 4: Commit**

```bash
git add prompts/verify.md prompts/install.md
git commit -m "Add the verify prompt with the install checks and the verify phase"
```

---

### Task 13: End-to-end run of the installer

The prompts are tested by a fresh agent following them. Runs after Task 14: the user follows `README.md` from the published repository as any user would; you watch the transcript, collect problems, push fixes, and the user repeats until a clean run passes.

**Files:**
- Modify: any prompt or card that a run shows to be wrong or unclear; `CHANGELOG.md` (date of the entry).

**Interfaces:**
- Consumes: everything above.
- Produces: a passing `verify-report.md` in a test installation; fixes to the prompts.

- [ ] **Step 1: Prepare**

The user prepares what the README lists (a fresh server, a test host whose A record they create only when the interview asks, a project repository of their own) and tells you the directory they will clone into. Their transcript is then in `~/.claude/projects/<that absolute path with every / and . replaced by ->/`; read it as the run goes, without printing secrets.

- [ ] **Step 2: Plant a canary**

Tell the user to put a canary value into the env file when the secrets phase asks for the model key, for example `ANTHROPIC_API_KEY=sk-canary-<8 random hex>`, and to replace it with the real token or key only after this run (this version stores the key but does not use it). Note the canary value.

- [ ] **Step 3: A host that does not resolve yet**

At the host question of the interview, the user gives the host before creating its A record. Expected: the agent asks for the record and waits until `dig +short <host>` prints the server's address; it does not write `factory.yaml` before that. Then the user creates the record.

- [ ] **Step 4: Interrupt during gitops**

When the gitops phase has pushed the bootstrap commit, ask the user to stop the session.

- [ ] **Step 5: Resume**

The user starts a new session in the same directory. Expected: the agent reads `.factory/state.json`, skips every done phase (no second repository, App or key; no force-push) and continues gitops to the end, then verify.

- [ ] **Step 6: Re-run on an installed server**

After a passing run, ask the user to start a session and ask for the server phase again after removing `phases.server` from `.factory/state.json` in a scratch branch. Expected: the preflight finds k3s and stops to ask instead of reinstalling. Discard the scratch branch.

- [ ] **Step 7: Check for the canary**

Search the transcript for the canary: `grep -rl '<canary>' ~/.claude/projects/<transcript directory>`. Expected: no match. Also `git -C <clone> log -p | grep -c '<canary>'` prints 0.

- [ ] **Step 8: Organisation owner (when available)**

When the user administers a GitHub organisation, repeat only the github-app phase for a second test factory owned by it. Expected: the helper opens the organisation creation URL and the App is created there.

- [ ] **Step 9: Fix and repeat**

For every problem seen (a wrong command, a missing check, the agent guessing), fix the prompt or card in `~/prj-other/software-factory`, run `pnpm --dir tools/check check`, commit and push, and the user repeats the run from a fresh clone and a rebuilt server until one run passes without intervention beyond the human steps. Then record check 5 from the passing run: `ssh <ssh> 'free -m'` and, through the tunnel, `kubectl top pods -A`; write the recommended server size (the memory in use plus 4 GiB for one turn, rounded up to a Hetzner server type) into the spec's Check results and `hetzner-ssh.md`, and replace every card's `Tested with:` line with the versions and date of that run. Set the date of the `0.1.0-alpha.1` entry in `CHANGELOG.md` and commit.

- [ ] **Step 10: Clean up the test resources**

Ask the user before deleting: the test repositories (`gh repo delete <owner>/<repo> --yes`), the test GitHub App (settings page), the server (Hetzner console), the test A record (their DNS provider), `~/.config/software-factory/<test-name>.*`.

---

### Task 14: Publish the repository

Only after the user says yes to publishing.

- [ ] **Step 1: Create the public repository and push**

```bash
cd ~/prj-other/software-factory
gh repo create belov38/software-factory --public --source . --push --description "Software as a Prompt: prompts your coding agent follows to install a coding-agent factory on your infrastructure"
gh repo edit belov38/software-factory --add-topic coding-agents --add-topic software-factory --add-topic gitops --add-topic k3s --add-topic claude-code
```

- [ ] **Step 2: Check upstream CI**

Run: `gh run list --repo belov38/software-factory --limit 1`
Expected: the `upstream-ci` run succeeds.
