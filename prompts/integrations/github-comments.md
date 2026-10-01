# GitHub comments as the factory's channel

Tested with: GitHub REST API (2026-10-01), pending the end-to-end run.

## Facts

- Reactions: `POST /repos/{owner}/{repo}/issues/comments/{comment_id}/reactions`
  for a comment and `POST /repos/{owner}/{repo}/issues/{number}/reactions`
  for an issue's body, with `{ "content": "eyes" }`. A second identical
  reaction returns `200` instead of `201` and adds nothing.
- A new comment: `POST /repos/{owner}/{repo}/issues/{number}/comments`; an
  edit: `PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}`. Both
  work on pull requests, which are issues.
- A comment body holds at most 65536 characters.
- GitHub has no buttons in issue comments: a question lists numbered options
  and the person replies with a number or in words.
- Comments by the App show the author `<app-slug>[bot]` with `type: Bot`.

## Pitfalls

- Editing the status comment on every agent event hits the secondary rate
  limit; edit at most every 10 seconds.
- A mention inside a code block or a quote is not a request; quoting the
  factory's own question would otherwise trigger it.
- Markdown checklists (`- [ ]`) in the status comment can be ticked by
  anyone; the factory treats the comment as output only.

## Smoke test

```bash
gh api -X POST repos/<owner>/factory-sandbox/issues/<number>/comments -f body=ping -q .id
gh api -X POST repos/<owner>/factory-sandbox/issues/comments/<id>/reactions -f content=eyes -q .content   # eyes
```
