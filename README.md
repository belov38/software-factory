# Software Factory

Software as a Prompt: a set of prompts that Claude Code follows to install a
software factory on your infrastructure. The factory takes issues, runs
coding agents on them in isolated runners, has the result reviewed by an
independent agent and hands you pull requests to merge.

Status: early alpha. This version installs the cluster, GitOps and the GitHub
App; the factory itself arrives in a later version.

## What you need

- A server with 4 CPU and 16 GB of memory (depends on your workload).
- A host name in a domain you control, for example `factory.example.com`.
  You add its DNS A record when the installer asks: DNS only (in Cloudflare,
  proxy off).
- If your provider has a firewall in front of the server, it allows TCP 22,
  80 and 443.
- A GitHub account, and the GitHub CLI logged in: `gh auth login`.
- Claude Code, and either a Claude Pro or Max subscription or an Anthropic API
  key.

## Install

```bash
git clone https://github.com/belov38/software-factory.git
cd software-factory
claude "install the factory"
```

The agent checks your machine and asks before installing missing tools. Your
part:

1. Answer its questions: the server, the host and an email for Let's Encrypt,
   which repositories the factory works on (they must belong to the same
   account or organisation as the factory), the models.
2. Add the DNS A record for the host when asked.
3. Put the model key into the file the agent names. Never paste it into the
   chat. With a subscription, run `claude setup-token` in another terminal
   and paste the token into that file.
4. Click "Create GitHub App" and then "Install" in the browser.
5. Back up the age key file it names (for example in a password manager).

If the session stops, run `claude "install the factory"` in the same directory
again: the installation continues where it stopped.

Questions and problems: [Discussions](https://github.com/belov38/software-factory/discussions).
