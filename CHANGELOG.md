# Changelog

Each version lists what changed in the prompts. From 0.1.0 on, a version that
changes the specification has a Migration section: a prompt that
`prompts/operate/upgrade.md` applies to an installation's code.

## 0.1.0-alpha.2 — unreleased

- The factory: specification prompts (architecture, core, the six ports and
  the capabilities implement, review and feedback from pull requests), the
  schemas of canonical events and review findings, cards for Claude Code,
  ghcr and GitHub at runtime, and the phases build, deploy, verify (every
  acceptance check) and handoff.
- A new human input: a classic GitHub token with `read:packages`, for
  pulling the factory's images.

## 0.1.0-alpha.1 — unreleased

- Installer phases doctor, home, interview, secrets, github-app, server and
  gitops, and the install checks INSTALL-1 and INSTALL-2 against a placeholder
  health endpoint on a host in the user's own domain. The factory itself comes
  in a later version.
