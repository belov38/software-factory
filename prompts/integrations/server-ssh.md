# Server over SSH

Tested with: Ubuntu 24.04, pending the end-to-end run (2026-10-01).

## Facts

- The installer uses an existing server from any provider: Ubuntu 24.04 or
  Debian 12, x86, a public IPv4, and `root` login with the user's SSH key.
- Recommended size: 4 CPU and 16 GB of memory; how much more depends on the
  workload. Besides k3s, Flux and cert-manager, the factory runs agent turns:
  Claude Code with the project's builds and tests.
- The installer needs key login without a password prompt:
  `ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new <user>@<ip> true`
  must succeed. `accept-new` records the host key of a server this machine has
  not seen yet; `BatchMode` alone refuses it.
- A firewall in front of the server (a provider's cloud firewall, for
  example) must allow inbound TCP 22, 80 and 443. The firewall on the server
  itself (ufw) is set up by the server phase.
- Most clouds run a metadata service at `http://169.254.169.254`. It is
  reachable from the server and, without a NetworkPolicy, from every pod.

## Pitfalls

- IPv6-only servers are refused in v1: GitHub (API, git, ghcr.io) is not
  reachable over IPv6.
- Arm servers run k3s, but the factory's images are built for amd64; use an
  x86 server.
- Something already listening on 80 or 443 blocks Traefik.
- A rebuilt server gets a new host key, and SSH refuses to connect: run
  `ssh-keygen -R <ip>` and connect once to accept the new key.

## Smoke test

```bash
ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 <user>@<ip> 'cat /etc/os-release; hostname; uname -m; nproc; free -m; df -h /'
```

Expected: `ID=ubuntu` with `VERSION_ID="24.04"` (or `ID=debian` with
`VERSION_ID="12"`), `x86_64`, at least 4 CPUs, and a total memory of
15000 MB or more: `free -m` shows a little less than the 16 GB of the
server, because the kernel and firmware reserve some.
