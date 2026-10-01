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
   | gh 2.94+ | `gh --version` | `brew install gh` or `brew upgrade gh` | https://github.com/cli/cli/blob/trunk/docs/install_linux.md |
   | ssh | `ssh -V` | built in | `sudo apt-get install -y openssh-client` |
   | kubectl | `kubectl version --client` | `brew install kubectl` | https://kubernetes.io/docs/tasks/tools/install-kubectl-linux/ |
   | flux | `flux --version` | `brew install fluxcd/tap/flux` | `curl -s https://fluxcd.io/install.sh \| sudo bash` |
   | sops | `sops --version` | `brew install sops` | a release binary from https://github.com/getsops/sops/releases |
   | age | `age --version` | `brew install age` | `sudo apt-get install -y age` |
   | node 22+ | `node --version` | `brew install node` | https://github.com/nodesource/distributions |
   | jq | `jq --version` | `brew install jq` | `sudo apt-get install -y jq` |
   | curl | `curl --version` | built in | `sudo apt-get install -y curl` |
   | dig | `dig -v` | built in | `sudo apt-get install -y dnsutils` |
   | nc | `command -v nc` | built in | `sudo apt-get install -y netcat-openbsd` |

   Ask the user before installing, then install with the commands above.
3. Check GitHub access: `gh auth status` shows a logged-in account whose token
   scopes include `repo` and `workflow`. When not, ask the user to run
   `gh auth login --scopes repo,workflow` (or `gh auth refresh --scopes repo,workflow`)
   and wait. Then run `gh auth setup-git`, so that `git push` over HTTPS uses
   the same login.
4. When `.factory/state.json` records `phases.home`, skip to step 7.
   Otherwise ask the user who owns the factory repository (their account or
   an organisation they administer) and its name (default
   `<owner>-factory` in lower case; allowed characters `A-Z a-z 0-9 . _ -`;
   never the name of the upstream repository). Check the
   owner type: `gh api users/<owner> -q .type` prints `User` or
   `Organization`.
5. When `gh repo view <owner>/<name>` succeeds, the repository exists: ask
   whether it is this factory (an earlier, interrupted run created it; then
   continue with step 6) or another name should be used. Do not push into an
   existing repository that is not this factory.
6. Create the private copy and point the remotes at it. Every line is safe to
   run again after an interruption:

   ```bash
   gh repo view <owner>/<name> >/dev/null 2>&1 || gh repo create <owner>/<name> --private --description "Software factory"
   git remote get-url upstream >/dev/null 2>&1 || git remote rename origin upstream
   git remote add origin https://github.com/<owner>/<name>.git 2>/dev/null || git remote set-url origin https://github.com/<owner>/<name>.git
   if [ -z "$(git ls-remote origin main)" ]; then git push origin main; else git pull --rebase origin main; fi
   ```

7. Write `.factory/state.json` (times in UTC from `date -u +%Y-%m-%dT%H:%M:%SZ`,
   the version from `VERSION`), for example:

   ```json schema=state
   {
     "promptsVersion": "0.1.0-alpha.1",
     "phases": {
       "doctor": { "done": "2026-10-01T10:00:00Z" },
       "home": { "done": "2026-10-01T10:02:00Z", "repo": "acme/acme-factory", "ownerType": "User" }
     }
   }
   ```

   Check it against `prompts/spec/state.schema.json`: read the schema and confirm that every required key is present, every value
   has the type and pattern the schema gives, and no key appears that the
   schema does not allow.
   Then commit and push:

   ```bash
   git add .factory/state.json
   git commit -m "Start the factory installation"
   git push origin main
   ```

8. Continue with `install.md`.

## Done when

- Every check in step 2 succeeds, node's major version is 22 or more, and gh
  is 2.94 or newer (`gh discussion` needs it).
- `gh auth status` shows the `repo` and `workflow` scopes.
- `git remote get-url origin` is the private repository and
  `git remote get-url upstream` is the public one.
- `gh repo view <owner>/<name> --json visibility -q .visibility` prints `PRIVATE`.
- `.factory/state.json` matches `prompts/spec/state.schema.json` and is
  pushed.

## Never

- Force-push, or push to `upstream`.
- Make the factory repository public.
