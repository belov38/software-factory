# Core

## Purpose

The core decides what the factory does: it records every event in the
ledger, keeps sessions and their pull requests, queues turns, enforces the
loop limits and turns each turn's final message into the next step. It talks
to the outside only through the ports in `prompts/spec/ports/` and is tested
with fakes of them.

## Requirements

### Ledger

1. The ledger is SQLite (`node:sqlite`) at `/var/lib/factory/ledger.db` in WAL
   mode. Numbered migrations run at start. Tables, with an `id` UUID primary
   key unless said otherwise:
   - `work_items`: `project`, `repo`, `number`, `url`, `title` (both from
     `tracker.getWorkItem` when the item is first seen), `state` (`open`,
     `closed`); unique (`repo`, `number`).
   - `sessions`: `work_item_id`, `state` (`active`, `awaiting_reply`,
     `closed`), `branch` (`factory/<number>-<first 8 characters of the
     session id>`), `harness_started` (0 or 1), `options` (JSON array of the
     last question's options, or null), `created_at`, `closed_at`.
   - `changes`: `session_id`, `repo`, `number`, `url`, `branch`, `state`
     (`draft`, `in_review`, `revising`, `ready`, `merged`, `closed`),
     `head_sha`, `revision_used` (0 or 1), `ci_fixes` (consecutive CI fix
     rounds), `ci_fix_sha` (the head commit the last fix round was for),
     `ci_told_human` (0 or 1); unique (`repo`, `number`).
   - `turns`: `session_id`, `kind` (`work`, `review`), `reason` (`request`,
     `reply`, `revision`, `human_review`, `ci_fix`, `review`), `state`
     (`queued`, `running`, `succeeded`, `failed`, `cancelled`), `input` (what
     is new for the agent, as text), `nonce_hash` (SHA-256 of the turn's
     nonce), `progress` (JSON: the latest plan, current action and phase, for
     the status page), `job_name`, `created_at`, `started_at`,
     `finished_at`, `result` (JSON).
   - `events`: `delivery_id` (primary key), `type`, `project`, `payload`
     (JSON), `received_at`, `handled_at`, `attempts`, `error`.
   - `cursors`: primary key (`project`, `stream`), `since`, `etag` (JSON: one
     ETag per URL the stream reads).
   - `usage`: `turn_id`, `input_tokens`, `output_tokens`, `cost_usd`.
   - `outbox`: calls to the outside that a decision requires (`ack`, `say`,
     `link`, `post_review`, `mark_ready`), with `payload` (JSON), `attempts`,
     `next_at`, `done_at` and `error`.
2. Every decision reads its counters and states from the ledger, never from
   memory, so a restart changes nothing.

### Events

3. Every canonical event (`events.schema.json`) is inserted into `events`
   before it has any effect. When its `deliveryId` is already there, it is
   dropped. Events are handled one at a time, in the order they arrive. An
   event whose handling throws keeps `handled_at` empty, records the error
   and is retried every 60 seconds, at most 5 attempts in all. Adapters
   derive `deliveryId` from the source object, never from the webhook's
   `X-GitHub-Delivery`, so the webhook, its redelivery and the catch-up poll
   produce the same id:

   | Source | `deliveryId` |
   |---|---|
   | issue opened with a mention | `issue:<repo>#<number>:opened` |
   | label `factory` added | `issue:<repo>#<number>:labeled:factory` |
   | comment created (edits are ignored) | `comment:<id>` |
   | review submitted | `review:<id>` |
   | check run completed | `check:<id>:<conclusion>` |
   | pull request merged | `pr:<repo>#<number>:merged` |
   | pull request closed unmerged | `pr:<repo>#<number>:closed` |

4. An event's `ref` resolves to a work item by (`repo`, `number`), or, when a
   change has that number, to the change and its session. Comments on a
   factory pull request are feedback on its session. Requests on a pull
   request that is not a factory change are dropped in v1. Events from any
   bot, the App included, start nothing. A project's adapters come from
   `@factory/registry`; v1 uses the project's first channel for `ack`,
   `progress` and `say`, and reads the events of all of them.
5. `work.requested` on an item with no open session opens one and queues a
   work turn with reason `request`. On an item with an open session, a
   request whose `source.kind` is `issue` (the issue opened with a mention,
   or the label) is dropped, whatever the order in which they arrive, and a
   request from a comment acts as `work.replied`. The channel acknowledges
   every `work.requested` at once (CORE-2).
6. `work.replied` from a human on an item or change with an open session
   queues a work turn with reason `reply` (on a change, `human_review`) whose
   input is the comment. When the session is `awaiting_reply` and the text is
   a number from 1 to the number of stored options, the input says which
   option was chosen and repeats its text (CORE-5); the text counts as a
   number when it matches `^\s*(\d+)\s*[.)]?\s*$`. Replies on items
   without an open session are dropped. A human comment on a factory pull
   request queues a `human_review` turn like a review does (8).
7. `work.stopped` cancels the session's running turn through the runner,
   marks it `cancelled`, drops its queued turns and says so (CORE-7).
8. `change.review_submitted` from a bot is dropped (the App's own reviews
   are posted by the core). An approval without inline comments is dropped:
   it asks for nothing. Otherwise the core fills the review's comments with
   `forge.reviewThreads` and queues a work turn with reason `human_review`
   whose input is the review's state, body and comments; it resets
   `ci_fixes` (FEEDBACK-1). There is no limit on human reviews.
9. `change.checks_failed` for a head commit other than the change's
   `head_sha` is dropped. A fix round is per head commit: when `ci_fix_sha`
   is already this head, the failure's check name, link and excerpt are
   added to the input of that round's turn while it is still queued, and
   dropped otherwise. For a new head, while `ci_fixes` is below
   `CI_FIX_LIMIT = 2`, the core sets `ci_fix_sha`, increments `ci_fixes`
   and queues a work turn with reason `ci_fix` whose input is the check's
   name, link and log excerpt (filled with `forge.checkLog`); at the limit
   it tells the human once (`ci_told_human`) and queues nothing
   (FEEDBACK-2). A human comment or review on the change resets `ci_fixes`
   and `ci_told_human`.
10. `change.merged` sets the change's state and closes the session and the
    work item (FEEDBACK-3). `change.closed` sets the change's state and
    closes the session; the work item stays open, and a new request on it
    opens a new session.

### Catch-up poll

11. Every `CATCH_UP_SECONDS = 300` seconds, per project, the core asks the
    adapters for what changed since the stored cursor: issues and issue
    comments, the reviews of open changes, and the check runs of their head
    commits, with conditional requests (the stored ETag). The adapters emit
    the same canonical events with the same `deliveryId`s as webhooks, so
    whatever a webhook already delivered is dropped by 3 (CORE-8). A
    stream's first cursor is the time the controller first started, so the
    first poll does not replay the repository's history. For each open
    change the forge also reads the pull request itself, so a missed merge
    or close is still seen.

### Turns

12. The queue is first in, first out. At most `limits.concurrentTurns` turns
    run at a time and at most one per session. The dispatcher runs after
    every event and every 2 seconds: it takes the oldest queued turn whose
    session has none running, makes its nonce (32 random bytes, hex), stores
    the nonce's SHA-256, marks the turn `running` and calls
    `runner.launch(spec, nonce)`. A launch that fails fails the turn and
    tells the human. The session's branch is
    `factory/<issue number>-<first 8 characters of the session id>`.
13. A turn's input is only what is new: the request (the item's title, body
    and comments), the reply, the review, the findings to revise or the CI
    excerpt. The agent resumes the session's harness session for everything
    older (CORE-6); a resumed turn's `/work/context.md` holds only the new
    input and the item's link. The prompts of work and review turns are in
    `prompts/spec/capabilities/`.
