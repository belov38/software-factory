# Architecture

## Purpose

Where the factory's code lives in the installation, how it is built, how it
runs on the cluster and how it reaches the cluster. The other files under
`prompts/spec/` say what each part does; this one fixes the names they share.
The build phase in `prompts/install.md` generates everything described here.

## Requirements

### Workspace

1. `apps/factory` is a pnpm workspace: a private root `package.json` with
   `"type": "module"`, `engines.node` `>=22.13` and a `packageManager`
   field; `pnpm-workspace.yaml` lists `packages/*` and
   `packages/adapters/*`; `apps/factory/.gitignore` ignores `node_modules`,
   `dist` and `*.tsbuildinfo`. Every package has the scripts `build` and
   `typecheck` (both `tsc -b`, which writes the ignored `dist`: `--noEmit`
   cannot be combined with project references), `test` (`vitest run
   --passWithNoTests`, unit tests only) and `test:contract` (contract tests,
   see 22, also with `--passWithNoTests`). `pnpm -r` runs the packages'
   scripts, not the root's.
2. The packages:

   | Package | Path | Responsibility |
   |---|---|---|
   | `@factory/contracts` | `packages/contracts` | zod schemas of events, findings, configuration and the bodies of the `/internal` routes; the port interfaces |
   | `@factory/registry` | `packages/registry` | maps each `kind` to its adapter and builds one set of adapters per project |
   | `@factory/core` | `packages/core` | ledger, sessions, queue, turn planning, loop limits, catch-up poll (`prompts/spec/core.md`) |
   | `@factory/controller` | `packages/controller` | the HTTP server and the process that runs the core |
   | `@factory/turn` | `packages/turn` | the steps of a turn Job (`prompts/spec/ports/runner.md`) |
   | `@factory/forge-github` | `packages/adapters/forge-github` | the forge port for GitHub |
   | `@factory/tracker-github-issues` | `packages/adapters/tracker-github-issues` | the tracker port for GitHub Issues |
   | `@factory/channel-github-comments` | `packages/adapters/channel-github-comments` | the channel port for GitHub comments |
   | `@factory/credentials-github-app` | `packages/adapters/credentials-github-app` | installation tokens |
   | `@factory/harness-claude` | `packages/adapters/harness-claude` | Claude Code as the agent |
   | `@factory/runner-k8s` | `packages/adapters/runner-k8s` | turn Jobs on Kubernetes |

3. TypeScript is strict, `module` and `moduleResolution` are `NodeNext`, each
   package is a composite project with `outDir: dist`, and the root
   `tsconfig.json` references them all. Each package's `exports` has the
   condition `"@factory/source": "./src/index.ts"` before `default`, and
   vitest resolves that condition, so tests run from the sources without a
   build.
