# Software Factory

Software as a Prompt: a set of prompts that your own coding agent (Claude Code,
OpenCode, …) follows to install a software factory on your infrastructure.
The factory takes issues, runs coding agents on them in isolated runners, has
the result reviewed by an independent agent and hands you pull requests to
merge.

## Install a factory

You need a Hetzner server with your SSH key (Ubuntu 24.04 or Debian 12,
public IPv4), a domain where you can add a DNS record, a GitHub account and a
key for Claude or OpenRouter. Then:

```bash
git clone https://github.com/belov38/software-factory.git
cd software-factory
claude        # or: opencode
```

and ask the agent to install the factory. It follows `AGENTS.md`.

Status: early alpha. The installer brings up the cluster and GitOps; the
factory itself arrives in a later version. Design:
[`docs/superpowers/specs/2026-10-01-software-factory-design.md`](docs/superpowers/specs/2026-10-01-software-factory-design.md).

Licensed under the [Apache License 2.0](LICENSE).
