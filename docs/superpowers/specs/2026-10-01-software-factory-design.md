# Software Factory — design

Date: 2026-10-01
Status: draft

## Idea

Software as a Prompt. The product is a public repository of prompts, not of
code. A person clones it, opens their own coding agent in it (Claude Code,
OpenCode or another harness that reads `AGENTS.md`), and the agent installs a
software factory on the person's infrastructure: it provisions the cluster,
generates the factory's code into the person's private copy of the
repository, deploys it through GitOps and checks it against acceptance
criteria.

A software factory here is a service that takes work items (issues), runs
coding agents on them in isolated runners, and returns reviewed pull
requests, with humans at the decision points: answering questions, reviewing
and merging.

Everyone builds their own factory today. A shared, versioned specification
that each installation compiles into code gives the same behaviour
everywhere, one place to fix a design mistake, and one set of hardening and
upgrade prompts.

## Goals for v1

- A person with an existing Hetzner server (SSH access), a GitHub account and
  a domain name where they can add a DNS record runs the installer and gets a working factory that passes every acceptance
  check in `verify`.
- The same prompts produce a passing factory with either runtime agent:
  Claude Code (`claude -p`) or OpenCode with OpenRouter.
- The factory handles the loop: an issue asks for a change, an agent turn
  opens a draft pull request, an independent review turn reviews it, one
  revision round addresses unambiguous findings, the pull request goes to the
  human, and review comments and failing CI start further turns until merge.
- The architecture admits other trackers, channels and git forges (Linear,
  Slack, Azure DevOps, GitLab) as adapters generated later from the same
  prompts, without changing the core.

## Non-goals for v1

- Adapters other than GitHub.
- Triage, a spec stage with human approval, UI verification with computer
  use, a metrics dashboard (the ledger records the data from v1 on),
  self-improvement, hardening prompts.
- Creating servers through the Hetzner API, multi-node clusters, high
  availability, native Windows.
- GitHub agent apps (see Related work: partner-only as of September 2026).
- Hostnames from wildcard DNS services such as `sslip.io`, and certificates
  for bare IP addresses (see Check results).

## Decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Audience | Public OSS for organisations and individuals, Apache-2.0. |
| 2 | Product form | Prompts only: specification, integration cards, installer, verification and operation prompts. Code is generated per installation into the user's private repository. |
| 3 | Reference profile | Existing Hetzner server over SSH, single-node k3s, GitHub for issues, conversation, pull requests and container images (ghcr). |
| 4 | Capabilities in v1 | Core loop, independent review, feedback from pull requests (reviews and CI). |
| 5 | Runtime agent | Chosen by the user per factory: `claude` (Claude Code CLI) or `opencode` with OpenRouter. |
| 6 | Stack of generated code | Fixed: TypeScript on Node 22, pnpm workspaces, Fastify, zod, vitest, `@kubernetes/client-node`, SQLite. |
| 7 | GitOps | Flux, bootstrapped into the user's private repository, with SOPS and age for secrets. |
| 8 | GitHub identity | A GitHub App created through the manifest flow; short-lived installation tokens per turn phase. |
| 9 | Ingress and events | The user's own domain, with an A record to the server, is required; Traefik (bundled with k3s), cert-manager, Let's Encrypt HTTP-01 with an account registered to the user's email. GitHub delivers App webhooks to `https://<host>/webhooks/github`; a catch-up poll of the API every few minutes picks up what a lost delivery missed. |
| 10 | Integration shape | Adapters are modules in one codebase behind ports; core and adapters exchange message-shaped values validated by zod schemas, so a module can move to a separate service later. |
| 11 | Security | Isolation rules are requirements with acceptance checks from v1; deeper hardening comes as separate prompts later. |

## Two repositories

### Upstream (public, the product)

