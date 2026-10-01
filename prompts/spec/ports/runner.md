# Runner port

## Purpose

How a turn runs: one Kubernetes Job per turn, with containers that hold only
what their step needs, and the contract between those containers and the
controller. This file also holds the isolation rules of turns and the
publisher's guards.

## Requirements

### Port and contract

1. The port, in `@factory/contracts`:

   ```ts
   interface Runner {
     launch(spec: TurnSpec, nonce: string): Promise<void>
     status(turnId: string): Promise<{ state: 'pending' | 'running' | 'succeeded' | 'failed'; reason?: string }>
     cancel(turnId: string): Promise<void>
   }
   // TurnSpec: { id, kind: 'work' | 'review', reason, project, repo, workItem: WorkRef,
   //             sessionId, harnessSessionId, resume: boolean, branch, input: string,
   //             change?: { number: number; headSha: string }, model: string,
   //             maxTurns: number, deadlineSeconds: number }
   // harnessSessionId is the session id for work turns and the turn id for review
   // turns: a review always starts a fresh agent session.
   ```

   The core makes the nonce (32 random bytes, hex) and stores only its
   SHA-256 (`prompts/spec/core.md`).
2. Turn containers talk to the controller at `FACTORY_INTERNAL_URL` with the
   header `x-factory-nonce: <nonce>`; the controller answers `403` unless
   the nonce matches the turn's and the turn is `running`:
   - `GET /internal/turns/:id` returns the turn's envelope:
     `{ spec: TurnSpec, project: <the project's entry of factory.yaml>, appSlug, botEmail, statusUrl }`.
   - `POST /internal/turns/:id/progress` takes `{ plan, current, phase }`;
     the status page shows the latest one.
   - `POST /internal/turns/:id/result` takes the report of 11 or 13.
   - `POST /internal/credentials` takes `{ turnId, purpose }` and returns a
     token (`prompts/spec/ports/credentials.md`).
   A container that cannot reach the controller retries for 10 minutes
   before it fails. Tokens are asked for again 5 minutes before they expire:
   a turn can outlive a token.

### The Job

3. `runner-k8s` creates a Job `turn-<first 8 characters of the turn id>` in
   `factory` with `backoffLimit: 0`, `restartPolicy: Never`,
   `activeDeadlineSeconds` from `limits.turnDeadlineSeconds`,
   `ttlSecondsAfterFinished: 86400`, and the labels
   `app.kubernetes.io/component: turn` and `factory/turn-id: <id>` on the Job
   and on its pod template. Then it creates a Secret
   `turn-<first 8 characters>` with the key `nonce`, owned by the Job
   (`blockOwnerDeletion: false`), so it goes with the Job; the pod waits for
   it. `cancel` deletes the Job with foreground propagation.
