# k3s

Tested with: k3s v1.36.4+k3s1 (stable channel on 2026-10-01), pending the end-to-end run.

## Facts

- Install a pinned version as root on the server:

  ```bash
  curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION=v1.36.4+k3s1 sh -s - server --write-kubeconfig-mode 600
  ```

  It creates the systemd unit `k3s`, the commands `k3s` and `kubectl`, and
  `/usr/local/bin/k3s-uninstall.sh`.
- Traefik is bundled, runs in `kube-system` and serves the ingress class
  `traefik`. ServiceLB publishes its ports 80 and 443 on the node's addresses.
- The kubeconfig is `/etc/rancher/k3s/k3s.yaml`, with the server
  `https://127.0.0.1:6443`; `--write-kubeconfig-mode 600` keeps it readable by
  root only.
- Pod CIDR `10.42.0.0/16`, service CIDR `10.43.0.0/16`. CoreDNS has the label
  `k8s-app: kube-dns`.
- `local-path` is the default storage class.
- Uninstall, which deletes the cluster and its data:
  `/usr/local/bin/k3s-uninstall.sh`.
- Firewall: the API (6443) stays closed and is reached through an SSH tunnel.
  Run as root:

  ```bash
  apt-get update && apt-get install -y ufw
  ufw default deny incoming && ufw default allow outgoing
  ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
  ufw allow from 10.42.0.0/16 && ufw allow from 10.43.0.0/16
  ufw --force enable
  ```

## Pitfalls

- Without the two `allow from` rules, pods cannot reach each other or CoreDNS.
- Never open 6443 to the internet.
- A local port 6443 may already be used by another cluster or tool on the
  user's machine, so the tunnel binds local port 16443.

## Smoke test

Through the tunnel (`.factory/bin/tunnel.sh`), and from the user's machine:

```bash
KUBECONFIG=<kubeconfig> kubectl get nodes                    # the node is Ready
nc -z -w5 <ip> 6443 && echo open || echo closed               # closed
curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 http://<ip>/   # 404 from Traefik: port 80 passes ufw
```
