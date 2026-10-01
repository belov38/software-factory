# Interview

## Purpose

Ask the user for the factory's settings and write them to `factory.yaml`.

## Inputs

- `prompts/spec/factory.schema.json`
- `.factory/state.json` (`phases.home.repo`)
- `prompts/integrations/hetzner-ssh.md`

## Steps

1. Server. Ask for the SSH address of the Hetzner server as `user@ipv4`
   (for example `root@203.0.113.10`). Run the smoke test of
   `integrations/hetzner-ssh.md`. Refuse and explain when the login fails,
   the OS is not Ubuntu 24.04 or Debian 12, the architecture is not `x86_64`,
   or the address is not a public IPv4 (an IPv6-only server cannot be used in
   this version: GitHub is not reachable over IPv6). Compare CPU, memory and
   disk with the recommended size in the card and tell the user.
2. Host and email. The factory needs a host name in a domain the user
   controls, for example `factory.example.com`; the App's webhooks and the
   certificate use it. Ask for the host and for an email for the Let's
   Encrypt account (it is written to the repository; it is not a secret).
   Tell the user to create an A record from the host to the server's IPv4 at
   their DNS provider. The record must be DNS only (in Cloudflare: proxy
   status off; a proxied record resolves to the provider's addresses), and
   the host must have no AAAA record: Let's Encrypt prefers IPv6, and the
   factory serves IPv4 only.

   Then check every 30 seconds with a public resolver until
   `dig +short A <host> @1.1.1.1` prints exactly the server's IPv4 and
   `dig +short AAAA <host> @1.1.1.1` prints nothing. An empty answer can stay
   cached for minutes when the host was looked up before the record existed;
   when the user says the record exists and the answer stays empty, ask the
   domain's own nameserver (`dig +short NS <domain>`, then
   `dig +short A <host> @<nameserver>`). After 15 minutes without a match,
   tell the user what each query prints and ask whether to keep waiting or
   to fix the record. Never continue before the addresses match.
3. Projects. Ask which GitHub repositories the factory will serve (at least
   one). For each, `gh repo view <owner>/<repo>` must succeed, and the owner
   must be the owner of the factory repository (`phases.home.repo`): the
   factory's GitHub App is private, and GitHub installs a private App only on
   the account that owns it. Refuse other owners and explain why. Name each
   project after its repository in lower case.
4. Models. Agent turns run Claude Code (`harness.kind: claude`). Ask for the
   model of work turns and of review turns; suggest `opus` and `sonnet`.
5. Limits. Suggest and confirm `concurrentTurns: 2`,
   `turnDeadlineSeconds: 3600`, `maxAgentTurns: 100`.
6. Name. Suggest the repository name in lower case (pattern
   `^[a-z][a-z0-9-]{1,38}[a-z0-9]$`).
7. Write `factory.yaml`, for example:

   ```yaml schema=factory
   name: acme-factory
   home: { forge: github, repo: acme/acme-factory }
   runtime:
     server: { ssh: root@203.0.113.10 }
     ingress: { host: factory.acme.example, email: admin@acme.example }
     harness: { kind: claude, models: { work: opus, review: sonnet } }
     limits: { concurrentTurns: 2, turnDeadlineSeconds: 3600, maxAgentTurns: 100 }
   projects:
     - name: shop
       forge: { kind: github, repo: acme/shop }
       tracker: { kind: github-issues, repo: acme/shop }
       channels: [ { kind: github-comments } ]
   ```

   Validate, commit and push:

   ```bash
   pnpm --dir tools/check validate factory factory.yaml
   git add factory.yaml && git commit -m "Record the factory settings" && git push origin main
   ```

## Done when

- `pnpm --dir tools/check validate factory factory.yaml` passes.
- The server smoke test passed and the host resolves to the server's IPv4.
- Every project repository exists.

## Never

- Ask for secret values here; keys are entered in the secrets phase, into a file.
