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
   `date -u +%Y-%m-%dT%H:%M:%SZ`) and the outputs in the table, check it
   against `prompts/spec/state.schema.json` as in `doctor.md`, commit and push.
3. When a phase fails, record nothing for it, tell the user what failed and
   what you tried, and stop. Running `install.md` again resumes here.
4. Before every push, `git pull --rebase origin main`: from the build phase
   on, the images workflow also commits to `main`.

| Phase | Where | Outputs recorded |
|---|---|---|
| doctor | `doctor.md` | — |
| home | `doctor.md` | `repo`, `ownerType` |
| interview | `interview.md` | — |
| secrets | below | `ageRecipient` |
| github-app | below | `appId`, `appSlug` |
| server | below | `k3sVersion` |
| gitops | below | `fluxVersion`, `certManagerVersion` |
| build | below | `commit` |
| deploy | below | `imageTag` |
| verify | below | `report` |
| handoff | below | — |

### Phase secrets

Uses `integrations/sops-age.md`. `<name>` is `name` in `factory.yaml`.

1. `mkdir -p ~/.config/software-factory && chmod 700 ~/.config/software-factory`
2. When `~/.config/software-factory/<name>.agekey` does not exist:
   `age-keygen -o ~/.config/software-factory/<name>.agekey && chmod 600 ~/.config/software-factory/<name>.agekey`.
   Never overwrite an existing key.
3. Write `.sops.yaml` as in the card, with the recipient from
   `age-keygen -y ~/.config/software-factory/<name>.agekey`.
4. Create the env file `~/.config/software-factory/<name>.env` (mode 600)
   with two empty keys, `CLAUDE_CODE_OAUTH_TOKEN=` and `ANTHROPIC_API_KEY=`.
   Do not overwrite an existing file.
5. Tell the user to fill in one of them and delete the other line, in an
   editor, then reply "done":
   - `CLAUDE_CODE_OAUTH_TOKEN`: with a Claude Pro or Max subscription, for
     personal use. The user runs `claude setup-token` in a separate terminal
     (not in this session: it prints the token) and pastes the token into
     the file. It is valid for a year.
   - `ANTHROPIC_API_KEY`: an Anthropic API key, for organisations.

   Do not ask for the value in chat and do not run `claude setup-token`
   yourself.
6. Check without reading the value: `grep -cE '^[A-Z_]+=.+' <env-file>` is at
   least 1 and `grep -cE '^[A-Z_]+=$' <env-file>` is 0.
7. `mkdir -p secrets` and encrypt the env file into
   `secrets/factory-model.sops.yaml` (Secret `factory-model`, namespace
   `factory`) with the command in the card.
8. Check: `grep -c 'ENC\[' secrets/factory-model.sops.yaml` is at least 1 and
   `SOPS_AGE_KEY_FILE=~/.config/software-factory/<name>.agekey sops --decrypt secrets/factory-model.sops.yaml > /dev/null`
   succeeds.
9. The token for pulling the factory's images (`integrations/ghcr.md`):
   create `~/.config/software-factory/<name>.ghcr.env` (mode 600) with
   `GHCR_TOKEN=` unless it exists. Tell the user to open
   `https://github.com/settings/tokens/new?scopes=read:packages&description=<name>-ghcr-pull`,
   create the classic token with only `read:packages`, paste it into that
   file, save and reply "done". Check it as in step 6, build
   `secrets/ghcr-pull.sops.yaml` with the card's pipe and check it as in
   step 8.
10. Tell the user to back up `~/.config/software-factory/<name>.agekey` now
   (a password manager): without it every secret must be created again.
11. Commit `.sops.yaml` and `secrets/`. Record `ageRecipient`.

### Phase github-app

Uses `integrations/github-app.md`.

When `secrets/github-app.sops.yaml` already exists, the App was created by an
earlier, interrupted run: do not create another one. Skip to step 3 and run
the script with `--check-only`.

