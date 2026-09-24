# Auto-approve approval integrity

Status: implemented; gates and the relevant suites pass.

Issue: [ThinkInAIXYZ/deepchat#2360](https://github.com/ThinkInAIXYZ/deepchat/issues/2360).

## Issue and impact

Under `permissionMode = 'auto_approve'` (mapped to `full_access` by
`src/main/tool/permission/permissionMode.ts`), DeepChat synthesizes an approval for agent built-in
tool calls and asks the review model whether to auto-allow or ask the user. Three defect classes:

1. **Synthetic payloads misstate the tool or its operation.** They are built from tool-name
   substrings and argument shape, never from the tool's declared contract, so several tools produce
   payloads that the allow path rejects or misinterprets.
2. **Review coverage is inconsistent.** Equivalent operations are reviewed or not depending on
   whether the tool name happens to contain a keyword and whether an argument happens to be a string
   array.
3. **An interaction that throws while being answered leaves the session permanently `generating`.**
   The renderer auto-dismisses, the dismissal closes the approval without settling session state,
   and stop reports `stopped: true` while changing nothing.

Reproduction from the issue: under `auto_approve`, `exec` a command that yields a background
`sessionId`, then call `process` with `{"action":"poll","sessionId":"<id>"}`. The second call is
routed to the user; clicking Allow logs `File approval is missing a valid shell profile.` and the
session stops advancing. The stop button remains and does nothing.

## Root cause

### Payload construction

- `buildSyntheticPermissionForReview` (`src/main/agent/deepchat/runtime/dispatch.ts`) rewrites
  `serverName` to `agent-filesystem` as soon as it finds any "path", and classifies the operation by
  substring-matching the tool name (`read|search|list|find` → `read`, otherwise `write`). It never
  consults the declared `execution: ToolExecutionContract` or the declared `server.name`.
- `collectStringValues` collects **every string element of every array**, whatever the key, so any
  string-array argument becomes a filesystem path. This is the mechanism behind the
  `tape_search.kinds`, `deepchat_subagents.delegationIds`, `glob.options.pathScope` and
  `skill_run.args` misreads, and it is what rewrites those tools' server identity.
- `extractToolArgCommand` treats any `command`/`cmd`/`script` argument as a shell command, so
  `str_replace_editor.command` (an operation enum) and `skill_run.script` (a skill script)
  synthesize command approvals for strings that are not commands.
- The allow path (`grantPermissionForPayload` in `interactionCoordinator.ts`) validates as though
  every payload were either a command approval or a filesystem-path approval. An `agent-filesystem`
  tool that is neither (`process`) can therefore never be approved.

### Coverage

`isReviewableFullAccessToolCall` decides by name substring and argument shape, so `apply_patch` (a
file write) is never reviewed, while `glob`/`grep` become *write* approvals only once `pathScope`
is present.

### Stuck session

- `InteractionCoordinator.dismiss` marks the block denied, stamps `cancelled` and clears the pending
  entry, but never publishes a terminal state or wakes the input queue.
- The renderer calls `dismiss` after **any** rejection of `respondToolInteraction` without
  inspecting the error, and drops the approval from the UI before the IPC returns.
- `RunLifecycleCoordinator.cancel` returns early when there is no pending interaction and no active
  run or controller, so stop is a no-op; `ChatService.stopStream` reports
  `{ stopped: !cancelFailed }`, which only reflects whether the call threw.

## Design and boundaries

### Coverage policy

The reviewed set is derived from the tool's own declared contract, not from its name. The single
owner is `src/main/tool/permission/agentToolReviewPolicy.ts`, used by both the synthesizer and the
allow path.

- An agent built-in tool is reviewed when its declared `execution.effect` is `write`, unless an
  operation-level rule below applies.
- Read-effect tools are not reviewed. Reviewing a retrieval would spend a review call on an
  operation that cannot change anything.
- Tools that already own an approval path are never reviewed here: `cronjob` write actions (its
  precheck), `deepchat_subagents` `spawn`/`follow_up` (explicit user confirmation, or the
  conversation's orchestration policy) and the question tool (an interaction, not a permission).
- Two tools declare `write` although they only read (`memory_recall`, `skill_view`). Their
  declarations are left alone because the same contract drives execution parallelism and recovery
  classification; the review policy corrects only what it owns.
- `update_plan` is declared `write` because it mutates the session plan, but it grants no capability
  the user would approve.

| Tool | Operation | Reviewed | Approval scope |
| --- | --- | --- | --- |
| `read`, `glob`, `grep`, `tape_search`, `tape_context`, `get_browser_status`, `memory_recall`, `skill_list`, `skill_view` | — | no | — |
| `exec` | — | yes | command: signature + shell profile |
| `write`, `edit` | — | yes | paths |
| `apply_patch` | — | yes | paths parsed from the patch |
| `str_replace_editor` | `view` | no | — |
| `str_replace_editor` | `create`, `str_replace`, `insert` | yes | paths |
| `process` | `list`, `poll`, `log` | no | — |
| `process` | `write`, `kill`, `clear`, `remove` | yes | tool: shell profile, no paths |
| `memory_remember`, `memory_forget` | — | yes | tool |
| `skill_manage`, `skill_run` | — | yes | tool |
| `image_generate`, `load_url`, `cdp_send` | — | yes | tool |
| `deepchat_settings_*` | — | yes | tool: settings lease by tool name |
| `deepchat_subagents` | `send`, `interrupt` | yes | tool |
| `cronjob`, `deepchat_question`, `update_plan` | — | no | — |

Out of scope by decision (unchanged behaviour, recorded so the asymmetry is intentional rather than
accidental): plain MCP tool calls keep the `full_access` broker short-circuit, and Code Mode nested
tool calls keep their existing path. `docs/architecture/remove-mcp-permission-system/spec.md` remains
the maintained contract for the broker and is not modified.

### Approval payload

- The payload never rewrites the declared server identity; `serverName` is the tool's declared
  `server.name`. The allow path rejects a payload whose server identity disagrees with the tool call.
- The approval subject comes from the same policy module the coverage decision comes from, so both
  sides agree on what a given tool's approval means.
- Only a path-scoped tool's approval carries paths, and only the paths that tool actually authorizes
  (`path` for the file editors, the patch hunks for `apply_patch`). An argument that is an operation
  name, an identifier or an enum is never read as a path.
- Only a tool that runs a shell command synthesizes a command approval. `str_replace_editor.command`
  is an operation enum and `skill_run.script` is a skill script; neither is a command.
- Every `agent-filesystem` approval carries a resolved shell profile, because the retry path resolves
  the approved call against the shell it was reviewed under.
- A path-scoped approval records the targets the execution will touch: the call's own path arguments
  are resolved through the tool layer against the same base directory the call runs under, so an
  approved path and the written path cannot disagree.
- The allow path validates against the policy: an `agent-filesystem` approval must carry a valid
  shell profile, and must carry paths when the tool authorizes paths. Tool identity validation is
  preserved; no validation is removed and no synthetic path is invented to satisfy it.

### Recovery

- `dismiss` settles the turn it orphans: when it removes the last pending interaction and no run or
  operation controller owns the message, it publishes the cancelled terminal state and wakes the
  input queue, reusing the existing abort-settlement path.
- `cancel` publishes a terminal state when the session is not idle and nothing owns it, so stop
  reports what actually happened.
- The renderer surfaces a failed interaction response to the user instead of silently recording a
  denial.

## Non-goals

- Do not change MCP or Code Mode review coverage.
- Do not change ACP `session/request_permission` handling.
- Do not change `default` mode behaviour or the precheck paths.
- Do not remove or weaken tool identity validation.
- Do not invent paths or signatures to satisfy the allow path.
- Do not change the review model contract or its `auto_allow`/`ask_user`/`block` decisions.

## Acceptance criteria

- [x] Every reviewed agent tool produces an approval payload that names the tool's real identity,
      operation and scope; the four failing scenarios (`process` actions, `tape_search` with `kinds`,
      `skill_manage` `write_file`/`remove_file`, `deepchat_subagents` `wait` with `delegationIds`)
      are approvable.
- [x] `str_replace_editor.command` is not treated as a shell command, and `skill_run`'s approval
      reflects the skill, its arguments and its executor.
- [x] A relative-path approval resolves against the same base directory as the execution.
- [x] Coverage follows `execution.effect`, so `apply_patch` is reviewed and read-only tools are not.
- [x] Clicking Allow continues the tool's execution; clicking Deny delivers the denial and continues
      or ends the session.
- [x] An interaction-handling failure is shown as an error and is not recorded as a user denial.
- [x] No state remains `generating` with no executing run and no pending approval.
- [x] Stop ends such a state, publishes the terminal state and returns a result consistent with what
      happened.
- [x] Input submitted after an abnormal ending is processed, and other valid approvals or
      replacement runs are not cleared.

## Validation outcome

The regression tests that lock this change fail against the base implementation:

- `test/main/agent/deepchat/harness/deepChatAgentHarness.test.ts` — "approves an agent-filesystem
  call that authorizes no path" reproduces the issue's `process` scenario: the base implementation
  rejects the approval for lacking paths it never had.
- `test/main/agent/deepchat/harness/deepChatAgentHarness.test.ts` — "settles a session left
  generating with no owner when its last approval is dismissed" fails on the base implementation,
  which leaves the session `generating` after the dismissal.
- `test/main/tool/permission/agentToolReviewPolicy.test.ts` locks the coverage contract and the four
  payload scenarios.
- `test/main/tool/agentTools/agentToolManagerRead.test.ts` locks approval-path resolution against the
  call's base directory.

Two existing dispatch tests were updated because they asserted the behaviour this change removes:
the synthesized approval used to rewrite the server identity to `agent-filesystem`, and a `read`
fixture declared as a write tool used to be reviewed by name.

Gates: `pnpm run format`, `pnpm run i18n`, `pnpm run lint` and `pnpm run typecheck` pass. Suites
pass: `test/main/agent/deepchat/runtime/**`, `test/main/tool/**`,
`test/main/agent/deepchat/harness/deepChatAgentHarness.test.ts` and the renderer interaction suite —
1510 tests plus 383 harness tests, one pre-existing skip.

Not covered by a test: the real end-to-end path in a packaged app. The reproduction is exercised
through the main-process classes with in-memory stand-ins for the database, tool execution and model
recovery, which is the same boundary the issue's own investigation used.
