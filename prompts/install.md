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

### Phase github-app

Uses `integrations/github-app.md`.

When `secrets/github-app.sops.yaml` already exists, the App was created by an
earlier, interrupted run: do not create another one. Skip to step 3 and run
the script with `--check-only`.

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
     `sops --encrypt --filename-override secrets/github-app.sops.yaml --input-type yaml --output-type yaml /dev/stdin`
     (the creation rule in `.sops.yaml` supplies the recipient; see the sops
     card) and writes the result to `secrets/github-app.sops.yaml`; the
     plaintext exists only in the script's memory;
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
   reads the App id and key from `secrets/github-app.sops.yaml` via
   `sops --decrypt` inside the script, with `SOPS_AGE_KEY_FILE` set to the age
   key file).
4. Commit `.factory/bin/github-app.mjs` and `secrets/github-app.sops.yaml`.
   Record `appId` and `appSlug`.

### Phase server

Uses `integrations/hetzner-ssh.md` and `integrations/k3s.md`. `<ssh>` is
`runtime.server.ssh`, `<ip>` its address.

1. Preflight over SSH: `ssh <ssh> 'command -v k3s; ss -ltnp | grep -E ":(80|443) " ; ufw status'`.
   - k3s is present and `~/.config/software-factory/<name>.kubeconfig`
     exists: an earlier run of this phase was interrupted after installing
     it. Check that `ssh <ssh> 'k3s --version'` shows the card's version and
     continue at step 5.
   - k3s is present otherwise, something already listens on 80 or 443, or
     ufw is active with rules other than the card's: stop and ask the user.
     This phase installs on a fresh server only, and enabling the firewall
     would cut off whatever the server already serves.
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
4. Write `infra/base/`: `namespaces.yaml` (Namespaces `factory` and
   `cert-manager`) and `cert-manager.yaml`: a HelmRepository `jetstack`
   (`source.toolkit.fluxcd.io/v1`, namespace `cert-manager`, url
   `https://charts.jetstack.io`, interval `1h`) and a HelmRelease
   `cert-manager` (`helm.toolkit.fluxcd.io/v2`, namespace `cert-manager`,
   chart `cert-manager` at the version from the ingress card, from that
   HelmRepository, values `crds: { enabled: true }`, interval `1h`).
5. Write `infra/config/cluster-issuer.yaml` with the ClusterIssuer from the
   ingress card, `email` from `runtime.ingress.email`.
6. Write `deploy/healthz/` with the placeholder Deployment, Service and
   Ingress from the ingress card, in namespace `factory`, host
   `runtime.ingress.host`. The factory's controller replaces it later.
7. Write the Flux Kustomizations in `clusters/<name>/`. Each one is
   `kustomize.toolkit.fluxcd.io/v1` in namespace `flux-system`, with
   `sourceRef: { kind: GitRepository, name: flux-system }`, `interval: 10m`
   and `prune: true`:
   - `infra.yaml`: Kustomization `infra` (path `./infra/base`, `wait: true`)
     and Kustomization `infra-config` (path `./infra/config`,
     `dependsOn: [infra]`, `wait: true`);
   - `secrets.yaml`: Kustomization `secrets` (path `./secrets`,
     `dependsOn: [infra]`, `decryption: { provider: sops, secretRef: { name: sops-age } }`);
   - `apps.yaml`: Kustomization `apps` (path `./deploy`,
     `dependsOn: [infra-config, secrets]`, `wait: true`).
8. Commit and push, then `flux reconcile source git flux-system` and wait up
   to 10 minutes until `flux get kustomizations -A` shows every row Ready.
9. Wait until `kubectl -n factory get certificate` shows `healthz-tls` Ready.
10. Record `fluxVersion` (`flux --version`).

### Phase verify

(Task 12)

## Done when

- `.factory/state.json` records every phase of this version as done and
  validates against the schema.
- `verify-report.md` shows INSTALL-1 and INSTALL-2 passed.
