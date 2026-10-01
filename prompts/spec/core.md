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
   - `work_items`: `project`, `repo`, `number`, `url`, `title`, `state`
     (`open`, `closed`); unique (`repo`, `number`).
   - `sessions`: `work_item_id`, `state` (`active`, `awaiting_reply`,
     `closed`), `branch` (`factory/<number>-<first 8 characters of the
     session id>`), `harness_started` (0 or 1), `options` (JSON array of the
     last question's options, or null), `created_at`, `closed_at`.
   - `changes`: `session_id`, `repo`, `number`, `url`, `branch`, `state`
     (`draft`, `in_review`, `revising`, `ready`, `merged`, `closed`),
     `head_sha`, `revision_used` (0 or 1), `ci_fixes` (consecutive CI fix
     turns), `ci_told_human` (0 or 1); unique (`repo`, `number`).
   - `turns`: `session_id`, `kind` (`work`, `review`), `reason` (`request`,
     `reply`, `revision`, `human_review`, `ci_fix`, `review`), `state`
     (`queued`, `running`, `succeeded`, `failed`, `cancelled`), `input` (what
     is new for the agent, as text), `job_name`, `created_at`, `started_at`,
     `finished_at`, `result` (JSON).
   - `events`: `delivery_id` (primary key), `type`, `project`, `payload`
     (JSON), `received_at`, `handled_at`.
   - `cursors`: primary key (`project`, `stream`), `since`, `etag`.
   - `usage`: `turn_id`, `input_tokens`, `output_tokens`, `cost_usd`.
2. Every decision reads its counters and states from the ledger, never from
   memory, so a restart changes nothing.

### Events

3. Every canonical event (`events.schema.json`) is inserted into `events`
   before it has any effect. When its `deliveryId` is already there, it is
   dropped. Adapters derive `deliveryId` from the source object, never from
   the webhook's `X-GitHub-Delivery`, so the webhook, its redelivery and the
   catch-up poll produce the same id:

   | Source | `deliveryId` |
   |---|---|
   | issue opened with a mention | `issue:<repo>#<number>:opened` |
   | label `factory` added | `issue:<repo>#<number>:labeled:factory` |
   | comment created or edited | `comment:<id>:<updated_at>` |
   | review submitted | `review:<id>` |
   | check run completed | `check:<id>:<conclusion>` |
   | pull request merged | `pr:<repo>#<number>:merged` |
   | pull request closed unmerged | `pr:<repo>#<number>:closed` |

4. An event's `ref` resolves to a work item by (`repo`, `number`), or, when a
   change has that number, to the change and its session. Comments on a
   factory pull request are feedback on its session.
5. `work.requested` (a mention or the label) on an item with no open session
   opens one and queues a work turn with reason `request`; on an item with an
   open session it acts as `work.replied`. The channel acknowledges the
   trigger at once (CORE-2).
6. `work.replied` from a human on an item or change with an open session
   queues a work turn with reason `reply` (on a change, `human_review`) whose
   input is the comment. When the session is `awaiting_reply` and the text is
   a number from 1 to the number of stored options, the input says which
   option was chosen and repeats its text (CORE-5). Replies on items without
   an open session are dropped. Comments by the App itself are dropped.
7. `work.stopped` cancels the session's running turn through the runner,
   marks it `cancelled`, drops its queued turns and says so (CORE-7).
8. `change.review_submitted` with `isBot` from the App itself is dropped (the
   core posted it). From a human, it queues a work turn with reason
   `human_review` whose input is the review's state, body and comments, and
   resets `ci_fixes` (FEEDBACK-1). There is no limit on human reviews.
9. `change.checks_failed` for a head commit other than the change's
   `head_sha` is dropped. Otherwise, while `ci_fixes` is below
   `CI_FIX_LIMIT = 2`, it increments `ci_fixes` and queues a work turn with
   reason `ci_fix` whose input is the check's name, link and log excerpt; at
   the limit it tells the human once (`ci_told_human`) and queues nothing
   (FEEDBACK-2). A human comment or review on the change resets `ci_fixes`
   and `ci_told_human`.
10. `change.merged` and `change.closed` set the change's state, close the
    session and the work item (FEEDBACK-3).

### Catch-up poll

11. Every `CATCH_UP_SECONDS = 300` seconds, per project, the core asks the
    adapters for what changed since the stored cursor: issues and issue
    comments, the reviews of open changes, and the check runs of their head
    commits, with conditional requests (the stored ETag). The adapters emit
    the same canonical events with the same `deliveryId`s as webhooks, so
    whatever a webhook already delivered is dropped by 3 (CORE-8).

### Turns

12. The queue is first in, first out. At most `limits.concurrentTurns` turns
    run at a time and at most one per session. The dispatcher runs after
    every event and every 2 seconds: it takes the oldest queued turn whose
    session has none running, marks it `running` and calls `runner.launch`.
13. A turn's input is only what is new: the request (the item's title, body
    and comments), the reply, the review, the findings to revise or the CI
    excerpt. The agent resumes the session's harness session for everything
    older (CORE-6). The prompts of work and review turns are in
    `prompts/spec/capabilities/`.
