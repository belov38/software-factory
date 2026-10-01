# Forge port

## Purpose

Where changes live: branches, pull requests, reviews and checks. The forge
opens and updates the factory's pull requests, posts its reviews, reads
review threads and check logs, and turns the forge's events into canonical
events.

## Requirements

1. The port, in `@factory/contracts`:

   ```ts
   interface Forge {
     capabilities: { draft: boolean; reviews: boolean; checks: 'webhook' | 'poll' | 'none';
                     closesKeyword: string }
     targetBranch(repo: string): Promise<string>
     findChange(repo: string, branch: string): Promise<Change | null>
     openDraft(input: { repo: string; branch: string; base: string; title: string; body: string }): Promise<Change>
     update(change: Change, input: { title?: string; body?: string }): Promise<void>
     markReady(change: Change): Promise<void>
     comment(change: Change, text: string): Promise<void>
     postReview(change: Change, review: Findings): Promise<void>
     reviewThreads(change: Change, sinceReviewId?: number): Promise<{ reviewId: number; path?: string; line?: number; body: string }[]>
     checkLog(change: Change, checkId: number): Promise<string>
     fromWebhook(name: string, payload: unknown): CanonicalEvent[]
     poll(project: Project, cursor: Cursor, open: Change[]): Promise<{ events: CanonicalEvent[]; cursor: Cursor }>
   }
   // Change: { repo, number, url, branch, headSha, state: 'draft' | 'open' | 'merged' | 'closed' }
   ```

2. `forge-github` (`kind: github`): `draft: true`, `reviews: true`,
   `checks: 'webhook'`, `closesKeyword: 'Closes'`.
3. Only branches under `factory/` are the factory's: events about other
   pull requests produce nothing.
4. `openDraft` creates a draft pull request against the repository's default
   branch. Its body is the work turn's summary, "What changed", "Test plan"
   and the line `Closes #<issue number>` (CORE-4).
5. `markReady` uses the GraphQL mutation `markPullRequestReadyForReview`; the
   REST API has no such call.
6. `postReview` posts a review with `event: COMMENT`, never `APPROVE` or
   `REQUEST_CHANGES`: the App opened the pull request and GitHub refuses those
   from its author. The body starts with `Verdict: <verdict>`, then the
   summary, then every finding that has no line in the diff. Findings with a
   `file` and `line` on an added or changed line of the diff become inline
   comments (side `RIGHT`). Each finding shows its severity and, when
   `needsHuman` is true, "needs a human decision".
7. `checkLog` returns the last 200 lines of the failing job's log, at most
   20000 characters, from
   `GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs` (an Actions check
   run has the job's id), or the check run's output text for other checks.
8. `fromWebhook`:
   - `pull_request` `closed`: `change.merged` (`merged: true`) or
     `change.closed`, `deliveryId: pr:<repo>#<number>:merged` or `…:closed`;
   - `pull_request_review` `submitted`: `change.review_submitted` with
     `isBot` true when the reviewer is a bot, the review's comments, and
     `deliveryId: review:<id>`;
   - `check_run` `completed` with conclusion `failure` or `timed_out` on the
     head of a factory pull request: `change.checks_failed` with the log
     excerpt and `deliveryId: check:<id>:<conclusion>` (FEEDBACK-2).
9. `poll` reads, for each open change, its reviews and the check runs of its
   head commit, with `If-None-Match`, and emits what 8 would emit.

## Tests

- Unit: `postReview` sends `event: COMMENT`; a finding on a line in the diff
  becomes an inline comment, a finding outside the diff goes into the body;
  the body starts with the verdict.
- Unit: the draft's body ends with `Closes #<n>`.
- Unit: events about a branch outside `factory/` produce nothing.
- Unit: a failed check on a commit that is not the head of a factory pull
  request produces nothing.
- Contract (sandbox): `openDraft` creates a draft; `markReady` makes it ready;
  `postReview` adds a COMMENT review with one inline comment; `checkLog`
  returns the tail of a failing job's log.