```
software-factory/
  AGENTS.md            entry for any harness: you install and operate a factory; start with prompts/doctor.md
  CLAUDE.md            @AGENTS.md (Claude Code reads CLAUDE.md, OpenCode reads AGENTS.md)
  README.md, LICENSE
  CONTRIBUTING.md      how to change the prompts themselves
  VERSION              semver of the prompts
  CHANGELOG.md         per version: what changed, and a Migration section written as a prompt
  docs/                design documents of the project itself
  tools/check/         checker of the prompts: links, acceptance ids, schema examples, structure, version
  prompts/
    doctor.md          checks the local environment, creates the private copy
    install.md         runs the installation phases, resumable
    interview.md       asks the user and writes factory.yaml
    spec/              what to build
      architecture.md    stack, layout, message-shaped contracts
      core.md            work items, sessions, turns, queue, ledger, loop limits
      capabilities/
        implement.md     core loop, with acceptance criteria ids
        review.md
        pr-feedback.md
      ports/
        tracker.md  channel.md  forge.md  credentials.md  runner.md  harness.md
    integrations/      integration cards: verified facts, pitfalls, smoke tests
      hetzner-ssh.md  k3s.md  flux.md  sops-age.md  ingress.md
      github-app.md  github-issues.md  github-comments.md  ghcr.md
      claude-cli.md  opencode-openrouter.md
    verify.md          acceptance checks against the running factory
    operate/
      upgrade.md  doctor-runtime.md  rotate-secrets.md  add-project.md  add-integration.md
```

### Private copy (per installation)

`doctor` creates `<owner>/<name>` as a private repository and pushes the
upstream history into it. A GitHub fork cannot be made private, and a
template copy starts an unrelated history that makes merging upstream
updates awkward. The user's local clone is repointed and the installation
continues in it: `origin` is the private copy, `upstream` the public
repository.

```
<owner>/<name>/
  …everything from upstream…
  factory.yaml         the user's choices
  apps/factory/        generated TypeScript monorepo
  deploy/              generated Helm chart of the factory
  clusters/<name>/     Flux bootstrap manifests and Kustomizations for deploy/ and infra/
  infra/               cert-manager, ClusterIssuer, namespaces
  secrets/             *.sops.yaml, encrypted with age
  .sops.yaml           sops creation rule for secrets/, with the installation's age recipient
  .github/workflows/   image builds to ghcr, then a commit of the new image tag
  .factory/state.json  installation progress and the prompts version the code was built from
```

Rules:

- Path ownership: upstream owns `AGENTS.md`, `CLAUDE.md`, `README.md`,
  `LICENSE`, `CONTRIBUTING.md`, `.gitignore`, `VERSION`, `CHANGELOG.md`,
  `docs/`, `prompts/`, `tools/` and `.github/workflows/upstream-ci.yml`.
  Everything else belongs to the installation. `git merge upstream/main`
  therefore never touches generated code.
- The cluster changes only through commits to `main` that Flux applies.
  Direct `kubectl apply` is allowed only while bootstrapping.
- Generated code is committed in reviewable steps, one component per commit.

`factory.yaml` for the reference profile:

```yaml
name: acme-factory
home: { forge: github, repo: acme/acme-factory }
runtime:
  server: { ssh: root@203.0.113.10 }
  ingress: { host: factory.acme.example, email: admin@acme.example }
  harness: { kind: claude, models: { work: opus, review: sonnet } }
  # harness: { kind: opencode, provider: openrouter, models: { work: <id>, review: <id> } }
  limits: { concurrentTurns: 2, turnDeadlineSeconds: 3600, maxAgentTurns: 100 }
projects:
  - name: shop
    forge: { kind: github, repo: acme/shop }
    tracker: { kind: github-issues, repo: acme/shop }
    channels: [ { kind: github-comments } ]
```

A project binds one tracker, one or more channels and one forge. They can
differ per project (for example Linear, Slack and Azure DevOps later), so the
core keeps the links between a work item, its session, its branch and its
pull request itself instead of deriving them from naming conventions.

## Installation

The user runs `git clone <upstream> && cd software-factory` and starts the
harness. `AGENTS.md` tells it to start `doctor` when `.factory/state.json` is
missing. Each phase is idempotent and records its result (never a secret
value) in `.factory/state.json`, so an interrupted installation resumes.