14. A work turn's result (`POST /internal/turns/:id/result`) is handled once,
    guarded by the turn's state:
    - `isError` or a failed Job: the channel says what failed, with the link
      to `/s/<turn>`; the session stays `active`.
    - A change was published: on the first change of the session, the core
      records it (`draft`), links it to the work item and queues a review
      turn (`in_review`, REVIEW-1). After a revision turn it marks the change
      ready and tells the human (REVIEW-3). After a `human_review` or
      `ci_fix` turn it tells the human what changed. It records `head_sha`.
    - The publisher refused the change (a guard of
      `prompts/spec/ports/runner.md`): the channel says why.
    - The final message ends with a question (16): the channel asks it, with
      numbered options; the session becomes `awaiting_reply` and stores the
      options.
    - Otherwise the final message is an answer: the channel posts it
      (CORE-1).
15. A review turn's result is parsed against `findings.schema.json`; an
    invalid document fails the turn and tells the human. The forge posts the
    review (REVIEW-1). Then, by verdict:
    - `accepted`: mark ready and tell the human with the summary.
    - `revise`: when `revision_used` is 0, set it to 1 and queue one revision
      work turn (`revising`) with the findings whose `needsHuman` is false
      (REVIEW-2); when all findings need a human, treat it as `human`.
    - `human`: mark ready and tell the human, naming every finding whose
      `needsHuman` is true (REVIEW-4).
    A second review result for the same change starts no revision.
16. Final message contracts, parsed here and not in the harness adapter:
    - Work: a line `QUESTION: <one question>` followed by a line
      `OPTIONS: <a> | <b> | <c>` (2 to 4 options, the recommended first)
      makes the final message a question; the text before them is its
      explanation. Anything else is an answer.
    - Review: a JSON document, bare or in one fenced code block.
17. On start, every turn in `running` is reconciled with `runner.status`: a
    Job that still runs is left alone; a finished Job whose result never
    arrived fails the turn and tells the human; no turn gets a second Job.
18. Each turn's usage from its final event is stored in `usage`.

## Tests

Unit tests with an in-memory ledger and fakes of every port:

- An event delivered by the webhook and again by the catch-up poll starts one
  turn; a redelivered webhook starts none.
- A mention on a new issue opens a session, queues one work turn and
  acknowledges the comment.
- A reply `2` to a question with three options becomes input naming the
  second option.
- A final message with `QUESTION:` and `OPTIONS:` is said as a question and
  sets `awaiting_reply`; one without them is said as an answer and creates
  no change.
- The first published change queues one review turn; `revise` with two
  findings, one needing a human, queues one revision with one finding and
  names the other to the human; a second review result for the same change
  queues nothing.
- `human` and `accepted` mark the change ready and tell the human.
- Two CI failures queue two fix turns, the third tells the human once and
  queues nothing; a human comment resets the count; a failure for an old
  head commit is dropped.
- `stop` cancels the running turn and drops the queued ones.
- With `concurrentTurns: 2`, a third turn waits; a second turn of the same
  session waits for the first.
- After a restart with one turn `running`: a running Job is left alone, a
  finished Job without a result fails the turn once, and no second Job is
  launched.
- Merge closes the session and the work item.
