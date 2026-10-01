# Ingress with the user's domain

Tested with: cert-manager v1.21.2 (chart from https://charts.jetstack.io), Traefik bundled with k3s v1.36.4+k3s1 (2026-10-01), pending the end-to-end run.

## Facts

- The factory's host is a name in a domain the user controls, with an A
  record to the server's public IPv4: `dig +short <host>` prints that address.
  The App's webhooks and the certificate use it.
- Hostnames from wildcard DNS services (`sslip.io`) and certificates for bare
  IP addresses were tried and dropped; see "Check results" in the design
  document under `docs/superpowers/specs/`.
- cert-manager is installed from the Helm chart `cert-manager`, version
  `v1.21.2`, repository `https://charts.jetstack.io`, with the values
  `crds: { enabled: true }`.
- Let's Encrypt validates with HTTP-01 through Traefik: cert-manager creates a
  temporary Ingress for `/.well-known/acme-challenge/` on port 80 and removes
  it when the certificate is issued.
- The ClusterIssuer and the placeholder that answers `/healthz` until the
  factory's controller replaces it, with `<host>` and `<email>` from
  `factory.yaml`:

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
      spec: { containers: [ { name: whoami, image: traefik/whoami:v1.12.0, ports: [ { containerPort: 80 } ] } ] }
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

## Pitfalls

- A new server address needs the A record changed; the host, the certificate
  and the App's webhook URL stay.
- A CAA record on the domain, if there is one, must allow `letsencrypt.org`.
- An A record that is still propagating fails HTTP-01: wait until `dig`
  prints the server's address before the gitops phase.
- Let's Encrypt allows 5 certificates for the same host per week: do not
  delete and re-create the certificate in a loop.

## Smoke test

```bash
curl -fsS --max-time 10 https://<host>/healthz      # no -k: the certificate is valid
echo | openssl s_client -connect <host>:443 -servername <host> 2>/dev/null | openssl x509 -noout -issuer   # Let's Encrypt
```
