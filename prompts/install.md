# Install

## Purpose

Take a factory from a private copy with `.factory/state.json` to a running
factory, one phase at a time, so that an interrupted installation resumes
where it stopped.

## Inputs

- `.factory/state.json`, `factory.yaml`
- the integration cards named in each phase

## Steps

1. Read `.factory/state.json`. Run the phases below in order, skipping every
   phase whose `done` is set.
2. After each phase, add it to `.factory/state.json` with `done` (UTC,
   `date -u +%Y-%m-%dT%H:%M:%SZ`) and the outputs in the table, validate with
   `pnpm --dir tools/check validate state .factory/state.json`, commit and push.
3. When a phase fails, record nothing for it, tell the user what failed and
   what you tried, and stop. Running `install.md` again resumes here.

| Phase | Where | Outputs recorded |
|---|---|---|
| doctor | `doctor.md` | — |
| home | `doctor.md` | `repo`, `ownerType` |
| interview | `interview.md` | — |
| secrets | below | `ageRecipient` |
| github-app | below | `appId`, `appSlug` |
| server | below | `k3sVersion` |
| gitops | below | `fluxVersion` |
| verify | below | `report` |

This version ends after the verify phase with the install checks. The phases
build, deploy and handoff arrive in a later version: tell the user what is
running and that the factory itself comes with the next version of the
prompts (`git merge upstream/main`).

### Phase secrets

(Task 10)

### Phase github-app

(Task 10)

### Phase server

(Task 11)

### Phase gitops

(Task 11)

### Phase verify

(Task 12)

## Done when

- `.factory/state.json` records every phase of this version as done and
  validates against the schema.
- `verify-report.md` shows INSTALL-1 and INSTALL-2 passed.
