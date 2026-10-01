# Hetzner server over SSH

Tested with: Ubuntu 24.04, pending the end-to-end run (2026-10-01).

## Facts

- The installer uses an existing server: Hetzner Cloud, or a dedicated server
  from Hetzner Robot, with Ubuntu 24.04 or Debian 12.
- Recommended size until the end-to-end run measures k3s, Flux and
  cert-manager: an x86 server with 2 vCPU and 4 GB of memory, for example the
  Cloud types CX23 or CPX22. The factory's turns need more; the recommendation
  is updated when they are measured.
- Login is `root` with the SSH key chosen when the server was created. The
  installer needs key login without a password prompt:
  `ssh -o BatchMode=yes <user>@<ip>` must succeed.
- A Cloud server has a public IPv4 unless it was created IPv6-only.
- Hetzner Cloud has a metadata service at
  `http://169.254.169.254/hetzner/v1/metadata` (hostname, public keys, user
  data). It is reachable from the server and, without a NetworkPolicy, from
  every pod. Dedicated servers have none.
- A Hetzner Cloud Firewall attached to the server, or the Robot firewall of a
  dedicated server, must allow inbound TCP 22, 80 and 443. The firewall on the
  server itself (ufw) is set up by the server phase.
- The server's default reverse DNS name,
  `static.<ip in reverse order>.clients.your-server.de`, resolves to it, but
  `your-server.de` is not on the Public Suffix List: Let's Encrypt counts all
  Hetzner customers against one limit. The factory uses the user's own host
  instead (`ingress.md`).

## Pitfalls

- IPv6-only servers are refused in v1: GitHub (API, git, ghcr.io) is not
  reachable over IPv6.
- Arm servers (CAX) run k3s, but the factory's images are built for amd64;
  use an x86 type.
- Something already listening on 80 or 443 blocks Traefik.
- A rebuilt server gets a new host key, and SSH refuses to connect: run
  `ssh-keygen -R <ip>` and connect once to accept the new key.

## Smoke test

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 <user>@<ip> 'cat /etc/os-release; uname -m; nproc; free -m; df -h /'
```

Expected: `ID=ubuntu` with `VERSION_ID="24.04"` (or `ID=debian` with
`VERSION_ID="12"`), `x86_64`, at least 2 CPUs and about 3800 MB of total
memory or more.