| # | Phase | What happens | Human |
|---|---|---|---|
| 1 | doctor | Checks OS (macOS, Linux, WSL) and tools: git, gh (logged in, `workflow` scope), ssh, kubectl, flux, sops, age, node 22, pnpm, jq. Installs what is missing with brew or apt. | Approves installs |
| 2 | home | Creates the private copy and remotes. | — |
| 3 | interview | Server address; the factory's host name in the user's domain and an email for Let's Encrypt, then waits until the host resolves to the server; repositories to serve, runtime agent and models, limits. Writes and commits `factory.yaml`. | Answers, creates the DNS A record |
| 4 | secrets | Generates the age key at `~/.config/software-factory/<name>.agekey`, writes a template `~/.config/software-factory/<name>.env`, encrypts it with sops into `secrets/`. | Fills in the env file, backs up the age key |
| 5 | github-app | Manifest flow: a local page posts the App manifest to GitHub (webhook `https://<host>/webhooks/github`); a localhost redirect receives the code; a script converts it into app id, private key and webhook secret and writes them straight into the encrypted secrets. | Clicks Create, then Install on the chosen repositories |
| 6 | server | Over SSH: checks OS (Ubuntu 24.04 or Debian 12) and resources, configures ufw (22, 80, 443 only), installs a pinned k3s. The Kubernetes API is reached only through an SSH tunnel. | — |
| 7 | gitops | `flux bootstrap github --private --path clusters/<name>` with the token from `gh auth token`; creates the `sops-age` secret; commits `infra/`. | — |
| 8 | build | Generates `apps/factory`, tests, Dockerfiles, `deploy/`, workflows from `prompts/spec` and the integration cards; runs `pnpm test`; commits per component. | — |
| 9 | deploy | Pushes; Actions build images to ghcr and commit the tag; waits for Flux's commit status and `flux get`. | — |
| 10 | verify | Creates `<owner>/factory-sandbox` (a small TypeScript library with tests and CI) and runs `prompts/verify.md` against it. Commits `verify-report.md`. | — |
| 11 | handoff | Summary: how to use the factory, where its state is, a reminder to back up the age key. | — |

Secrets rule: the harness works with paths to secret files, never with their
values. It does not print env files or put values on command lines. This is
a rule in the prompts; a later hardening prompt checks it.

Human inputs, in full: a Hetzner server with the user's SSH key; a host name
in the user's domain with an A record to the server, and an email for Let's
Encrypt; `gh auth login`; a model key (Anthropic or OpenRouter); a token to pull images from
ghcr (see Checks before writing prompts, item 2); two clicks for the GitHub
App; a backup of the age key.

## Runtime

### Components

```
                GitHub (App webhooks)
                       │ https://<host>/webhooks/github
                       ▼
┌──────────── factory-controller (Deployment, 1 replica) ─────────────┐
│ webhooks (verified) and a catch-up poll emit canonical events       │
│ core: ledger (SQLite on a PVC), sessions, queue, loop limits         │
│ /internal: scoped installation tokens, turn results (Job nonce)      │
│ /s/<turn>: status page without logs                                 │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ one Job per turn
                ┌──────────────┴──────────────┐
            work turn                     review turn
```

### Turns

A turn is one Kubernetes Job. Two kinds:

**Work turn** answers a question or makes a change. Containers in order:

1. `checkout` (init): clones with a read token, picks the base and the
   session branch, writes the run context.
2. `context` (init): reads the work item, its comments and the session
   history through the tracker and channel adapters.
3. `streamer` (native sidecar): posts progress through the channel adapter.
4. `agent` (init): runs the harness adapter in the working tree. It holds
   only the model key.
5. `publisher` (main): stages the agent's tree through a clean git directory
   the agent does not mount, applies the publish guards, commits, pushes to
   `factory/<item>-<session8>`, opens or updates the draft pull request.

