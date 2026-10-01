# GitHub issues and pull requests at runtime

Tested with: GitHub REST and GraphQL APIs, gh 2.102.0 (2026-10-01); the job and check run ids checked on a public repository, the rest pending the end-to-end run.

## Facts

- Webhook events the factory uses, with the App's subscriptions from
  `github-app.md`: `issues` (`opened`, `labeled`), `issue_comment`
  (`created`), `pull_request` (`closed`, with `pull_request.merged`),
  `pull_request_review` (`submitted`), `check_run` (`completed`). The event
  name is in `X-GitHub-Event`.
- A pull request is also an issue: comments on its conversation arrive as
  `issue_comment`, with `issue.pull_request` set.
- Catch-up endpoints, all with `If-None-Match: <etag>`; a `304` does not
  count against the rate limit:
  - `GET /repos/{owner}/{repo}/issues?state=all&sort=updated&direction=asc&since=<iso>`
    (pull requests are in the list, with `pull_request` set);
  - `GET /repos/{owner}/{repo}/issues/comments?since=<iso>&sort=updated&direction=asc`;
  - `GET /repos/{owner}/{repo}/pulls/{number}/reviews`;
  - `GET /repos/{owner}/{repo}/commits/{sha}/check-runs`.
- `POST /repos/{owner}/{repo}/pulls` with `draft: true` opens a draft. Only
  GraphQL makes it ready:
  `mutation { markPullRequestReadyForReview(input: { pullRequestId: "<node_id>" }) { pullRequest { isDraft } } }`.
- `Closes #<number>` in a pull request's body closes the issue when the pull
  request is merged into the default branch.
- `POST /repos/{owner}/{repo}/pulls/{number}/reviews` with
  `event: "COMMENT"`, a `body` and `comments: [{ path, line, side: "RIGHT", body }]`.
  The author of a pull request cannot `APPROVE` or `REQUEST_CHANGES` on it,
  and the App is the author of the factory's pull requests.
- `GET /repos/{owner}/{repo}/pulls/{number}/files` gives each file's
  `patch`; the lines an inline comment can use are the added and context
  lines of its hunks.
- An Actions check run has the same id as its job:
  `GET /repos/{owner}/{repo}/actions/jobs/{id}/logs` redirects to the plain
  text log (needs the App's `actions: read`).

## Pitfalls

- Pushes and pull requests made with `GITHUB_TOKEN` start no workflow; the
  factory pushes with an installation token, which does.
- An inline comment on a line outside the diff fails the whole review with
  `422`; put such findings in the review's body.
- `since` in the issues list filters by `updated_at`, so an old issue edited
  today comes back; the `deliveryId` keeps it from starting work twice.
- Job logs expire with the repository's log retention; a missing log gives
  `404` and the excerpt says so.

## Smoke test

```bash
gh api 'repos/<owner>/factory-sandbox/issues?state=all&per_page=1' -i | grep -iE '^(HTTP|etag)'
gh api 'repos/<owner>/factory-sandbox/issues?state=all&per_page=1' -i -H 'If-None-Match: <etag>' | head -1   # 304
```
