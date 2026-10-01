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
   `resume` is true, otherwise `--session-id <sessionId>`. The prompt goes to
   stdin, never as an argument (a variadic flag before it would swallow it).
   The working directory is `cwd`, the same for every turn of a session, so
   `--resume` finds the transcript (CORE-6). `CLAUDE_CONFIG_DIR` is in `env`.
3. Tools: `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash`, the task list
   tools, and, when `subagents` is true, the subagent tool. Review mode has
   the same tools: the agent may run tests, and only its final message
   leaves the Job.
4. Mapping of stream-json (facts in `prompts/integrations/claude-cli.md`):
   - `assistant` content `text` → `thought`;
   - `assistant` content `tool_use` → `action` with the tool's name and a
     one-line summary of its input; the matching `tool_result` → that
     action's `result`, cut to 2000 characters;
   - `TaskCreate`, `TaskUpdate` or `TodoWrite` → `plan` with the whole list;
   - the subagent tool (`Task` or `Agent`) → `subagent`;
   - `result` → `final` with `result`, `is_error`, `usage.input_tokens`,
     `usage.output_tokens` and `total_cost_usd`;
   - other events are ignored.
5. When `claude` exits without a `result` event, `run` ends with a `final`
   whose `isError` is true and whose text is the last 50 lines of stderr.
6. The core sets `resume` from the session's `harness_started` and sets that
   flag after the first turn that reached `final`.

## Tests

- Unit: a recorded stream-json transcript maps to the expected harness
  events, in order, with the usage of its `result`.
- Unit: the first turn of a session passes `--session-id`, later turns pass
  `--resume` with the same id and the same working directory (CORE-6).
- Unit: the prompt is written to stdin and never appears in the arguments.
- Unit: an exit without `result` yields one `final` with `isError: true`.
