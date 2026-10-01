# Tracker port

## Purpose

Where work items come from. The tracker reads a work item with its
conversation, turns the tracker's own events into canonical events and keeps
the item's status in step with the factory where the tracker supports it.

## Requirements

1. The port, in `@factory/contracts`:

   ```ts
   interface Tracker {
     capabilities: { webhooks: boolean; statusSync: boolean }
     getWorkItem(ref: WorkRef): Promise<WorkItem>
     link(ref: WorkRef, changeUrl: string): Promise<void>
     setStatus(ref: WorkRef, status: 'working' | 'waiting' | 'done'): Promise<void>
     fromWebhook(name: string, payload: unknown): CanonicalEvent[]
     poll(project: Project, cursor: Cursor): Promise<{ events: CanonicalEvent[]; cursor: Cursor }>
   }
   // WorkRef: { kind: 'github-issue', repo, number }
   // WorkItem: { ref, title, body, url, author: { login, isBot }, labels: string[],
   //             state: 'open' | 'closed', comments: { id, author, body, createdAt }[] }
   ```

2. Without `webhooks`, the core relies on `poll` alone. Without `statusSync`,
   `link` and `setStatus` do nothing.
3. `tracker-github-issues` (`kind: github-issues`): `webhooks: true`,
   `statusSync: false`. A pull request body with `Closes #<n>` closes the
   issue on merge, so `link` and `setStatus` do nothing.
4. `fromWebhook('issues', …)`:
   - `opened` with a mention of the App in the body: `work.requested` with
     `source: { kind: 'issue', id: <number> }` and
     `deliveryId: issue:<repo>#<number>:opened`;
   - `labeled` with the label `factory`: `work.requested` with
     `deliveryId: issue:<repo>#<number>:labeled:factory`;
   - everything else, and anything the App itself did: no event.
5. A mention is `@<app-slug>`, case-insensitive, outside fenced code blocks,
   inline code and quoted lines (`>`).
6. `poll` lists `GET /repos/{owner}/{repo}/issues?state=all&sort=updated&direction=asc&since=<cursor>`
   with `If-None-Match`, and emits for each issue the events 4 would emit
   (pull requests in that list are skipped). The new cursor is the latest
   `updated_at` seen.
7. `getWorkItem` reads the issue and all its comments; the App's own
   comments are included with `isBot: true`.

## Tests

- Unit: a mention in plain text is found; in a fenced block, in inline code
  or in a quoted line it is not; `@ACME-FACTORY` matches the slug
  `acme-factory`.
- Unit: an issue opened by the App, or labelled with another label, emits
  nothing.
- Unit: the same issue seen by `fromWebhook` and by `poll` gets the same
  `deliveryId`.
- Contract (sandbox): an issue created with a mention appears in `poll` as
  `work.requested`; `getWorkItem` returns its title, body and comments.
