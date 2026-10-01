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
