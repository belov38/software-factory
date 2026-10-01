# Software Factory

This repository installs and operates a software factory: a service that takes
issues, runs coding agents on them in isolated runners, has each change
reviewed by an independent agent and hands pull requests to a human. The
prompts under `prompts/` tell you, the coding agent reading this, how to do it.

## Where to start

- The user is developing Software Factory itself (changing prompts, docs or
  tools): do not start an installation; follow `CONTRIBUTING.md`.
- `.factory/state.json` does not exist: this is a fresh clone. Follow
  `prompts/doctor.md`, then `prompts/install.md`.
- `.factory/state.json` exists and a phase in `prompts/install.md` has no
  `done`: continue `prompts/install.md` at the first such phase.
- Every phase is done: do what the user asks, using `prompts/operate/` where
  it applies.

## Rules

1. Follow each prompt's Steps in order and check every item of its Done when
   before moving on.
2. Secrets: work with paths to secret files, never with their values. Do not
   print env files, do not put secret values on command lines, and do not
   repeat them in this conversation. When the user starts to paste a secret
   into the chat, stop them and point to the env file instead.
3. After every phase, record it in `.factory/state.json` (format:
   `prompts/spec/state.schema.json`), commit and push. Record no secret values
   there.
4. Change the cluster only by committing to `main` and letting Flux apply it.
   Direct `kubectl apply` or `kubectl create` is allowed only in steps that
   say so.
5. In an installation, do not edit the upstream-owned paths: `AGENTS.md`,
   `README.md`, `LICENSE`, `CONTRIBUTING.md`, `.gitignore`, `VERSION`,
   `CHANGELOG.md`, `docs/`, `prompts/`. They change only by merging
   `upstream/main`.
6. When a step needs the human (a click, a secret, a decision), say exactly
   what to do and wait for their answer.
7. Never force-push and never push to `upstream`.
8. Write everything you create (code, comments, commit messages, documents)
   in English. Commit messages are plain sentences.
9. Do not create a `CLAUDE.md` in this repository: Claude Code reads this file
   only when there is no `CLAUDE.md`.

## When the prompts do not answer

First search the discussions of the upstream project, where installations
report problems and fixes:

```bash
gh discussion list -R belov38/software-factory --search "<words from the error>"
gh discussion view <number> -R belov38/software-factory --comments
```

When nothing fits, ask there yourself, in the Q&A category:

1. Write the question to a file outside the repository: the phase and step,
   the command and its error, the version from `VERSION`, the OS. Replace
   secrets, host names, IP addresses, email addresses and private repository
   names with placeholders. Never include an env file, a kubeconfig or a key.
2. Show the user the title and the text, and post only when they agree: the
   discussion is public and carries their GitHub name.
3. Post it and give the user the link:
   `gh discussion create -R belov38/software-factory --category q-a --title "<title>" --body-file <file>`.
   Look for answers later with
   `gh discussion view <number> -R belov38/software-factory --comments`.

`gh discussion` needs gh 2.94 or newer; the doctor checks it.
