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
   `CLAUDE.md`, `README.md`, `LICENSE`, `CONTRIBUTING.md`, `.gitignore`,
   `VERSION`, `CHANGELOG.md`, `docs/`, `prompts/`, `tools/`,
   `.github/workflows/upstream-ci.yml`. They change only by merging
   `upstream/main`.
6. When a step needs the human (a click, a secret, a decision), say exactly
   what to do and wait for their answer.
7. Never force-push and never push to `upstream`.
8. Write everything you create (code, comments, commit messages, documents)
   in English. Commit messages are plain sentences.