4. Dependencies are the current releases when the code is generated:
   `fastify`, `zod`, `@kubernetes/client-node` and `yaml`; for development
   `typescript`, `vitest`, `vite` (vitest's peer) and `@types/node`, one
   version of it in the whole workspace, the one `@kubernetes/client-node`
   needs. Nothing needs a native build: SQLite is `node:sqlite`
   (`DatabaseSync`), which prints an `ExperimentalWarning` on Node 22, so
   the images start Node with `--disable-warning=ExperimentalWarning`. Other
   dependencies only where a requirement needs them.
5. Every value that crosses a package boundary or the network is parsed with
   a zod schema from `@factory/contracts` before use. The schemas of events,
   review findings and the configuration match `events.schema.json`,
   `findings.schema.json` and `factory.schema.json` in `prompts/spec/`.
6. `@factory/registry` maps each `kind` in `factory.yaml` to its module:
   forge `github`, tracker `github-issues`, channel `github-comments`,
   harness `claude`. Credentials (GitHub App) and runner (Kubernetes) have
   one implementation each. It builds the adapters once per project; each
   adapter knows its project and its repository from its binding (`repo`).
   The controller routes a webhook to the project whose repository is the
   payload's `repository.full_name`. A kind the registry does not know stops
   the controller at start with a message that names it.

### Configuration

7. The controller reads `factory.yaml` from `/etc/factory/factory.yaml` (the
   ConfigMap `factory-config`) and validates it at start. It checks the file
   every 30 seconds and exits when it changed, so Kubernetes restarts it
   with the new configuration.
8. Environment of the controller: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`,
   `GITHUB_WEBHOOK_SECRET` (from the Secret `github-app`), `FACTORY_NAMESPACE`
   (`factory`), `FACTORY_IMAGE` and `FACTORY_AGENT_IMAGE` (full references with
   tag, from the chart's values), `FACTORY_INTERNAL_URL`
   (`http://factory-controller.factory.svc:8080`) and `FACTORY_PUBLIC_URL`
   (`https://<runtime.ingress.host>`). The App's slug comes from `GET /app` at
   start, and the bot's commit address `<id>+<slug>[bot]@users.noreply.github.com`
   from the id that `GET /users/<slug>[bot]` returns.

### Controller

9. One Node process serves HTTP on port 8080 and runs the core's dispatcher,
   the catch-up poll and the reconciliation of turns with their Jobs.
10. Routes:
    - `POST /webhooks/github`: checks `X-Hub-Signature-256` against the raw
      body (`401` when it does not match), answers `202` at once and handles
      the event afterwards.
    - `GET /healthz`: `200` with `{"ok":true}` when the ledger is open.
    - `GET /s/:turn`: an HTML status page for one turn: project, work item
      link, session id and state, turn kind and state, plan, current action,
      pull request link. No logs and no transcript. `404` for an unknown id. Turn ids are random
      UUIDs, so the page cannot be guessed.
    - `GET /internal/turns/:id`, `POST /internal/turns/:id/progress`,
      `POST /internal/turns/:id/result` and `POST /internal/credentials`,
      for turn containers only, authenticated with the header
      `x-factory-nonce` (`prompts/spec/ports/runner.md`,
      `prompts/spec/ports/credentials.md`).
11. The Ingress routes only `/webhooks/github`, `/s/` and `/healthz` to the
    controller; `/internal` is reachable only inside the cluster.

### Images

12. Two images, built from `apps/factory`, named in lower case:
    - `ghcr.io/<owner>/<repo>/factory:<sha7>` (`Dockerfile`): multi-stage from
      the current `node:22-slim`, with `git` and `ca-certificates` from apt,
      the workspace installed with `pnpm install --frozen-lockfile` and built
      with `pnpm -r build`, development dependencies removed, user `node`.
      `ENTRYPOINT ["node", "--disable-warning=ExperimentalWarning"]`, default
      command `packages/controller/dist/main.js`. Turn steps run
      `packages/turn/dist/main.js <step>`.
    - `ghcr.io/<owner>/<repo>/agent:<sha7>` (`Dockerfile.agent`): `FROM` the
      factory image (build argument `FACTORY_IMAGE`), adds `curl`, `jq`,
      `ripgrep`, `python3` and `build-essential` from apt and Claude Code with
      `npm install -g @anthropic-ai/claude-code` at its current release;
      `HOME=/home/node`.
    Both Dockerfiles end with `USER 1000` (the `node` user), numeric, so that
    `runAsNonRoot` can verify it.

### Deployment

13. The Helm chart `deploy/charts/factory` renders, in the namespace
    `factory`:
    - Deployment `factory-controller`, its pods labelled
      `app.kubernetes.io/name: factory-controller` (the turn NetworkPolicy
      selects them): 1 replica, strategy `Recreate` (the
      ledger is SQLite on a ReadWriteOnce volume), service account
      `factory-controller`, the PVC `factory-ledger` at `/var/lib/factory`,
      the PVC `factory-sessions` at `/var/lib/factory-sessions` (the
      controller does not use it yet, but mounting it binds it: `local-path`
      binds a volume only for its first pod, and Helm waits for every PVC to
      be bound), the ConfigMap `factory-config` at `/etc/factory`, environment
      from 8, liveness and readiness on `/healthz`,
      `imagePullSecrets: [ghcr-pull]`, `runAsNonRoot`, `runAsUser: 1000`,
      `runAsGroup: 1000`, `fsGroup: 1000`.
    - Service `factory-controller` on 8080.
    - Ingress `factory`: class `traefik`, host `runtime.ingress.host`, TLS
      secret `factory-tls`, annotation
      `cert-manager.io/cluster-issuer: letsencrypt`, the three paths of 11.
    - PVCs `factory-ledger` (1 Gi) and `factory-sessions` (10 Gi), storage
      class `local-path`, with the annotation
      `helm.sh/resource-policy: keep`, so an uninstall never deletes the
      ledger and the transcripts. The cluster has one node, so turn pods can
      share `factory-sessions`.
    - ServiceAccount `factory-controller` and a Role in `factory` that allows
      Jobs (create, get, list, watch, delete), Secrets (create, get, patch,
      delete), Pods and `pods/log` (get, list, watch), bound to it.
    - NetworkPolicy `factory-turns` (`prompts/spec/ports/runner.md`).
    - Values: `image.repository`, `image.tag`, `agentImage.repository`
      (same tag), `host`.
14. Requests and limits: controller 100m and 256 Mi requested; the `agent`
    container 1 CPU and 2 Gi requested, 2 CPU and 6 Gi limit; every other
    turn container 50m and 128 Mi requested.
15. `deploy/releases/factory.yaml`: a HelmRelease `factory`
    (`helm.toolkit.fluxcd.io/v2`, namespace `factory`, interval `10m`) with
    `chart.spec.chart: ./deploy/charts/factory`, `reconcileStrategy:
    Revision` and `sourceRef: { kind: GitRepository, name: flux-system,
    namespace: flux-system }`, and the values of 13 (the workflow updates
    `image.tag`).
16. `deploy/releases/factory-config.yaml`: the ConfigMap `factory-config`
    with one key, `factory.yaml`, a verbatim copy of the repository's
    `factory.yaml`. Whoever changes `factory.yaml` regenerates it in the same
    commit.
17. The Flux Kustomization `apps` points at `./deploy/releases`.

### Workflow

18. `.github/workflows/factory-images.yml` runs on pushes to `main` that touch
    `apps/factory/**` or the workflow file itself, and on `workflow_dispatch`,
    with `permissions: { contents: write, packages: write }` and a
    concurrency group, so two runs never race. It logs in to ghcr with
    `GITHUB_TOKEN`, builds and pushes the factory image, then the agent image
    with `FACTORY_IMAGE` pointing at the factory image just pushed, both
    tagged with the first 7 characters of the commit SHA. Then, when
    `deploy/releases/factory.yaml` exists (the deploy phase writes it), it
    sets `image.tag` there, commits `Deploy factory images <sha7>` and
    pushes; when `main` moved in the meantime, it rebases and pushes again,
    up to three times. A commit made with
    `GITHUB_TOKEN` starts no workflow, so there is no loop. Actions are used
    at their current major versions.

### Isolation

19. Turn pods have no service account token and only the agent container
    holds the model key; no turn container holds the App's key (ISOLATION-1).
20. Turn pods reach only DNS, the controller's port 8080 and public addresses
    on 443 (ISOLATION-2).
21. The Kubernetes API stays behind the SSH tunnel; the server's firewall
    allows 22, 80 and 443 only (ISOLATION-5).

### Build

22. Contract tests (`*.contract.test.ts`) run against `<owner>/factory-sandbox`
    with the App's credentials and are excluded from `pnpm -r test`;
    `pnpm -r test:contract` runs them.
23. The build phase commits one component per commit, in this order:
    contracts, core, each adapter, registry, turn, controller, then the
    Dockerfiles, the chart and the workflow.

## Tests

- From a clean clone, `pnpm install --frozen-lockfile`, `pnpm -r typecheck`
  and `pnpm -r test` pass.
- `@factory/registry` resolves every kind in the `factory.yaml` example of
  `prompts/interview.md` and refuses an unknown kind with its name.
- The configuration parser refuses a `factory.yaml` that does not match
  `factory.schema.json`.
- The webhook route answers `401` for a wrong signature and `202` for a
  right one; `/internal/credentials` answers `403` for a wrong nonce.
- In build step 6, once the chart exists: `helm template deploy/charts/factory`
  renders; no Ingress path starts with `/internal`; the controller's
  strategy is `Recreate`; every PVC in the chart is mounted by the
  controller; the controller runs as user 1000; the NetworkPolicy
  `factory-turns` matches `prompts/spec/ports/runner.md`.