**Review turn** reviews a change independently: a separate Job with the
review model, a fresh clone of the pull request head and read-only platform
access. The agent may run commands, including tests, because nothing from
its tree is published. Its only output is a findings document (schema below):
the Job's last container sends it to the controller
(`/internal/turns/:id/result`, authenticated with the Job's nonce), and the
controller posts it as a pull request review from the App.

### Flow of a change

```
issue mentions the App ─► work turn ─► draft PR ─► review turn ─► review on the PR
                                                        │
             ┌──────────────────────────────────────────┤
          accepted                          revise, no human decision needed
             │                                          │
             │                               work turn on the same PR (one round)
             ▼                                          ▼
  PR marked ready for review; the channel tells the human, with the review summary
             │
  human review or comments ─► work turn (no limit)
  CI fails ─────────────────► work turn with a log excerpt (at most 2 in a row)
  merged ───────────────────► work item closed, session closed
```

Reviews from the App and from humans arrive as the same event,
`change.review_submitted`. Loop limits keep the factory from feeding on
itself: one revision round per bot review, two consecutive CI fix rounds,
no limit for human reviews. Findings that need a human decision are not sent back for
revision; they stay in the review and are named in the message to the human.

### Channel `github-comments`

GitHub issues have no session panel, so:

- Acknowledge: a 👀 reaction on the triggering comment within seconds.
- Progress: one status comment per turn, edited in place (plan checklist and
  current action).
- Answer or error: a new comment.
- Question: a comment with numbered options; the human replies with a number
  or free text.
- Stop: `@<app-slug> stop`.

Triggers: a mention of `@<app-slug>` in an issue or comment, or the label
`factory`. A GitHub App cannot be assigned to an issue and is not notified of
mentions, so the controller finds the mention in `issues` and `issue_comment`
events. Pull request events count only for branches under `factory/`.

### Sessions and state

- Each session has its own transcript on the sessions PVC; the next work
  turn resumes it through the harness adapter and receives only what is new
  (a reply, a review, a CI log excerpt).
- The ledger (SQLite on a PVC of the controller) holds work items, sessions,
  turns, changes, the links between them and an event log with usage per
  turn. Jobs execute; the ledger is the source of truth. The queue lives in
  the ledger; the controller creates a Job when a slot is free.
- Webhooks can be lost (the controller is restarting, GitHub has an incident).
  A catch-up poll every few minutes reads what changed in each project
  repository since its cursor in the ledger, with conditional requests, and
  emits the events a webhook did not deliver.

### Isolation (reference profile)

- Turn pods have no service account token and a NetworkPolicy: egress only
  to DNS and to public addresses on 443, excluding `169.254.0.0/16` (the
  Hetzner metadata service) and private ranges.
- Installation tokens are issued per repository and per phase with reduced
  permissions: `clone` and `review-read` read contents; `publish` writes
  contents and pull requests; `channel` writes issues. Containers request
  them from the controller at the moment of use with a per-Job nonce (a
  Secret owned by the Job), because a token lives one hour and a turn with
  its queue time can last longer. Only the controller holds the App's
  private key.
- The publisher refuses to push outside `factory/`, refuses changes to CI
  workflow files, gitlinks, and changes over 1000 files or 50 MB.
- Every container redacts the secret values it holds from everything it
  posts or pushes, and from stored transcripts.

## Contracts and ports

### Layout of the generated code

```
apps/factory/packages/
  contracts/   canonical events, commands, capabilities, findings: zod schemas
  core/        ledger, session state machine, queue, turn planning, loop limits
  controller/  Fastify: /webhooks/:adapter, pollers, /internal/credentials, /s/:turn
  turn/        Job entrypoints: checkout, context, streamer, agent, review, publisher
  adapters/
    forge-github/  tracker-github-issues/  channel-github-comments/
    credentials-github-app/  harness-claude/  harness-opencode/  runner-k8s/
```

`adapters/index.ts` maps each `kind` in `factory.yaml` to its module.

### Canonical events (adapters to core)

- `work.requested`, `work.replied`, `work.stopped`: `{project, ref, by, text}`
- `change.review_submitted`: `{change, by, isBot, state, comments}`
- `change.checks_failed`: `{change, check, logExcerpt}`
- `change.merged`, `change.closed`: `{change}`

Every event carries a `deliveryId` derived from its source object (for
example a comment id and its update time), so a redelivered webhook, or the
same change seen by a webhook and by the catch-up poll, starts nothing new.

### Ports (core to adapters)

| Port | Commands | Capabilities an adapter declares |
|---|---|---|
| Tracker | `getWorkItem`, `link(changeUrl)`, `setStatus` | `webhooks`, `statusSync` |
| Channel | `ack(trigger)`, `progress(session, plan, current)` (upsert), `say(answer \| question \| error, options?)` | `nativeSession`, `selectOptions`, `editableProgress`, `reactions`, `maxLength` |
| Forge | `targetBranch`, `findChange(branch)`, `openDraft`, `update`, `markReady`, `comment`, `postReview(findings)`, `reviewThreads`, `checkLog` | `draft`, `reviews`, `checks: webhook \| poll \| none`, `closesKeyword` |
| Credentials | `issue(project, purpose)` → `{kind, username?, secret, expiresAt}` | — |
| Runner | `launch(turn)`, `status`, `cancel` | — |
| Harness | `run(options)` → stream of agent events | `resume`, `subagents`, `usage` |

The core adapts to declared capabilities: without `selectOptions` a question
lists numbered options; without `webhooks` the controller polls; without
`editableProgress` progress is posted less often.

Controller-side calls: webhooks, `ack`, answers, posting reviews. Job-side
calls: clone, context, progress, publish. The image is the same; a Job learns
its project from its environment and reads `factory.yaml` from a ConfigMap.

### Harness contract

```ts
run({ sessionId, resume, prompt, cwd, mode: 'work' | 'review', model, maxTurns, subagents, env })
  → AsyncIterable<
      | { kind: 'thought', text }
      | { kind: 'action', tool, param, result? }
      | { kind: 'plan', entries }
      | { kind: 'subagent', name, status, summary? }
      | { kind: 'final', text, isError, usage: { inputTokens, outputTokens, costUsd? } } >
```

- `harness-claude`: `claude -p --output-format stream-json --verbose` with
  `--session-id` or `--resume`, `--tools` and `--allowedTools`,
  `--permission-mode acceptEdits`, `--agents`; transcripts in
  `CLAUDE_CONFIG_DIR` on the sessions PVC. Background subagents emit several
  `result` events; the last one is the answer.
- `harness-opencode`: `opencode run` with JSON output and session
  continuation, the OpenRouter provider and tool permissions in its config,
  session storage on the sessions PVC.
- Modes: `work` may read, edit, run commands, keep a task list and start
  subagents; `review` has the same tools, but only its findings leave the Job.

Final message contracts, parsed by the core, not by the adapter:

- Work: markdown; or an explanation ending with `QUESTION: <one question>`
  and `OPTIONS: <a> | <b> | <c>` (2-4 options, the recommended one first).
  When files changed, the first line summarises the change, followed by
  "What changed" and "Test plan".
- Review: JSON

  ```json
  { "verdict": "accepted | revise | human",
    "summary": "one paragraph",
    "findings": [ { "file": "src/a.ts", "line": 42, "severity": "blocker | major | minor",
                    "problem": "…", "fix": "…", "needsHuman": false } ] }
  ```

### Adapter conformance

Each port specification lists the behaviours an adapter must show and the
contract tests that check them. The build phase generates
`*.contract.test.ts` for each adapter and runs them against the sandbox
repository. An adapter added later through `add-integration` passes the same
port tests.

## Verification

`prompts/verify.md` checks the running factory from the outside, against
`<owner>/factory-sandbox`. Each check has an id that the capability
specifications reference. Results go to `verify-report.md` with links to the
issues and pull requests that prove them. `verify` runs at the end of
installation, after every upgrade, and on demand.

| Id | Check |
|---|---|
| INSTALL-1 | Flux kustomizations and Helm releases are Ready. |
| INSTALL-2 | `https://<host>/healthz` answers over a valid certificate. |
| INSTALL-3 | The App's recent webhook deliveries succeeded. |
| CORE-1 | An issue asking a question gets an answer and no pull request. |
| CORE-2 | The triggering comment gets the 👀 reaction within 10 seconds. |
| CORE-3 | Progress is one status comment per turn, edited in place. |
| CORE-4 | An issue asking for a change gets a draft pull request from `factory/…` that closes the issue on merge. |
| CORE-5 | A question with options, answered with a number, continues the work. |
| CORE-6 | A follow-up resumes the same agent session. |
| CORE-7 | `stop` cancels the running turn and says so. |
| CORE-8 | A mention made while webhook deliveries fail is picked up by the catch-up poll. |
| REVIEW-1 | A review turn posts a review with a verdict on the new pull request. |
| REVIEW-2 | Findings without a human decision lead to exactly one revision turn. |
| REVIEW-3 | After review the pull request is ready for review and the channel tells the human, with the summary. |
| REVIEW-4 | Findings that need a human decision are not revised automatically and are named to the human. |
| FEEDBACK-1 | A human review comment leads to a new commit on the same pull request. |
| FEEDBACK-2 | A failing CI check leads to a fix turn; at most two in a row. |
| FEEDBACK-3 | Merging closes the issue and the session. |
| ISOLATION-1 | The agent container has no platform token and no service account token. |
| ISOLATION-2 | Turn pods cannot reach `169.254.169.254` or private addresses. |
| ISOLATION-3 | The publisher refuses a push outside `factory/`. |
| ISOLATION-4 | A canary secret placed in the agent's environment appears redacted if the agent prints it. |
| ISOLATION-5 | The Kubernetes API is not reachable from the internet. |
| HARNESS-1 | CORE, REVIEW and FEEDBACK pass for each harness configured in `factory.yaml`. |

## Upgrades and operation

- `VERSION` is the prompts' semver; `.factory/state.json` records the version
  the code was built from.
- `operate/upgrade.md` merges upstream, reads the Migration sections of
  `CHANGELOG.md` between the two versions, applies them to the current code
  (not a regeneration, so the user's own changes survive), runs unit and
  contract tests and opens a pull request in the factory repository. After
  the merge Flux deploys and `verify` runs.
- `operate/doctor-runtime.md`: Flux state, controller logs, failed Jobs,
  webhook deliveries, token expiry.
- `operate/rotate-secrets.md`, `operate/add-project.md`,
  `operate/add-integration.md` (a new adapter from a port specification and an
  integration card, or from the provider's documentation when there is no
  card).

## Developing this project

- The prompts are written first; then the installer runs on a real Hetzner
  server and sandbox account, and the prompts change until `verify` passes,
  once with each harness.
- CI of the upstream repository is cheap: markdown links, JSON and YAML
  examples against their schemas, every acceptance id referenced from a
  capability exists in `verify.md`. The end-to-end run is manual.
- Lessons from an earlier Linear and Azure DevOps agent system are carried
  over as general engineering knowledge only: no code, names or details of
  that system.

## Checks before writing prompts

Each is verified first; a different outcome changes this document.

1. OpenCode headless mode: JSON event stream, continuing a session, tool
   permissions in config, OpenRouter provider configuration.
2. Pulling private images from ghcr: whether a fine-grained token can read
   packages; otherwise a classic token with `read:packages`.
3. GitHub App manifest flow with a `localhost` redirect.
4. Let's Encrypt HTTP-01 for the user's host through Traefik and cert-manager
   (shown by INSTALL-2 in the end-to-end run of the installer).
5. k3s, Flux, cert-manager and one turn on the smallest suitable Hetzner
   server: memory and CPU; the recommended server size.
6. k3s NetworkPolicy enforcement for the egress rules above, including the
   Hetzner metadata address.
7. Pushes and pull requests made with an App installation token trigger the
   repository's Actions workflows and deliver `check_run` and `workflow_run`
   events to the App.
8. Installation tokens restricted to one repository and a subset of
   permissions at creation time.

### Check results (Plan 1, 2026-10-01)

- Hostnames from wildcard DNS services (former check 4). `sslip.io`,
  `nip.io` and `traefik.me` are not on the Public Suffix List, so every
  `<ip>.sslip.io` certificate counts against one Let's Encrypt limit shared
  with all users of the service; `traefik.me` also publishes the private key
  of its wildcard certificate. A Let's Encrypt certificate for a bare IP
  address (`shortlived` profile, 160 hours, available since January 2026) was
  issued in about 85 seconds by cert-manager 1.21.1 through an HTTP-01
  Ingress solver on k3s 1.36 with Traefik 3.7, but serving it to clients that
  send no SNI, GitHub included, takes over Traefik's default certificate for
  the whole node. Decision 9 therefore requires the user's own domain.
- Conditional requests for the catch-up poll. Three
  `GET /repos/{owner}/{repo}/issues/comments` requests with `If-None-Match`
  returned `304` and left `X-RateLimit-Remaining` unchanged (a user token;
  Plan 2 repeats it with an installation token). The repository Events API is
  not suitable: GitHub documents its latency as 30 seconds to 6 hours.

## Risks

- Generated code differs between installations; only behaviour is fixed by
  the specification and `verify`. Bugs found in one installation are fixed in
  the prompts and reach others through upgrades.
- Upgrade migrations applied by an agent to code it did not write can fail;
  the upgrade lands as a pull request and `verify` gates it.
- The runtime agent's model key sits in the agent container and is readable
  by the code the agent runs; accepted, the key can be revoked.
- A public HTTPS endpoint on a small server; only webhooks, the status page
  and health are exposed, and webhook signatures are checked.
- The installation depends on a domain the user controls: a new server
  address needs the A record changed, and a record that no longer points at
  the server stops webhooks and certificate renewal.

## Related work

- Warp Factories: foreman plus triage, spec, implement, review and verify
  agents, factory definition as code, scorers and self-improvement. Closed
  control plane; its default agent prompts are published under MIT.
- Cyrus (Apache-2.0): Claude Code agent for Linear agent sessions, GitHub and
  GitLab; per-issue worktrees on one host; an orchestrator prompt that splits
  issues into sub-issues.
- Open-Inspect (MIT): background agents with a native Linear agent-session
  worker and brokered short-lived git tokens.
- Archon (MIT): workflow engine with YAML stage graphs and approval gates.
- HumanLayer: research, plan and implement commands driven by Linear
  statuses; the open repository is deprecated in favour of a closed product.
- GitHub Agent HQ and agent apps: native agent sessions on issues; building
  an agent app is partner-only as of September 2026.
- GitHub Agentic Workflows (`github/gh-aw`): agent workflows in markdown for
  Actions with "safe outputs", the same principle as this design's publisher.
