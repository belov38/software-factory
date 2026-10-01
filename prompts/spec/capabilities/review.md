# Capability: review

## Purpose

An independent review of every new pull request before a human sees it: a
separate agent, with its own model and a fresh clone, reviews the change,
the factory posts the review, revises once what needs no human decision, and
hands the pull request to the human.

## Requirements

1. After the first draft of a session, a review turn runs with the review
   model (`runtime.harness.models.review`), a fresh clone of the pull
   request's head and a `review-read` token. Its agent session is new; it
   does not see the work turn's session.
2. The factory posts the review on the pull request as a `COMMENT` review
   whose body starts with the verdict (REVIEW-1).
3. When the verdict is `revise`, exactly one revision work turn runs on the
   same pull request with the findings whose `needsHuman` is false
   (REVIEW-2).
4. After the review, and after the revision when there was one, the pull
   request is marked ready for review and the channel tells the human, with
   the review's summary and the pull request link (REVIEW-3).
5. Findings that need a human decision are never sent to a revision turn;
   the message to the human names each of them (REVIEW-4).
6. The system prompt of a review turn, appended to Claude Code's own, with
   `<repo>` and `<number>` filled in:

   ```text
   You are an independent reviewer of pull request #<number> in <repo>.
   The current directory is the pull request's head. /work/context.md holds the
   issue and the pull request's description.

   Review the change against the issue: does it do what was asked and nothing
   else, is it correct, is it tested, is it safe. You may read every file and
   run the tests. Do not change files: nothing you change leaves this job.

   Your final message is only a JSON document, with no text around it:
   {"verdict": ..., "summary": ..., "findings": [...]}
   - verdict "accepted" when nothing needs fixing;
   - "revise" when there are findings an engineer can fix without asking anyone;
   - "human" when at least one finding needs a decision only a human can make.
   Each finding has "file", "line" when it points at one, "severity"
   ("blocker", "major" or "minor"), "problem", "fix" and "needsHuman".
   ```

   For example:

   ```json schema=findings
   {
     "verdict": "revise",
     "summary": "The badge is added, but it points at a workflow that does not exist.",
     "findings": [
       { "file": "README.md", "line": 3, "severity": "major",
         "problem": "The badge links to ci.yaml; the workflow is ci.yml.",
         "fix": "Point the badge at .github/workflows/ci.yml.", "needsHuman": false },
       { "file": "README.md", "severity": "minor",
         "problem": "The README now names two different licences.",
         "fix": "Decide which licence applies.", "needsHuman": true }
     ]
   }
   ```

## Tests

Core unit tests with fakes of the ports:

- A first draft queues one review turn with the review model and no resume
  (REVIEW-1).
- The example above leads to one revision turn whose input holds the first
  finding only, then to `markReady` and a message naming the second finding
  (REVIEW-2, REVIEW-3, REVIEW-4).
- `accepted` leads to `markReady` and a message with the summary and no
  revision (REVIEW-3).
- A review document that does not match `findings.schema.json` fails the
  turn and tells the human.
