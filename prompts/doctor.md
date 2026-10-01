# Doctor

## Purpose

Check that this machine can install a factory, install what is missing, and
turn this clone into the user's private factory repository.

## Inputs

- This clone of the upstream repository.
- `.factory/state.json`, when it exists (then skip the phases it records as done).

## Steps

1. Check the OS: `uname -s` prints `Darwin` or `Linux`. On Windows the user
   runs everything inside WSL; say so and stop otherwise.
2. Check each tool and list every missing one at once:

   | Tool | Check | macOS | Debian or Ubuntu |
   |---|---|---|---|
   | git | `git --version` | `brew install git` | `sudo apt-get install -y git` |
   | gh | `gh --version` | `brew install gh` | https://github.com/cli/cli/blob/trunk/docs/install_linux.md |
   | ssh | `ssh -V` | built in | `sudo apt-get install -y openssh-client` |
   | kubectl | `kubectl version --client` | `brew install kubectl` | https://kubernetes.io/docs/tasks/tools/install-kubectl-linux/ |
   | flux | `flux --version` | `brew install fluxcd/tap/flux` | `curl -s https://fluxcd.io/install.sh \| sudo bash` |
   | sops | `sops --version` | `brew install sops` | a release binary from https://github.com/getsops/sops/releases |
   | age | `age --version` | `brew install age` | `sudo apt-get install -y age` |
   | node 22+ | `node --version` | `brew install node@22` | https://github.com/nodesource/distributions |
   | pnpm | `pnpm --version` | `corepack enable pnpm` | `corepack enable pnpm` |
   | jq | `jq --version` | `brew install jq` | `sudo apt-get install -y jq` |
   | dig | `dig -v` | built in | `sudo apt-get install -y dnsutils` |
   | nc | `command -v nc` | built in | `sudo apt-get install -y netcat-openbsd` |

   Ask the user before installing, then install with the commands above.
3. Install the checker's dependencies: `pnpm --dir tools/check install --frozen-lockfile`.
4. Check GitHub access: `gh auth status` shows a logged-in account whose token
   scopes include `repo` and `workflow`. When not, ask the user to run
   `gh auth login --scopes repo,workflow` (or `gh auth refresh --scopes repo,workflow`)
   and wait. Then run `gh auth setup-git`, so that `git push` over HTTPS uses
   the same login.
5. When `.factory/state.json` records `phases.home`, skip to step 8.
   Otherwise ask the user who owns the factory repository (their account or
   an organisation they administer) and its name (default
   `software-factory`; allowed characters `A-Z a-z 0-9 . _ -`). Check the
   owner type: `gh api users/<owner> -q .type` prints `User` or
   `Organization`.
6. When `gh repo view <owner>/<name>` succeeds, the repository exists: ask
   whether it is this factory (continue with it: set the remotes as in step 7
   and `git pull --rebase origin main`) or another name should be used. Do
   not push into an existing repository that is not this factory.
7. Create the private copy:

   ```bash
   gh repo create <owner>/<name> --private --description "Software factory"
   git remote rename origin upstream
   git remote add origin https://github.com/<owner>/<name>.git
   git push origin main
   ```

8. Write `.factory/state.json` (times in UTC from `date -u +%Y-%m-%dT%H:%M:%SZ`,
   the version from `VERSION`), for example:

   ```json schema=state
   {
     "promptsVersion": "0.1.0-alpha.1",
     "phases": {
       "doctor": { "done": "2026-10-01T10:00:00Z" },
       "home": { "done": "2026-10-01T10:02:00Z", "repo": "acme/software-factory", "ownerType": "User" }
     }
   }
   ```

   Validate, commit and push:

   ```bash
   pnpm --dir tools/check validate state .factory/state.json
   git add .factory/state.json
   git commit -m "Start the factory installation"
   git push origin main
   ```

9. Continue with `install.md`.

## Done when

- Every check in step 2 succeeds, and node's major version is 22 or more.
- `gh auth status` shows the `repo` and `workflow` scopes.
- `git remote get-url origin` is the private repository and
  `git remote get-url upstream` is the public one.
- `gh repo view <owner>/<name> --json visibility -q .visibility` prints `PRIVATE`.
- `pnpm --dir tools/check validate state .factory/state.json` passes and the
  file is pushed.

## Never

- Force-push, or push to `upstream`.
- Make the factory repository public.
