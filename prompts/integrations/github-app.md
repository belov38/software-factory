# GitHub App

Tested with: the manifest flow for a personal account with gh 2.86.0 (2026-10-01).

## Facts

- The manifest flow creates an App from a JSON manifest in two clicks. A local
  HTML page posts a form field `manifest` (the JSON) to
  `https://github.com/settings/apps/new?state=<state>` for a user account, or
  to `https://github.com/organizations/<org>/settings/apps/new?state=<state>`
  for an organisation.
- After "Create GitHub App", GitHub redirects the browser to the manifest's
  `redirect_url` with `code` and `state`. A redirect to
  `http://127.0.0.1:8765/callback` works (checked on 2026-10-01).
- `POST https://api.github.com/app-manifests/<code>/conversions`, without
  authentication, returns `201` with `id`, `slug`, `pem` (the private key),
  `webhook_secret`, `client_id` and `client_secret`.
- The factory's App requests these permissions and events:

  ```json
  {
    "default_permissions": { "contents": "write", "pull_requests": "write", "issues": "write", "checks": "read", "actions": "read", "metadata": "read" },
    "default_events": ["issues", "issue_comment", "pull_request", "pull_request_review", "pull_request_review_comment", "check_run", "workflow_run"]
  }
  ```

- The App authenticates with a JWT signed with RS256 by its private key, with
  the claims `iat` (now minus 60 seconds), `exp` (now plus 9 minutes) and
  `iss` (the App id).
- With the JWT: `GET /app/installations` lists installations and
  `POST /app/installations/<id>/access_tokens` returns an installation token
  that is valid for one hour. With that token, `GET /installation/repositories`
  lists the repositories the installation can access.
- The user installs the App at `https://github.com/apps/<slug>/installations/new`.
- A GitHub App cannot be assigned to issues and is not notified of mentions:
  the factory finds mentions in the `issues` and `issue_comment` events.
- A token can be narrowed when it is created: the body of
  `POST /app/installations/<id>/access_tokens` takes `repositories` (names)
  and `permissions` (a subset of the App's). `GET /repos/{owner}/{repo}/installation`
  (with the JWT) finds the installation of a repository.
- Webhook deliveries carry `X-Hub-Signature-256: sha256=<hex>`, the
  HMAC-SHA256 of the raw request body with the webhook secret. Compare it in
  constant time, before parsing the body. GitHub waits 10 seconds for an
  answer: answer `202` first and work afterwards.
- Pushes and pull requests made with an installation token start the
  repository's workflows, unlike those made with `GITHUB_TOKEN`.
- `GET /app/hook/deliveries` (with the JWT) lists recent deliveries with
  `event`, `status_code` and `delivered_at`; `PATCH /app/hook/config`
  changes the webhook's `url`.

## Pitfalls

- App names are unique across GitHub and at most 34 characters long. When the
  name is taken or too long, the user changes it on the creation page.
- Until the factory's controller is deployed, webhook deliveries to
  `https://<host>/webhooks/github` fail. That is expected.
- The conversion `code` works once and expires after one hour; a second
  conversion attempt fails, and the App must then be configured by hand or
  deleted and created again.
- The private key and the secrets exist in the conversion response only;
  GitHub never shows them again.

## Smoke test

`node .factory/bin/github-app.mjs --check-only` prints the App id, its slug,
the installation account and every repository the installation can access;
`--deliveries` prints the last 20 webhook deliveries with their event and
status code.
