# Flux

Tested with: Flux v2.9.5 (CLI on macOS, 2026-10-01), pending the end-to-end run.

## Facts

- `flux` acts on the cluster in `KUBECONFIG`; in an installation every
  command runs through `.factory/bin/kube` (see `k3s.md`).
- `.factory/bin/kube flux check --pre` checks that the cluster can run Flux.
- Bootstrap with the user's GitHub login, from the repository root; the
  token goes to `flux` through the environment, never on the command line:

  ```bash
  GITHUB_TOKEN=$(gh auth token) .factory/bin/kube flux bootstrap github \
    --owner=<owner> --repository=<repo> --branch=main \
    --path=clusters/<name> --private=true --personal=<true|false>
  ```

  `--personal=true` when the owner is a user account, `false` for an
  organisation. Bootstrap installs the controllers, adds a read-only deploy
  key to the repository and commits `clusters/<name>/flux-system/` to `main`,
  so run `git pull --rebase origin main` afterwards.
- The token is used only during bootstrap; the cluster pulls with the deploy
  key.
- A Kustomization with `dependsOn` waits for the named Kustomizations to be
  Ready; with `wait: true` it is Ready only when its objects are. This orders
  CRDs before objects that use them.
- A Kustomization's path without a `kustomization.yaml` gets one generated
  from every manifest under it.
- Status and a manual sync:

  ```bash
  .factory/bin/kube flux get kustomizations -A
  .factory/bin/kube flux get helmreleases -A
  .factory/bin/kube flux reconcile source git flux-system
  ```

## Pitfalls

- A ClusterIssuer in the same Kustomization as the cert-manager HelmRelease
  fails on the first run because the CRDs do not exist yet. They live in two
  Kustomizations, the second with `dependsOn` on the first.
- Bootstrap pushes to `main`: a local `main` that is behind must be rebased
  before the next push, never force-pushed.
- Editing objects with `kubectl` after bootstrap is undone at the next sync;
  change the repository instead.

## Smoke test

```bash
.factory/bin/kube flux check
.factory/bin/kube flux get kustomizations -A     # flux-system shows Ready True
```