14. A work turn's result (`POST /internal/turns/:id/result`) is handled once.
    In one transaction the core stores the report, moves the turn's state,
    records or updates the change, queues follow-up turns, sets the session's
    state and writes the outside calls the decision needs into `outbox`;
    then it answers `200`. The same report sent again answers `200` and
    changes nothing. The outbox is worked off afterwards and retried like
    events (3), so a failing GitHub call never loses a result. The first
    matching case wins, in this order; "tell the human" always means `say`
    on the work item:
    - `isError` or a failed Job: the channel says what failed, with the link
      to `/s/<turn>`; the session stays `active`. A failed revision turn
      marks the change ready and tells the human.
    - The publisher refused the change (a guard of
      `prompts/spec/ports/runner.md`): the channel says why.
    - The final message ends with a question (16): the channel asks it, with
      numbered options; the session becomes `awaiting_reply` and stores the
      options. When the agent also changed files, the publisher pushed the
      branch but opened no draft; the draft opens on a later turn.
    - A change was published: on the first change of the session, the core
      records it (`draft`), links it to the work item and queues a review
      turn (`in_review`, REVIEW-1). After a revision turn it marks the change
      ready and tells the human (REVIEW-3). After any other turn on an
      existing change it tells the human what changed. It records
      `head_sha`.
    - A revision turn that changed nothing: mark the change ready and tell
      the human.
    - Otherwise the final message is an answer: the channel posts it
      (CORE-1).
