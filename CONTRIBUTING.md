# Contributing

Software Factory is a set of prompts. A change to the prompts is a change to
every factory built from them, so:

- Follow the conventions in `prompts/README.md`.
- Run `pnpm --dir tools/check install` once, then before every commit:
  `pnpm --dir tools/check test && pnpm --dir tools/check check`.
- A change to what the factory does updates the prompts, then `VERSION` and
  `CHANGELOG.md`. From 0.1.0 on, such a change needs a Migration section in
  `CHANGELOG.md`.
- Facts in integration cards are verified on a real system; the card's
  `Tested with:` line says on which versions and when.