4. The pod: `automountServiceAccountToken: false` (ISOLATION-1), user and
   group 1000, `imagePullSecrets: [ghcr-pull]`, and these volumes:
   - `work` (emptyDir): `/work/tree` (the agent's working tree),
     `/work/turn.json`, `/work/context.md`, `/work/out/`;
   - `clean` (emptyDir): a second clone for the publisher, never mounted in
     `agent`;
   - `sessions`: the PVC `factory-sessions`. The init container `prepare`
     (factory image, user 0, no network use, no secrets) mounts it whole and
     creates the directory `<harness session id>` owned by 1000, because
     kubelet would create a missing `subPath` owned by root. `agent` mounts
     only that directory (`subPath`) at `/home/node/.claude-session`;
   - `nonce`: the turn's Secret at `/var/run/factory`, mounted in every
     container except `agent` and `prepare`.
   Every container except `agent` and `prepare` has `FACTORY_TURN_ID`,
   `FACTORY_INTERNAL_URL` and `FACTORY_NONCE_FILE=/var/run/factory/nonce`.
5. Both kinds of Job have the init containers `prepare`, `checkout`,
   `context`, `streamer` (`restartPolicy: Always`, a native sidecar) and
   `agent`. The main container is `publisher` for work turns and `reporter`
   for review turns. Only `agent` uses the agent image.
6. `checkout` reads the envelope, writes it to `/work/turn.json` (it holds no
   secret) for `agent`, takes a `clone` (work) or `review-read` (review)
   token and clones into `/work/tree` and, for work turns, `/work/clean`.
   The token goes in an HTTP header through `GIT_CONFIG_COUNT`,
   `GIT_CONFIG_KEY_0=http.https://github.com/.extraheader` and
   `GIT_CONFIG_VALUE_0=AUTHORIZATION: basic <base64 of x-access-token:<token>>`,
   never in a URL or in `.git/config`. A work turn checks out the session
   branch when it exists on the remote, otherwise creates it from the
   default branch; a review turn fetches the change's `headSha`, falling
   back to its branch.
7. `context` takes a `channel` token, reads the work item through the
   tracker, and writes `/work/context.md`: the item, the conversation, and
   the turn's input under the heading "New since your last turn". For a
   review turn the input holds the pull request's description.
8. `streamer` takes a `channel` token, follows `/work/out/events.jsonl`, and
   at most every 10 seconds calls `channel.progress` (keeping the comment id
   it returns, so the turn has one status comment, CORE-3) and
   `POST /internal/turns/:id/progress`; once more with the final phase when
   `/work/out/final.json` appears or it is stopped.
9. `agent` reads `/work/turn.json`, runs the harness
   (`prompts/spec/ports/harness.md`) in `/work/tree` (the same path in every
   turn of a session, CORE-6) with the system prompt of its kind from
   `prompts/spec/capabilities/` and the content of `/work/context.md` as the
   prompt, writes each harness event to `/work/out/events.jsonl` and the
   final event to `/work/out/final.json`, and exits 0 even when the agent
   failed, so the result is still reported. Its environment: the Secret
   `factory-model`, `FACTORY_TURN_CANARY` (a random value the runner sets
   per turn) and `CLAUDE_CONFIG_DIR=/home/node/.claude-session`.
10. `publisher` (work): when `final.json` is an error, it publishes nothing.
    Otherwise, when the agent's tree differs from the branch, it copies
    `/work/tree` over `/work/clean` without the top-level `.git` (a nested
    `.git` is copied, so an embedded repository shows as a gitlink and the
    guard refuses it), stages everything, applies the guards (12), commits
    as `<app-slug>[bot] <botEmail>` with the final message's first line as
    the subject, takes a `publish` token and pushes the session branch
    without force. On the first change it opens the draft through the forge
    with the final message followed by `Closes #<issue number>` as the body;
    later turns push to the same branch and leave the body alone.
11. The publisher's report: `{ finalText, isError, usage, change?: { branch,
    number, url, headSha }, refused?: string }`.
12. Guards. The publisher refuses, and reports why, when:
    - the branch is not under `factory/` (ISOLATION-3);
    - a path under `.github/workflows/` is added, changed or removed;
    - a gitlink (mode 160000) is added or changed;
    - more than 1000 files change or more than 50 MiB of file content is
      added or changed;
    - the push is not a fast-forward.
13. `reporter` (review) reports `{ finalText, usage }`.

### Isolation

14. The NetworkPolicy `factory-turns` selects `app.kubernetes.io/component:
    turn` and allows egress only to (ISOLATION-2):

    ```yaml
    egress:
      - to: [ { namespaceSelector: {}, podSelector: { matchLabels: { k8s-app: kube-dns } } } ]
        ports: [ { protocol: UDP, port: 53 }, { protocol: TCP, port: 53 } ]
      - to: [ { podSelector: { matchLabels: { app.kubernetes.io/name: factory-controller } } } ]
        ports: [ { protocol: TCP, port: 8080 } ]
      - to: [ { ipBlock: { cidr: 0.0.0.0/0, except: [10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, 100.64.0.0/10] } } ]
        ports: [ { protocol: TCP, port: 443 } ]
    ```

    The controller's pods carry the label
    `app.kubernetes.io/name: factory-controller`.
15. Redaction (ISOLATION-4). Each container knows the values it holds: its
    environment variables whose names end in `_KEY`, `_TOKEN` or `_SECRET`,
    `FACTORY_TURN_CANARY`, and the tokens it obtained. It replaces every
    occurrence of them with `[redacted]` in whatever it posts, reports,
    commits or stores. `agent` redacts each event before it writes it to
    `events.jsonl` (the streamer posts from that file while the agent runs
    and holds none of the agent's secrets), redacts `final.json`, and after
    the harness finishes redacts the files of `/work/tree` and the session's
    transcript files under `/home/node/.claude-session`.

## Tests

- Unit: the work Job's manifest has no service account token, and its
  `agent` container mounts neither `nonce` nor `clean` and has no
  `github-app` variable (ISOLATION-1); the review Job's manifest likewise;
  the pod template carries the turn label.
- Unit: the NetworkPolicy the runner's module describes matches 14 (the chart
  test in the build phase checks the rendered one).
- Unit: the publisher refuses a branch outside `factory/`, a changed
  `.github/workflows/ci.yml`, a nested repository, 1001 changed files, 51
  MiB of new content and a non-fast-forward push (ISOLATION-3); it publishes
  nothing after an error.
- Unit: the first published change opens a draft whose body ends with
  `Closes #<n>`; a later change leaves the body alone.
- Unit: after `checkout`, `/work/tree/.git/config` contains no token.
- Unit: a canary and a `_TOKEN` value printed by the agent appear as
  `[redacted]` in each line of `events.jsonl` as it is written, in
  `final.json`, in a file of the tree and in a transcript file (ISOLATION-4).
- Unit: the streamer's progress calls reuse one comment id (CORE-3) and post
  to `/internal/turns/:id/progress`.
- Unit: a turn route with a wrong nonce gets `403`.
