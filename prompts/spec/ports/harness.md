# Harness port

## Purpose

The coding agent that does the work inside a turn. The harness runs it in the
working tree, streams what it does as harness events, resumes its session in
later turns and reports usage. v1 has one harness, Claude Code.

## Requirements

1. The port, in `@factory/contracts`:

   ```ts
   interface Harness {
     capabilities: { resume: boolean; subagents: boolean; usage: boolean }
     run(options: {
       sessionId: string; resume: boolean; prompt: string; systemPrompt: string; cwd: string;
       mode: 'work' | 'review'; model: string; maxTurns: number; subagents: boolean;
       env: Record<string, string>
     }): AsyncIterable<HarnessEvent>
   }
   type HarnessEvent =
     | { kind: 'thought'; text: string }
     | { kind: 'action'; tool: string; param: string; result?: string }
     | { kind: 'plan'; entries: { text: string; done: boolean }[] }
     | { kind: 'subagent'; name: string; status: string; summary?: string }
     | { kind: 'final'; text: string; isError: boolean;
         usage: { inputTokens: number; outputTokens: number; costUsd?: number } }
   ```

2. `harness-claude` (`kind: claude`): capabilities all `true`. It runs
   `claude -p --output-format stream-json --verbose --model <model>
   --permission-mode acceptEdits --allowedTools <tools> --max-turns <maxTurns>
   --append-system-prompt <systemPrompt>`, plus `--resume <sessionId>` when
   the session's transcript exists
   (`$CLAUDE_CONFIG_DIR/projects/*/<sessionId>.jsonl`), otherwise
   `--session-id <sessionId>`: Claude Code refuses `--session-id` for an id
   that already has a transcript, which a stopped or failed first turn
   leaves behind. The `resume` option is only a hint. The prompt goes to
   stdin, never as an argument (a variadic flag before it would swallow it).
   The working directory is `cwd`, the same for every turn of a session, so
   `--resume` finds the transcript (CORE-6). `claude` inherits the
   container's environment (the model key comes from it) plus `env`, which
   holds `CLAUDE_CONFIG_DIR`.
3. Tools, passed as one comma-separated argument of `--allowedTools`:
   `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash`, `ToolSearch`,
   `TaskCreate`, `TaskUpdate`, `TaskList`, `TaskGet`, `TodoWrite`, and, when
   `subagents` is true, `Task` and `Agent`. Review mode has the same tools:
   the agent may run tests, and only its final message leaves the Job.
4. Mapping of stream-json (facts in `prompts/integrations/claude-cli.md`):
   - `assistant` content `text` → `thought`;
   - `assistant` content `tool_use` → `action` with the tool's name and a
     one-line summary of its input; the matching `tool_result` (by
     `tool_use_id`) → a second `action` for the same tool and summary, with
     `result` cut to 2000 characters;
   - `TaskCreate`, `TaskUpdate` or `TodoWrite` → `plan` with the whole list.
     The adapter keeps the list: `TaskCreate` adds `subject` with the number
     from its result (`Task #<n> created…`), `TaskUpdate` sets the `status`
     of `taskId` (`completed` is done), `TodoWrite` replaces the list;
   - the subagent tool (`Task` or `Agent`) → `subagent`;
   - `result` → `final` with `result`, `is_error`, `usage.input_tokens`,
     `usage.output_tokens` and `total_cost_usd`;
   - other events are ignored.
5. When `claude` exits without a `result` event, `run` ends with a `final`
   whose `isError` is true and whose text is the last 50 lines of stderr.
6. The core passes `resume` from the session's `harness_started`, set after
   the first turn whose `final` is not an error; the adapter decides by the
   transcript (2).

## Tests

- Unit: the recorded excerpt in `prompts/integrations/claude-cli.md` maps to
  the expected harness events, in order: a plan with one entry that ends
  done, two actions for `Write` (the second with its result), a thought
  `DONE`, and a final with the usage of its `result`.
- Unit: the first turn of a session passes `--session-id`, later turns pass
  `--resume` with the same id and the same working directory (CORE-6); a
  transcript without `harness_started` (a stopped first turn) resumes.
- Unit: the prompt is written to stdin and never appears in the arguments.
- Unit: an exit without `result` yields one `final` with `isError: true`.
