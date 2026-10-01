# Credentials port

## Purpose

Short-lived platform credentials for one repository and one purpose. Only the
controller holds the App's private key; turn containers ask the controller
for a token at the moment they need it.

## Requirements

1. The port, in `@factory/contracts`:

   ```ts
   interface Credentials {
     issue(project: Project, purpose: 'clone' | 'review-read' | 'publish' | 'channel', repo: string):
       Promise<{ kind: 'github-installation'; username: 'x-access-token'; secret: string; expiresAt: string }>
   }
   ```

2. Purposes and the permissions of their tokens:

   | Purpose | Permissions |
   |---|---|
   | `clone` | contents read, metadata read |
   | `review-read` | contents read, metadata read, pull requests read, checks read |
   | `publish` | contents write, pull requests write, metadata read |
   | `channel` | issues write, pull requests write, metadata read |

3. `credentials-github-app` signs an App JWT (RS256, `iat` now minus 60
   seconds, `exp` now plus 9 minutes, `iss` the App id), finds the
   installation with `GET /repos/{owner}/{repo}/installation` (cached), and
   creates the token with `POST /app/installations/{id}/access_tokens` and
   the body `{ "repositories": ["<repo name>"], "permissions": { … } }`. A
   token is cached per repository and purpose until 5 minutes before it
   expires.
4. `POST /internal/credentials` serves turn containers. The body is
   `{ turnId, nonce, purpose }`. The controller answers `403` unless the turn
   is `running`, the nonce matches the turn's (compared in constant time) and
   the purpose belongs to the turn's kind: work turns may ask for `clone`,
   `channel` and `publish`, review turns for `review-read`. The repository is
   always the turn's own. The answer is `{ username, secret, expiresAt }`.
5. The agent container never holds a platform token (ISOLATION-1).

## Tests

- Unit: each purpose asks for exactly its permissions and one repository.
- Unit: a wrong nonce, a finished turn, and a review turn asking for
  `publish` all get `403`.
- Unit: a second request for the same repository and purpose within the
  token's life is served from the cache.
- Contract (sandbox): a `clone` token can read the repository and cannot push
  to it; a `publish` token can push a branch under `factory/`.
