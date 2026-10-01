# Contributing

Software Factory is a set of prompts. A change to the prompts is a change to
every factory built from them, so:

- Follow the conventions in `prompts/README.md`.
- Before every commit, check that relative links resolve; that every
  acceptance id used in `prompts/` is defined in the table of
  `prompts/verify.md` and every defined one is used; that every example
  fenced with `schema=<name>` matches `prompts/spec/<name>.schema.json`; that
  phase prompts have `## Purpose`, `## Steps` and `## Done when`, and cards
  have `## Facts`, `## Pitfalls`, `## Smoke test` and a `Tested with:` line;
  and that `VERSION` is semver with a matching `CHANGELOG.md` entry.
- A change to what the factory does updates the prompts, then `VERSION` and
  `CHANGELOG.md`. From 0.1.0 on, such a change needs a Migration section in
  `CHANGELOG.md`.
- Facts in integration cards are verified on a real system; the card's
  `Tested with:` line says on which versions and when.
