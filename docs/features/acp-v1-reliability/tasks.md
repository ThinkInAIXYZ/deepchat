# ACP v1 Reliability Tasks

## 0. Review Gate

- [ ] Review `spec.md` protocol coverage matrix with maintainers.
- [ ] Review `plan.md` runtime flow, UI shape, and test matrix.
- [ ] Confirm all open questions are resolved before implementation.
- [ ] Keep this SDD folder active until ACP v1 reliability work is merged or deliberately abandoned.

## 1. Capability and Initialization

- [ ] Add tests for parsing full initialize result: `agentInfo`, `agentCapabilities`, `sessionCapabilities`, `promptCapabilities`, `authMethods`, `mcpCapabilities`.
- [ ] Extend ACP process handle with a lightweight capability snapshot.
- [ ] Parse support booleans from snapshot: `loadSession`, `sessionList`, `sessionResume`, `sessionClose`, `sessionFork`, `authLogout`.
- [ ] Update initialize debug log to include protocol version, client capabilities, agent capabilities, and auth methods.
- [ ] Ensure `buildClientCapabilities` only declares implemented capabilities.
- [ ] Add explicit initialize error categories: protocol mismatch, process exit, protocol stream closed, timeout.

## 2. Authentication

- [ ] Extend shared ACP debug action type with `authenticate` and `logout`.
- [ ] Add presenter/debug route for `authenticate({ agentId, methodId, workdir? })`.
- [ ] Add presenter/debug route for `logout({ agentId, workdir? })`, gated by `auth.logout`.
- [ ] Map auth-required failures into renderer-safe ACP status payload.
- [ ] Implement `agent` auth method by calling `connection.authenticate({ methodId })`.
- [ ] Implement `env_var` auth UX by surfacing missing env vars in agent settings and requiring restart/reinitialize.
- [ ] Implement `terminal` auth flow before declaring `clientCapabilities.auth.terminal=true`.
- [ ] Add auth tests for success, failure, missing method id, unsupported logout, and process cleanup.

## 3. Session Catalog, Import, and Lifecycle

- [ ] Extend shared ACP debug action type with `sessionList`, `sessionImport`, `sessionResume`, `sessionDetach`, `sessionCloseRemote`, and `sessionFork`.
- [ ] Add `session/list` presenter/debug path with workspace `cwd` filter and cursor pagination.
- [ ] Add `AcpSessionLink` persistence keyed by `agentId + canonicalWorkdir + remoteSessionId`.
- [ ] Add external session catalog sync that updates link metadata without creating duplicate DeepChat conversations.
- [ ] Add import path that creates or reuses a DeepChat conversation for a remote session.
- [ ] Add `session/load` import path gated by top-level `loadSession`.
- [ ] Stage replayed remote updates before converting them to DeepChat messages.
- [ ] Add message/block fingerprinting so repeated imports do not duplicate persisted messages.
- [ ] Add `session/resume` path gated by `sessionCapabilities.resume` for already linked conversations.
- [ ] Fix local runtime restore priority: linked `resume` > linked `loadSession` import/replay > `newSession`.
- [ ] Change local conversation close/delete to detach ACP link by default, without remote writes.
- [ ] Add explicit remote close path gated by `sessionCapabilities.close`.
- [ ] Change session cleanup so user stop uses `session/cancel`, while explicit remote close uses `session/close` when available.
- [ ] Preserve persisted ACP session link after process crash so recoverable agents can resume later.
- [ ] Add debug-only `session/fork` path gated by capability; do not wire it into normal chat flow yet.
- [ ] Add DimCode-shaped lifecycle tests: list empty, catalog sync, import, repeated import no duplicate messages, resume, explicit remote close.

## 4. Session Update Routing

- [ ] Add session update buffer keyed by `sessionId`.
- [ ] Buffer updates that arrive before listener registration.
- [ ] Flush buffered updates in order when `registerSessionListener` runs.
- [ ] Apply TTL and max-entry guard to avoid unbounded memory growth.
- [ ] Record expired buffered updates in ACP debug log.
- [ ] Add regression test for early `available_commands_update` during `session/new`.

## 5. Prompt Turn and Input Content

- [ ] Replace history-based ACP formatter with current-turn-only formatter.
- [ ] Remove temperature/maxTokens prompt text injection.
- [ ] Send DeepChat system prompt only once when a local conversation first binds to ACP runtime.
- [ ] Add input content mapping for text, image, audio, resource, and resource_link.
- [ ] Gate image/audio/resource by `promptCapabilities`.
- [ ] Add fallback behavior for unsupported multimodal content.
- [ ] Add tests for text-only, image-supported, image-unsupported, audio-supported, embedded context, and system prompt once.

## 6. Session Updates and Output Content