1. Write `.factory/bin/github-app.mjs`, a Node script without dependencies
   that:
   - runs from the repository root and, before it serves anything, checks
     that it can encrypt: it pipes a dummy Secret through the sops command
     below into `/dev/null`, and exits 1 when that fails, so a sops problem
     shows before the user creates the App;
   - listens on `127.0.0.1:8765`;
   - serves `/` as an HTML page that posts the manifest to the creation URL
     for the owner type in `phases.home.ownerType` (user or organisation
     URL from the card) with a random `state`;
   - uses this manifest: `name` `<name>`, `url`
     `https://github.com/<home.repo>`, `hook_attributes`
     `{ url: "https://<runtime.ingress.host>/webhooks/github", active: true }`,
     `redirect_url` `http://127.0.0.1:8765/callback`, `public: false`, and the
     permissions and events from the card;
   - on `/callback` checks `state` and converts the code, then, before
     anything else, pipes a Secret manifest `github-app` (namespace
     `factory`, `stringData`: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`,
     `GITHUB_WEBHOOK_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`,
     every value a string, the App id too) into
     `sops --encrypt --filename-override secrets/github-app.sops.yaml --input-type yaml --output-type yaml /dev/stdin`
     (the creation rule in `.sops.yaml` supplies the recipient; see the sops
     card) and writes the result to `secrets/github-app.sops.yaml`. The
     private key exists only in this response, so when the write fails the
     script keeps running and retries every 10 seconds, printing the error,
     until it succeeds. Only then it redirects the browser to
     `https://github.com/apps/<slug>/installations/new`. The plaintext exists
     only in the script's memory;
   - with `--deliveries`, prints the last 20 webhook deliveries
     (`GET /app/hook/deliveries`: event, status code, time) and exits; with
     `--webhook-url <url>`, sets the App's webhook URL
     (`PATCH /app/hook/config`) and exits; both read the key like
     `--check-only`;
   - then polls `GET /app/installations` with an App JWT every 5 seconds,
     for at most 10 minutes, until one exists; lists its repositories with an
     installation token;
   - prints only `appId`, `slug`, the installation account and the
     repository names, and exits 0; exits 1 with a message on any error.
     Messages name the step and the HTTP status, never a response body, the
     key or a secret.
2. Start it in the background and tell the user: open
   `http://127.0.0.1:8765/` in a browser on this machine, check the name,
   click "Create GitHub App", then on the next page choose the project
   repositories and click "Install". When GitHub says the name is taken by an
   App the user created in an earlier, interrupted run, ask them to delete
   that App first (`https://github.com/settings/apps/<slug>/advanced`, or
   `https://github.com/organizations/<org>/settings/apps/<slug>/advanced`)
   instead of creating a second one.
3. Wait for the script to exit. Every project repository in `factory.yaml`
   must be in its list; when one is missing, ask the user to add it at
   `https://github.com/apps/<slug>/installations/new` and run the check
   again (the script can be run with `--check-only` to skip creation: it then
   reads the App id and key from `secrets/github-app.sops.yaml` via
   `sops --decrypt` inside the script, with `SOPS_AGE_KEY_FILE` set to the age
   key file).
4. Commit `.factory/bin/github-app.mjs` and `secrets/github-app.sops.yaml`.
   Record `appId` and `appSlug`.

### Phase server

Uses `integrations/server-ssh.md` and `integrations/k3s.md`. `<ssh>` is
`runtime.server.ssh`, `<ip>` its address, `<node>` the output of
`ssh <ssh> hostname` in lower case (k3s names the node after it).

1. Preflight over SSH:
   `ssh <ssh> 'command -v k3s docker; ss -ltnp; ufw status; systemctl is-active firewalld; nft list ruleset 2>/dev/null | grep -c "^table"'`.
   - k3s is present and `~/.config/software-factory/<name>.kubeconfig`
     exists: an earlier run of this phase may have installed it. Write
     `.factory/bin/kube` as in step 5 and run
     `.factory/bin/kube kubectl get nodes -o name`. When it prints exactly
     `node/<node>`, continue at step 6; otherwise treat the server as below.
   - Stop and ask the user when k3s is present otherwise, Docker is
     installed, a process other than sshd listens on an address other than
     `127.0.0.x` or `::1`, ufw or firewalld is active, or nftables has
     tables. This phase installs on a fresh server only, and enabling the
     firewall would cut off whatever the server already serves.
2. Firewall: run the ufw commands from the k3s card over SSH.
3. k3s: find the current stable version and install it with the commands in
   the card; check `ssh <ssh> 'k3s --version'`.
4. Kubeconfig, without printing it:
   `ssh <ssh> 'cat /etc/rancher/k3s/k3s.yaml' > ~/.config/software-factory/<name>.kubeconfig && chmod 600 ~/.config/software-factory/<name>.kubeconfig`,
   then `KUBECONFIG=~/.config/software-factory/<name>.kubeconfig kubectl config set-cluster default --server=https://127.0.0.1:16443`.
5. Write `.factory/bin/kube`, with `<ssh>` and `<name>` replaced by the
   values from `factory.yaml`, and `chmod +x` it:

   ```bash
   #!/usr/bin/env bash
   # Runs a command against this factory's cluster: opens the SSH tunnel to the
   # Kubernetes API unless it is open, then runs the command with KUBECONFIG set.
   # Usage: .factory/bin/kube kubectl get nodes
   set -euo pipefail
   # Written by the server phase from factory.yaml.
   ssh_target='<ssh>'
   kubeconfig="$HOME/.config/software-factory/<name>.kubeconfig"
   if ! nc -z 127.0.0.1 16443 2>/dev/null; then
     ssh -fN -o ExitOnForwardFailure=yes -L 16443:127.0.0.1:6443 "$ssh_target" </dev/null >/dev/null
   fi
   exec env KUBECONFIG="$kubeconfig" "$@"
   ```

   Run every `kubectl` and `flux` command of this installation through it
   (`.factory/bin/kube kubectl ...`, `.factory/bin/kube flux ...`). Each
   command runs in a fresh shell, so an exported `KUBECONFIG` does not carry
   over, and a bare `kubectl` acts on whatever cluster the user's own
   configuration selects. Check that `.factory/bin/kube kubectl get nodes -o name`
   prints exactly `node/<node>` and that the node is Ready.
6. Check that the API is closed from outside: `nc -z -w5 <ip> 6443` fails.
7. Check that port 80 reaches Traefik from outside: within 2 minutes,
   `curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://<ip>/` prints
   `404`. When it does not, a firewall in front of the server blocks port 80,
   or ufw blocks the traffic to Traefik: tell the user what you see and stop.
   Let's Encrypt needs port 80 in the gitops phase.
8. Commit `.factory/bin/kube`. Record `k3sVersion`.

### Phase gitops

Uses `integrations/flux.md`, `integrations/sops-age.md` and
`integrations/ingress.md`. Run every `kubectl` and `flux` command through
`.factory/bin/kube` (see the server phase).

1. Check that `.factory/bin/kube kubectl get nodes -o name` prints exactly
   `node/<node>` (the server's hostname in lower case); when it does not,
   stop: the bootstrap would go to another cluster. Then
   `.factory/bin/kube flux check --pre`.
2. Bootstrap with the command from the Flux card, run through
   `.factory/bin/kube` (`--personal=true` when `phases.home.ownerType` is
   `User`), then `git pull --rebase origin main`.
3. Give Flux the age key (a bootstrap step, so direct kubectl is allowed):
   `.factory/bin/kube kubectl -n flux-system create secret generic sops-age --from-file=age.agekey=$HOME/.config/software-factory/<name>.agekey`.
   When it already exists, leave it.
4. Write `infra/base/`: `namespaces.yaml` (Namespaces `factory` and
   `cert-manager`) and `cert-manager.yaml`: a HelmRepository `jetstack`
   (`source.toolkit.fluxcd.io/v1`, namespace `cert-manager`, url
   `https://charts.jetstack.io`, interval `1h`) and a HelmRelease
   `cert-manager` (`helm.toolkit.fluxcd.io/v2`, namespace `cert-manager`,
   chart `cert-manager` at the latest release (see the ingress card), from that
   HelmRepository, values `crds: { enabled: true }`, interval `1h`).
5. Write `infra/config/cluster-issuer.yaml` with the ClusterIssuer from the
   ingress card, `email` from `runtime.ingress.email`.
6. Write `deploy/releases/healthz.yaml` with the placeholder Deployment,
   Service and Ingress from the ingress card, in namespace `factory`, host
   `runtime.ingress.host`, and the latest `traefik/whoami` tag. The deploy
   phase replaces it with the factory.
7. Write the Flux Kustomizations in `clusters/<name>/`. Each one is
   `kustomize.toolkit.fluxcd.io/v1` in namespace `flux-system`, with
   `sourceRef: { kind: GitRepository, name: flux-system }`, `interval: 10m`
   and `prune: true`:
   - `infra.yaml`: Kustomization `infra` (path `./infra/base`, `wait: true`)
     and Kustomization `infra-config` (path `./infra/config`,
     `dependsOn: [infra]`, `wait: true`);
   - `secrets.yaml`: Kustomization `secrets` (path `./secrets`,
     `dependsOn: [infra]`, `decryption: { provider: sops, secretRef: { name: sops-age } }`);
   - `apps.yaml`: Kustomization `apps` (path `./deploy/releases`,
     `dependsOn: [infra-config, secrets]`, `wait: true`).
8. Commit and push, then `.factory/bin/kube flux reconcile source git flux-system`
   and wait up to 10 minutes until `.factory/bin/kube flux get kustomizations -A`
   shows every row Ready.
9. Wait until `.factory/bin/kube kubectl -n factory get certificate` shows
   `factory-tls` Ready.
10. Record `fluxVersion` (`flux --version`) and `certManagerVersion`.

### Phase build

Uses every file under `prompts/spec/` (start with `architecture.md`) and the
cards under `integrations/`. `<owner>` is the owner of `home.repo`.

1. Sandbox. When `gh repo view <owner>/factory-sandbox` fails, create it with
   `gh repo create <owner>/factory-sandbox --private --add-readme`. In a
   scratch clone outside this repository, add a small TypeScript library: a
   `package.json` with vitest, `src/sum.ts` exporting `sum(a, b)`,
   `src/sum.test.ts`, and `.github/workflows/ci.yml` running the tests on
   pushes and pull requests; push it to `main`.
2. Ask the user to add `factory-sandbox` to the App's installation at
   `https://github.com/apps/<appSlug>/installations/new` (configure, select
   the repository, save), and wait until
   `node .factory/bin/github-app.mjs --check-only` lists it.
3. Add the sandbox to `projects` in `factory.yaml` (name `factory-sandbox`,
   the same kinds as the other projects), check the file against its schema
   and commit.
4. Generate `apps/factory` as `prompts/spec/architecture.md` describes, one
   component per commit, in this order: contracts, core, each adapter, turn,
   controller. Each component comes with the tests that its spec file lists
   under `## Tests`. Before each commit, `pnpm --dir apps/factory install`,
   `pnpm --dir apps/factory -r typecheck` and `pnpm --dir apps/factory -r test`
   pass.
5. Run the contract tests: `pnpm --dir apps/factory -r test:contract`. They
   read the App's credentials inside the test process with
   `sops --decrypt secrets/github-app.sops.yaml` and
   `SOPS_AGE_KEY_FILE=~/.config/software-factory/<name>.agekey`, never from a
   plaintext file or the command line, and remove the issues, branches and
   pull requests they create.
6. Generate the Dockerfiles, the chart `deploy/charts/factory` and the
   workflow `.github/workflows/factory-images.yml` (architecture 12 to 18),
   one commit each. Check the chart with `helm template deploy/charts/factory`.
   Do not write `deploy/releases/factory.yaml` yet: the deploy phase does.
   The workflow updates `image.tag` only when that file exists.
7. Push. The push starts the images workflow. Record `commit`, the full SHA
   of `HEAD`.

### Phase deploy

Uses `integrations/ghcr.md`, `integrations/flux.md` and
`prompts/spec/architecture.md`.

1. Find the images workflow's run for the build commit,
   `gh run list --workflow factory-images.yml --commit <phases.build.commit> --json databaseId -q '.[0].databaseId'`,
   and wait with `gh run watch <id> --exit-status`. When it fails, read
   `gh run view <id> --log-failed`, fix the cause, commit, push, and wait for
   the new run.
2. In one commit: write `deploy/releases/factory.yaml` (architecture 15) with
   `image.tag` the first 7 characters of the commit the images were built
   from, write `deploy/releases/factory-config.yaml` (architecture 16), and
   remove `deploy/releases/healthz.yaml`. Push.
3. `.factory/bin/kube flux reconcile source git flux-system`, then wait up to
   10 minutes until `.factory/bin/kube flux get helmreleases -n factory`
   shows `factory` Ready and `curl -fsS --max-time 10 https://<host>/healthz`
   prints `{"ok":true}`. On `ImagePullBackOff`, see the ghcr card's Pitfalls.
4. Record `imageTag`.

### Phase verify

Run `verify.md` against `<owner>/factory-sandbox`. A full run takes about an
hour and about 15 agent turns, which the user's model key pays for; say so
before starting. When a check fails, use the Pitfalls of the cards involved,
fix the cause by committing (generated code, chart or configuration),
redeploy, and run the failed checks again. Record `report: verify-report.md`.

### Phase handoff

Tell the user, briefly:

- How to give the factory work: mention `@<appSlug>` in an issue or a
  comment of a project repository, or add the label `factory`. Answer its
  questions with a number or in words; `@<appSlug> stop` stops a turn.
- What follows: a draft pull request, an independent review, then the pull
  request is theirs; their review comments and failing CI start new turns
  on the same pull request.
- Where the state is: `.factory/state.json` and `verify-report.md` in this
  repository, the ledger on the cluster.
- To back up `~/.config/software-factory/<name>.agekey` if they have not.

Then ask once whether they want to star the project on GitHub. Only when they
say yes, run `gh api -X PUT user/starred/belov38/software-factory`.

## Done when

- `.factory/state.json` records every phase of this version as done and
  validates against the schema.
- `verify-report.md` shows every check of `verify.md` passed.
