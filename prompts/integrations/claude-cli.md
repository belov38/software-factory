# Claude Code in headless mode

Tested with: Claude Code 2.1.286 on macOS (2026-10-01), pending the end-to-end run in the agent image.

## Facts

- Headless run, prompt on stdin:

  ```bash
  printf '%s' "<prompt>" | claude -p --output-format stream-json --verbose \
    --model <model> --permission-mode acceptEdits --allowedTools <tools> \
    --max-turns <n> --append-system-prompt "<system prompt>" \
    --session-id <uuid>          # first turn of a session; later: --resume <uuid>
  ```

- stream-json emits one JSON object per line: `system` (`init` with
  `session_id`, the tools and the model; `thinking_tokens`; hook events),
  `assistant` messages whose `content` holds `thinking`, `text` and
  `tool_use` blocks (`name`, `input`), `user` messages with `tool_result`
  blocks, `rate_limit_event`, and a last `result` with `subtype`,
  `is_error`, `session_id`, `num_turns`, `total_cost_usd`,
  `usage.input_tokens`, `usage.output_tokens` and `result` (the final text).
- `tool_use` blocks have an `id`; the matching `tool_result` block (in the
  next `user` message) has `tool_use_id` and a `content` that is either a
  string or an array of `{ "type": "text", "text": … }` blocks.
- The task list is kept with `TaskCreate` (input `subject`, `description`,
  `activeForm`; result text `Task #<n> created successfully: <subject>`) and
  `TaskUpdate` (input `taskId`, `status`: `pending`, `in_progress` or
  `completed`; result `Updated task #<n> status`); older versions use
  `TodoWrite` (input `todos`, the whole list). Some tools are deferred: the
  agent first calls `ToolSearch` to load them.
- A recorded excerpt, for tests of the harness adapter (ids shortened):

  ```text
  {"type":"system","subtype":"init","session_id":"0b7e…","model":"claude-opus-5-5","tools":["Read","Write","…"]}
  {"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_1","name":"TaskCreate","input":{"subject":"Write hello.txt","description":"Create hello.txt containing 'hi'.","activeForm":"Writing hello.txt"}}]}}
  {"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"Task #1 created successfully: Write hello.txt"}]}}
  {"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_2","name":"Write","input":{"file_path":"/work/tree/hello.txt","content":"hi"}}]}}
  {"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_2","content":[{"type":"text","text":"File created successfully at: /work/tree/hello.txt"}]}]}}
  {"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_3","name":"TaskUpdate","input":{"taskId":"1","status":"completed"}}]}}
  {"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_3","content":"Updated task #1 status"}]}}
  {"type":"assistant","message":{"content":[{"type":"text","text":"DONE"}]}}
  {"type":"result","subtype":"success","is_error":false,"session_id":"0b7e…","num_turns":7,"total_cost_usd":0.25,"usage":{"input_tokens":10,"output_tokens":715},"result":"DONE"}
  ```
- `--session-id <uuid>` starts a session with that id; `--resume <uuid>`
  continues it with its whole context and keeps the id. Transcripts are
  stored under the configuration directory (`CLAUDE_CONFIG_DIR`), keyed by
  the working directory.
- `--max-turns <n>` limits the agent's turns; `--help` does not list it.
- Authentication: `CLAUDE_CODE_OAUTH_TOKEN` (made by `claude setup-token`
  with a Pro or Max subscription, valid for about a year, for personal use)
  or `ANTHROPIC_API_KEY`. Set only one of them.
- In the agent image, Claude Code is installed with
  `npm install -g @anthropic-ai/claude-code` at its current release;
  `claude --version` prints it.
- Claude Code reads `AGENTS.md` as the project's instructions when there is
  no `CLAUDE.md` (since 2.1.277).

## Pitfalls

- A variadic flag (`--allowedTools`, `--tools`, `--add-dir`) swallows a
  positional prompt after it; `claude` then fails with "Input must be
  provided either through stdin or as a prompt argument". Send the prompt
  on stdin.
- `--resume` finds a session only from the same working directory; every
  turn of a session runs in the same path.
- `--dangerously-skip-permissions` refuses to run as root. The factory does
  not use it: the agent image runs as `node` with
  `--permission-mode acceptEdits` and an explicit tool list.
- Hooks, plugins and MCP servers of a user's own `~/.claude` change what a
  local run prints; the agent's `CLAUDE_CONFIG_DIR` starts empty.
- A subscription token shares its rate limits with the user's own Claude
  use; `rate_limit_event` lines show when a limit is near.

## Smoke test

```bash
echo "Reply with OK only." | claude -p --output-format json | jq -r .result    # OK
```
