@AGENTS.md

## When the prompts do not answer

Before guessing, search the discussions of the upstream project, where
installations report problems and their fixes:

```bash
gh discussion list -R belov38/software-factory --search "<words from the error>"
gh discussion view <number> -R belov38/software-factory --comments
```

`gh discussion` needs gh 2.94 or newer; with an older gh, open
https://github.com/belov38/software-factory/discussions. When nothing fits,
suggest that the user asks there, with the phase and the error, never with a
secret or the contents of an env file.
