# Runner port

## Purpose

How a turn runs: one Kubernetes Job per turn, with containers that hold only
what their step needs. This file also holds the isolation rules of turns and
the publisher's guards.

## Requirements

### Port

1. The port, in `@factory/contracts`:

   ```ts
   interface Runner {
     launch(turn: TurnSpec): Promise<void>
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

2. Turn containers read their `TurnSpec` from `GET /internal/turns/:id`,
   authenticated with the nonce like `POST /internal/credentials`, and report
   with `POST /internal/turns/:id/result`. A container that cannot reach the
   controller retries for 10 minutes before it fails.

### The Job

3. `runner-k8s` creates a Job `turn-<first 8 characters of the turn id>` in
   `factory` with `backoffLimit: 0`, `restartPolicy: Never`,
   `activeDeadlineSeconds` from `limits.turnDeadlineSeconds`,
   `ttlSecondsAfterFinished: 86400`, the labels
   `app.kubernetes.io/component: turn` and `factory/turn-id: <id>`, and then a
   Secret `turn-<first 8 characters>` with the key `nonce` (32 random bytes,
   hex) whose owner is the Job, so it goes with the Job. `cancel` deletes the
   Job with foreground propagation.
4. The pod: `automountServiceAccountToken: false` (ISOLATION-1), user and
   group 1000, `imagePullSecrets: [ghcr-pull]`, and these volumes:
   - `work` (emptyDir): `/work/tree` (the agent's working tree),
     `/work/context.md`, `/work/out/`;
   - `clean` (emptyDir): a second clone for the publisher, never mounted in
     `agent`;
   - `sessions`: the PVC `factory-sessions` with `subPath: <harness session
     id>`, mounted only in `agent` at `/home/node/.claude-session`;
   - `nonce`: the turn's Secret at `/var/run/factory`, mounted in every
     container except `agent`.
   Every container except `agent` has `FACTORY_TURN_ID`,
   `FACTORY_INTERNAL_URL` and `FACTORY_NONCE_FILE=/var/run/factory/nonce`.
5. A work Job has the init containers `checkout`, `context`, `streamer`
   (`restartPolicy: Always`, a native sidecar) and `agent`, and the main
   container `publisher`. A review Job has the init containers `checkout` and
   `agent` and the main container `reporter`. Only `agent` uses the agent
   image.
6. `checkout` takes a `clone` (work) or `review-read` (review) token and
   clones into `/work/tree` and, for work turns, `/work/clean`, with the token
   passed as an HTTP header through `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_0`
   and `GIT_CONFIG_VALUE_0`, never in a URL or in `.git/config`. A work turn
   checks out the session branch when it exists on the remote, otherwise
   creates it from the default branch; a review turn checks out the pull
   request's head.
7. `context` takes a `channel` token, reads the work item through the
   tracker, and writes `/work/context.md`: the item, the conversation, and
   the turn's input under the heading "New since your last turn".
8. `streamer` takes a `channel` token, follows `/work/out/events.jsonl` and
   calls `channel.progress` at most every 10 seconds, and once more with the
   final phase when `/work/out/final.json` appears or it is stopped.
9. `agent` runs the harness (`prompts/spec/ports/harness.md`) in
   `/work/tree` (the same path in every turn of a session, CORE-6) with the
   prompt from `prompts/spec/capabilities/` and `/work/context.md`, writes
   harness events to `/work/out/events.jsonl` and the final event to
   `/work/out/final.json`, and exits 0 even when the agent failed, so the
   result is still reported. Its environment: the Secret `factory-model`,
   `FACTORY_TURN_CANARY` (a random value the runner sets per turn) and
   `CLAUDE_CONFIG_DIR=/home/node/.claude-session`.
10. `publisher` (work) reports to the controller. When the agent's tree
    differs from the branch, it copies `/work/tree` without `.git` over
    `/work/clean`, stages everything, applies the guards (11), commits as
    `<app-slug>[bot]` with the final message's first line as the subject,
    takes a `publish` token, pushes the session branch without force, and
    opens the draft pull request or updates its body through the forge. Its
    report: `{ finalText, isError, usage, change?: { branch, number, url,
    headSha }, refused?: string }`.
11. Guards. The publisher refuses, and reports why, when:
    - the branch is not under `factory/` (ISOLATION-3);
    - a path under `.github/workflows/` is added, changed or removed;
    - a gitlink (mode 160000) is added or changed;
    - more than 1000 files change or more than 50 MB are added.
    A push that is not a fast-forward is refused too.
12. `reporter` (review) reports `{ finalText, usage }`.

### Isolation

13. The NetworkPolicy `factory-turns` selects `app.kubernetes.io/component:
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
14. Redaction (ISOLATION-4). Each container knows the values it holds: its
    environment variables whose names end in `_KEY`, `_TOKEN` or `_SECRET`,
    `FACTORY_TURN_CANARY`, and the tokens it obtained. It replaces every
    occurrence of them with `[redacted]` in whatever it posts, reports,
    commits or stores. After the harness finishes, `agent` applies this to
    `final.json`, `events.jsonl`, the files of `/work/tree` and the session's
    transcript files under `/home/node/.claude-session`.

## Tests

- Unit: the work Job's manifest has no service account token, and its
  `agent` container mounts neither `nonce` nor `clean` and has no
  `github-app` variable (ISOLATION-1); the review Job's manifest likewise.
- Unit: the NetworkPolicy rendered by the chart matches 13.
- Unit: the publisher refuses a branch outside `factory/`, a changed
  `.github/workflows/ci.yml`, a gitlink, 1001 changed files, 51 MB of new
  content and a non-fast-forward push (ISOLATION-3).
- Unit: after `checkout`, `/work/tree/.git/config` contains no token.
- Unit: a canary and a `_TOKEN` value printed by the agent appear as
  `[redacted]` in `final.json`, `events.jsonl`, a file in the tree and a
  transcript file (ISOLATION-4).
- Unit: the session branch is `factory/<number>-<first 8 characters of the
  session id>`.