15. A review turn's result is parsed against `findings.schema.json`. A
    failed review turn or an invalid document marks the change ready and
    tells the human that the review failed, so the change never stays
    `in_review`. Otherwise the forge posts the review (REVIEW-1). Then, by
    verdict:
    - `accepted`: mark ready and tell the human with the summary.
    - `revise`: when `revision_used` is 0, set it to 1 and queue one revision
      work turn (`revising`) with the findings whose `needsHuman` is false
      (REVIEW-2); the findings that need a human are named in the message
      that follows the revision. When all findings need a human, treat it as
      `human`.
    - `human`: mark ready and tell the human, naming every finding whose
      `needsHuman` is true (REVIEW-4).
    A second review result for the same change starts no revision.
16. Final message contracts, parsed here and not in the harness adapter
    (the parser lives in `@factory/contracts`, so the publisher applies the
    same rule):
    - Work: when the last two non-empty lines are `QUESTION: <one question>`
      and `OPTIONS: <a> | <b> | <c>` (2 to 4 options, the recommended
      first), the final message is a question and the text before them is
      its explanation. Anything else is an answer.
    - Review: a JSON document, bare or in one fenced code block.
17. On start and then every 60 seconds, every turn in `running` is
    reconciled with `runner.status`: a Job that still runs is left alone; a
    finished Job whose result never arrived is handled with the report the
    publisher or reporter wrote to its termination message; a finished or
    missing Job without one fails the turn and tells the human; no turn gets
    a second Job.
18. Each turn's usage from its final event is stored in `usage`.
19. The session's `harness_started` is set after its first work turn whose
    final is not an error. It is only a hint: the agent step resumes
    whenever the session's transcript exists (`prompts/spec/ports/harness.md`).
20. A message longer than the channel's `maxLength` is cut by the core so
    that it fits, ending with the link to the turn's status page.

## Tests

Unit tests with an in-memory ledger and fakes of every port:

- An event delivered by the webhook and again by the catch-up poll starts one
  turn; a redelivered webhook starts none.
- A mention on a new issue opens a session, queues one work turn and
  acknowledges the comment.
- A reply `2` to a question with three options becomes input naming the
  second option; `2.` counts, `2 apples` does not.
- An issue opened with a mention and the label starts one turn, whichever
  of the two events arrives first.
- When saying the answer fails, the result is still recorded once, the
  change and the review turn exist, and the outbox retries the call; the
  same report sent again changes nothing.
- A final message that asks a question after changing files asks it and
  opens no draft.
- An approval with a body but no inline comments starts no turn.
- A finished Job whose result never arrived but whose termination message
  holds the report is handled as if the report had arrived.
- The branch of a session is `factory/<n>-<first 8 characters of its id>`.
- A 70000-character answer is cut below 65536 characters and ends with the
  status link.
- An event whose handling throws is retried and stops after 5 attempts.
- A failed review turn, or an invalid review document, marks the change
  ready and tells the human; a revision that changed nothing does too.
- A final message with `QUESTION:` and `OPTIONS:` is said as a question and
  sets `awaiting_reply`; one without them is said as an answer and creates
  no change.
- The first published change queues one review turn; `revise` with two
  findings, one needing a human, queues one revision with one finding and
  names the other to the human; a second review result for the same change
  queues nothing.
- `human` and `accepted` mark the change ready and tell the human.
- Two failing checks on the same head commit queue one fix turn; failures
  on three successive head commits queue two fix turns and tell the human
  once; a human comment resets the count; a failure for an old head commit
  is dropped.
- `stop` cancels the running turn and drops the queued ones.
- With `concurrentTurns: 2`, a third turn waits; a second turn of the same
  session waits for the first.
- After a restart with one turn `running`: a running Job is left alone, a
  finished Job without a result fails the turn once, and no second Job is
  launched.
- Merge closes the session and the work item; closing without a merge
  closes only the session.
