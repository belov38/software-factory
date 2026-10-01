@AGENTS.md

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
