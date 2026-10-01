# Capability: feedback from pull requests

## Purpose

After the hand-over, the pull request is where the human and CI talk to the
factory: review comments and failing checks start further turns on the same
pull request, and the merge ends the session.

## Requirements

1. A human review, or a human comment on a factory pull request, starts a
   work turn on the same session and branch; its commit lands on the same
   pull request (FEEDBACK-1). Human feedback has no limit.
2. A failing check on the pull request's head commit starts a work turn
   with the check's name, its link and the excerpt of its log; more failing
   checks on the same commit join that turn. At most two such rounds, on
   two successive head commits, run in a row; after the second, the factory
   tells the human that CI still fails and waits. A human comment or review resets the
   count (FEEDBACK-2).
3. Merging the pull request closes the issue (through `Closes #<n>`), the
   work item and the session; closing it without a merge closes the session
   (FEEDBACK-3).
4. The input of a feedback turn starts with one line that says why the turn
   runs:
   - human review: "A reviewer asked for changes. Address every comment and,
     in your final message, say what you did about each.";
   - a human comment on the pull request: "A comment on the pull request asks
     for changes. Address it and say what you did in your final message.";
   - CI: "The check <name> failed on your last commit. Fix the cause; do not
     weaken or skip the test.";
   followed by the review, the comment or the log excerpt.

## Tests

Core unit tests with fakes of the ports:

- A human review on a ready pull request queues a work turn on the same
  session whose input starts with the review line (FEEDBACK-1).
- Failing checks on three successive head commits queue two fix turns and
  one message to the human; two failing checks on one commit queue one turn;
  a later human comment allows two more (FEEDBACK-2).
- `change.merged` closes the session and the work item; `change.closed`
  closes the session (FEEDBACK-3).
