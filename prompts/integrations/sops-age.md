# sops with age

Tested with: sops 3.13.3 and age 1.3.2 on macOS, with the smoke test below (2026-10-01).

## Facts

- `age-keygen -o <key-file>` writes a private key. `age-keygen -y <key-file>`
  prints its public recipient (`age1…`), which is safe to show and to commit.
- The repository's `.sops.yaml` names the recipient and what to encrypt:

  ```yaml
  creation_rules:
    - path_regex: secrets/.*\.sops\.yaml$
      encrypted_regex: ^(data|stringData)$
      age: <recipient>
  ```

- A Kubernetes Secret is encrypted from a pipe, so its plaintext never lands in
  a file inside the repository. `kubectl create --dry-run=client` needs no
  cluster. `--filename-override` makes sops apply the creation rule for the
  target path:

  ```bash
  kubectl create secret generic <secret-name> --namespace factory \
    --from-env-file <env-file> --dry-run=client -o yaml \
  | sops --encrypt --filename-override secrets/<secret-name>.sops.yaml \
      --input-type yaml --output-type yaml /dev/stdin > secrets/<secret-name>.sops.yaml
  ```

  Only `data` and `stringData` are encrypted; `kind` and `metadata` stay
  readable.
- Check that a file decrypts, without printing it:
  `SOPS_AGE_KEY_FILE=<key-file> sops --decrypt secrets/<file> > /dev/null`.
- Flux decrypts with `spec.decryption: { provider: sops, secretRef: { name: sops-age } }`
  on a Kustomization. The Secret `sops-age` in `flux-system` holds the private
  key under a key name ending in `.agekey`.

## Pitfalls

- A lost age key means every secret must be created again: back it up.
- When `.sops.yaml` exists, `sops --encrypt /dev/stdin` fails with
  `no matching creation rules found`, even with `--age`, because `/dev/stdin`
  does not match `path_regex`. Pass `--filename-override` with the target path.
- Never write plaintext into the repository, not even temporarily: a commit or
  an editor's backup file can keep it.
- `sops --decrypt` without `> /dev/null` prints the secret.

## Smoke test

In an empty scratch directory outside the repository:

```bash
age-keygen -o key.agekey
printf 'creation_rules:\n  - path_regex: secrets/.*\\.sops\\.yaml$\n    encrypted_regex: ^(data|stringData)$\n    age: %s\n' "$(age-keygen -y key.agekey)" > .sops.yaml
mkdir -p secrets && printf 'x=1\n' > dummy.env
kubectl create secret generic smoke --namespace factory --from-env-file dummy.env --dry-run=client -o yaml \
| sops --encrypt --filename-override secrets/smoke.sops.yaml --input-type yaml --output-type yaml /dev/stdin > secrets/smoke.sops.yaml
grep -c 'ENC\[' secrets/smoke.sops.yaml                                   # 1 or more
SOPS_AGE_KEY_FILE=key.agekey sops --decrypt secrets/smoke.sops.yaml > /dev/null && echo decrypts
```
