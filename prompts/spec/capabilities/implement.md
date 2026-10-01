# Capability: implement

## Purpose

The core loop: a person asks the factory something in an issue, an agent
turn answers it or makes the change, and the change arrives as a draft pull
request on its way to review.

## Requirements

1. A request is a mention of `@<app-slug>` in an issue's body or in a
   comment, or the label `factory` on an issue, in a project repository. The
   triggering comment, or the issue, gets 👀 within 10 seconds (CORE-2).
2. Every turn shows its progress in one status comment that is edited in
   place: the plan as a checklist, the current action, the link to its
   status page, and at the end whether it finished, stopped or failed
   (CORE-3).
3. A question about the code gets an answer as a new comment and no pull
   request (CORE-1).
4. A request for a change gets a draft pull request from the branch
   `factory/<issue number>-<first 8 characters of the session id>`. Its body
   ends with `Closes #<issue number>`, so merging it closes the issue
   (CORE-4). Then the review of `prompts/spec/capabilities/review.md` runs.
5. When the agent needs a decision, it asks one question with 2 to 4
   options; a reply with a number, or in words, continues the work (CORE-5).
6. A follow-up comment on the issue continues the same agent session: the
   agent sees only what is new and remembers the rest (CORE-6).
7. `@<app-slug> stop` cancels the running turn and the factory says so
   (CORE-7).
8. A mention made while webhook deliveries fail is picked up by the
   catch-up poll within `CATCH_UP_SECONDS` (CORE-8).
9. The system prompt of a work turn, appended to Claude Code's own, with
   `<repo>` and `<number>` filled in:

   ```text
   You are a software engineer working on the repository <repo> for issue #<number>.
   The current directory is a clone of the repository on the branch for this issue.
   Read /work/context.md first: it holds the issue, the conversation and, under
   "New since your last turn", what you must act on now.

   Do what the newest message asks. When it is a question, answer it and do not
   change files. When it asks for a change, make it, keep it as small as the
   request allows, and run the project's tests and linters that you can find.

   Do not commit, push or create branches: the factory publishes your working
   tree when you finish. Do not change anything under .github/workflows/.
   Never print, copy or write the values of environment variables or secrets.

   When you cannot continue without a decision from a human, end your final
   message with exactly two lines:
   QUESTION: <one question>
   OPTIONS: <recommended option> | <option> | <option>

   When you changed files, start your final message with one line that sums
   up the change, then a section "What changed" and a section "Test plan"
   (what you ran and what a reviewer should check). Otherwise your final
   message is your answer, in Markdown.
   ```

## Tests

Core unit tests with fakes of the ports, one per scenario:

- A question in an issue: one work turn, the answer is said, no change is
  opened (CORE-1).
- A mention gets `ack` before the turn is queued (CORE-2).
- A turn's progress calls reuse one comment id (CORE-3).
- A turn that changed files: a draft is opened whose body ends with
  `Closes #<n>`, and a review turn is queued (CORE-4).
- A final message with QUESTION and OPTIONS, then a reply `1`: the second
  turn's input names the first option (CORE-5).
- A follow-up after a finished turn: the second turn resumes the same
  harness session in the same working directory (CORE-6).
- `stop` during a turn: the turn is cancelled and the channel says so
  (CORE-7).
- A mention that only the poll sees starts the same turn a webhook would
  (CORE-8).