- [ ] Keep `agent_message_chunk` mapped to text stream and content block.
- [ ] Keep `agent_thought_chunk` mapped to reasoning stream and reasoning block.
- [ ] Update image/audio/resource/resource_link output handling to preserve structure in metadata/debug.
- [ ] Map `usage_update` into turn metadata and ACP debug log.
- [ ] Map `session_info_update` into `AcpSessionLink` metadata.
- [ ] Ensure session title update does not override user-edited DeepChat titles.
- [ ] Keep `plan` update replacement semantics.
- [ ] Add tests for usage, session info, plan replacement, and unsupported output fallback.

## 7. Tool Calls and Permission

- [ ] Stop treating ordinary `tool_call` progress as permission UI.
- [ ] Route only `session/request_permission` into DeepChat permission overlay.
- [ ] Preserve tool terminal output, diff path/content, locations, raw input, and raw output in block metadata/debug.
- [ ] Add permission resolver timeout with cancelled default outcome.
- [ ] Clear stale ACP permission overlays after interrupted sessions instead of throwing on unknown request ids.
- [ ] Add tests for approve, deny, cancel, timeout, missing resolver, and tool update rendering.

## 8. File System

- [ ] Keep `fs/read_text_file` and `fs/write_text_file` behind declared client fs capability.
- [ ] Add tests for registered workdir requirement.
- [ ] Add tests for 1-based line handling.
- [ ] Add tests for cross-workspace path rejection.
- [ ] Add tests for binary read rejection and max-size error.
- [ ] Verify write path creates only allowed files and returns protocol-shaped errors.

## 9. Terminals

- [ ] Change `terminal/create` to spawn `command` with `args` directly.
- [ ] Remove default command/args shell string concatenation.
- [ ] Keep cwd resolution guarded by workspace rules or explicit fallback warning.
- [ ] Change output buffer truncation to keep latest tail output.
- [ ] Preserve UTF-8 character boundary after truncation.
- [ ] Keep `kill` and `release` idempotent.
- [ ] Add tests for args quoting, tail truncation, multibyte truncation, exit status, kill, release, and missing terminal.

## 10. Modes, Config Options, Slash Commands

- [ ] Ensure initialize, new, load, and resume all publish normalized config state.
- [ ] Keep `session/set_mode` compatibility for agents still using session modes.
- [ ] Prefer config options in UI when both legacy mode and config option exist.
- [ ] Keep `current_mode_update` synchronized with ChatStatusBar.
- [ ] Keep `config_option_update` synchronized with config state.
- [ ] Ensure `available_commands_update` populates slash suggestions after update buffer fix.
- [ ] Skip ACP warmup when the selected workdir is unavailable, while preserving session-start fallback behavior.
- [ ] Add tests for set mode, set model/config option, current mode update, config option update, and slash command availability.

## 11. Diagnostics UI

- [ ] Add compact ACP diagnostics section in agent settings.
- [ ] Show protocol version, readiness, auth state, capabilities, launch source, and last error.
- [ ] Add Authenticate button only when auth methods exist.
- [ ] Add Sync Sessions button only when `sessionCapabilities.list` exists.
- [ ] Add Import/Open action for listed remote sessions.
- [ ] Add Detach action for linked local conversations.
- [ ] Add Close Remote action only behind explicit user intent and `sessionCapabilities.close`.
- [ ] Add Run Diagnostics action that executes safe initialize/list capability probes with timeout.
- [ ] Add i18n keys for all new labels and error messages.
- [ ] Add renderer tests for ready, auth required, no session list, catalog sync, imported link, duplicate import prevention, and error states.

## 12. Registry and Real-Agent Matrix

- [ ] Verify registry `dimcode@0.0.75` launch spec on Windows.
- [ ] Verify DimCode lifecycle: initialize, list, catalog sync, import, repeated import no duplication, commands, resume, prompt, explicit remote close.
- [ ] Verify Claude Code ACP initialize and auth-required path with timeout cleanup.
- [ ] Verify Codex ACP registry launch and local/global version drift diagnostics.
- [ ] Record exact command, version, capabilities, and result in ACP debug log or test notes.
- [ ] Keep `acpx` out of the matrix until an executable path or exact package name is available.

## 13. Final Quality Gates

- [ ] Run `pnpm run format`.
- [ ] Run `pnpm run i18n`.
- [ ] Run `pnpm run lint`.
- [ ] Run `pnpm run typecheck`.
- [ ] Run ACP main tests under `test/main/presenter/llmProviderPresenter`.
- [ ] Run `test/main/presenter/acpProvider.test.ts`.
- [ ] Run renderer tests for diagnostics UI if UI is changed.
- [ ] Update durable docs or archive this SDD folder after implementation is merged.
