# GitHub Container Registry

Tested with: the pull Secret built through a pipe from an env file, with sops 3.13.3 (2026-10-01), pending the end-to-end run.

## Facts

- The images workflow pushes `ghcr.io/<owner>/<repo>/factory` and
  `…/agent` with `GITHUB_TOKEN` (`packages: write`). Pushed from the
  repository's workflow, the packages are linked to the repository and are
  private.
- Pulling a private image needs a classic personal access token with the
  scope `read:packages`; GitHub documents no other credential for the
  container registry. The user creates it at
  `https://github.com/settings/tokens/new?scopes=read:packages&description=<name>-ghcr-pull`
  and writes it into `~/.config/software-factory/<name>.ghcr.env` as
  `GHCR_TOKEN=<token>`.
- The Secret `ghcr-pull` (type `kubernetes.io/dockerconfigjson`, namespace
  `factory`) is built and encrypted through a pipe, so the token never
  appears in the conversation or on a command line; `<login>` is
  `gh api user -q .login`:

  ```bash
  printf '{"auths":{"ghcr.io":{"auth":"%s"}}}' \
    "$(printf '%s:%s' <login> "$(sed -n 's/^GHCR_TOKEN=//p' ~/.config/software-factory/<name>.ghcr.env)" | base64 | tr -d '\n')" \
  | kubectl create secret generic ghcr-pull --namespace factory \
      --type=kubernetes.io/dockerconfigjson --from-file=.dockerconfigjson=/dev/stdin \
      --dry-run=client -o yaml \
  | sops --encrypt --filename-override secrets/ghcr-pull.sops.yaml \
      --input-type yaml --output-type yaml /dev/stdin > secrets/ghcr-pull.sops.yaml
  ```

  `printf` is a shell builtin, so the token is not in any process's
  arguments.

## Pitfalls

- Image paths must be lower case: `ghcr.io/Acme/Shop` is refused.
- A token without `read:packages` makes pods fail with `ImagePullBackOff`
  and a `403` in `kubectl describe pod`.
- An expired or revoked token stops only new pulls: running pods keep
  running, the next deploy fails.
- A fine-grained token or the App's installation token is not documented to
  work with the container registry; use the classic token.

## Smoke test

```bash
.factory/bin/kube kubectl -n factory get pods -l app.kubernetes.io/name=factory-controller   # Running, not ImagePullBackOff
```
