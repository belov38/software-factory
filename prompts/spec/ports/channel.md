# Channel port

## Purpose

The conversation with the human: acknowledging a request, showing progress,
answering, asking and reporting errors, and turning the human's messages
into canonical events.

## Requirements

1. The port, in `@factory/contracts`:

   ```ts
   interface Channel {
     capabilities: { nativeSession: boolean; selectOptions: boolean; editableProgress: boolean;
                     reactions: boolean; maxLength: number }
     ack(trigger: { repo: string; source: { kind: 'issue' | 'comment'; id: number } }): Promise<void>
     progress(turn: { id: string; ref: WorkRef }, state: Progress, commentId?: number): Promise<number>
     say(ref: WorkRef, message: { kind: 'answer' | 'question' | 'error'; text: string; options?: string[] }): Promise<void>
     fromWebhook(name: string, payload: unknown): CanonicalEvent[]
     poll(project: Project, cursor: Cursor): Promise<{ events: CanonicalEvent[]; cursor: Cursor }>
   }
   // Progress: { plan: { text: string; done: boolean }[]; current: string;
   //             phase: 'working' | 'done' | 'stopped' | 'failed'; statusUrl: string }
   ```

2. The adapter renders what it gets for its channel: without
   `selectOptions` a question lists numbered options (6); without
   `editableProgress` progress is posted only when the plan changes; without
   `reactions` `ack` posts a short comment. The core cuts messages longer
   than `maxLength` before calling `say` (`prompts/spec/core.md`). Adapters
   are built per project and know their project and repository.
3. `channel-github-comments` (`kind: github-comments`): `nativeSession:
   false`, `selectOptions: false`, `editableProgress: true`, `reactions:
   true`, `maxLength: 65536`.
4. `ack` adds the reaction `eyes` to the triggering comment, or to the issue
   itself when the trigger is the issue's body (CORE-2).
5. `progress` creates one status comment on the first call of a turn and
   edits that comment on every later call (CORE-3). It shows the plan as a
   checklist, the current action, the phase and the status page link. The
   caller keeps the returned comment id and calls at most every 10 seconds,
   except for the last call of the turn.
6. `say` posts a new comment. A question is the explanation, the question,
   the numbered options with the first marked as recommended, and the line
   "Reply with a number or in your own words." (CORE-5).
7. `fromWebhook('issue_comment', …)` for `created` comments only (edits are
   ignored), with `deliveryId: comment:<id>`:
   - by the App itself: nothing;
   - containing `@<app-slug> stop`, by the same rules as a mention:
     `work.stopped` (CORE-7);
   - containing a mention (as in the tracker port): `work.requested`;
   - otherwise: `work.replied`.
   The comment may be on an issue or on a pull request; the core decides what
   it belongs to.
8. `poll` lists `GET /repos/{owner}/{repo}/issues/comments?since=<cursor>&sort=updated&direction=asc&per_page=100`
   with `If-None-Match`, follows the `Link` header's next pages, keeps
   comments created after the cursor and emits what 7 would emit.

## Tests

- Unit: the three kinds of comments map to `work.stopped`,
  `work.requested` and `work.replied`; the App's own comment maps to nothing.
- Unit: a question with three options renders the numbered list with the
  first marked as recommended.
- Contract (sandbox): `ack` puts 👀 on a comment; two `progress` calls leave
  one comment whose body changed; `say` adds one comment.
