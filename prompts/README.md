# Prompt conventions

## Phase prompts

`prompts/*.md` (except this file) and `prompts/operate/*.md` have these
sections, in this order:

- `## Purpose`: one paragraph on what the prompt achieves.
- `## Inputs` (optional): the files and state it reads.
- `## Steps`: numbered actions, each with the exact command where there is
  one. Placeholders in commands are written `<like-this>` and each one says
  where its value comes from.
- `## Done when`: checks that must all pass; each can be run or observed.
- `## Never` (optional): what must not happen.

## Integration cards

`prompts/integrations/*.md` describe one external system each:

- a `Tested with:` line: versions and the date they were verified;
- `## Facts`: verified behaviour the prompts rely on;
- `## Pitfalls`: what goes wrong and how to avoid it;
- `## Smoke test`: commands that show the integration works.

Phases install the current stable release of each component and record its
version in `.factory/state.json`; cards show how to find it. The `Tested
with:` line names the last version verified with these prompts: when the
current release fails where that version works, install the tested version
and tell the user.

## Acceptance ids

Acceptance ids have the form `<AREA>-<number>`, where the area is INSTALL,
CORE, REVIEW, FEEDBACK, ISOLATION or HARNESS. They are defined only in the
table of `verify.md` and referenced by the prompts whose work they check.
Every such id in `prompts/` counts as a reference, so write one only where
the prompt relies on that check.

## Schema examples

An example that must match a schema is fenced with `yaml schema=<name>` or
`json schema=<name>` and matches `prompts/spec/<name>.schema.json`.
