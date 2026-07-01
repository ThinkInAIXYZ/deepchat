# Assistant Permission Review Mode Tasks

## 0. Review Gate

- [x] Review `spec.md` mode semantics with maintainers.
- [x] Confirm `auto_approve` product label in English and Chinese.
- [x] Confirm first increment excludes ACP permission auto-review.

## 1. Shared Contracts and Persistence

- [x] Extend `PermissionMode` to include `auto_approve`.
- [x] Extend `PermissionModeSchema`.
- [x] Extend DeepChat agent config schema for `permissionMode`.
- [x] Update session table TypeScript method signatures for `permission_mode`.
- [x] Update every permission-mode normalizer that currently collapses non-`default` to `full_access`.
- [x] Add/adjust route contract tests for `sessions.getPermissionMode` and `sessions.setPermissionMode`.

## 2. Renderer UI

- [x] Add `Approve for me` / `助手代审` i18n labels.
- [x] Add third dropdown option in `ChatStatusBar.vue`.
- [x] Preserve compact status bar layout and existing ACP hiding behavior.
- [x] Add renderer tests for rendering and selecting `auto_approve`.

## 3. Reviewer Gate

- [x] Add local permission review gate helper under agent runtime.
- [x] Build exact action envelope from tool call context and normalized permission request.
- [x] Canonicalize envelope and compute action hash.
- [x] Build untrusted-evidence reviewer prompt.
- [x] Resolve reviewer model from agent `assistantModel`, falling back to current session model.
- [x] Call standalone completion with timeout and abort handling.
- [x] Parse strict JSON decision and validate `actionHash`.
- [x] Apply deterministic post-policy.
- [x] Return `auto_allow`, `ask_user`, or `block` without executing tools directly.

## 4. Runtime Integration

- [x] Ensure `auto_approve` uses full-access-like capability reach for tool precheck and execution candidates.
- [x] Ensure agent tools surface reviewable external-file action candidates before execution.
- [x] Insert reviewer gate into `requiresPermission` handling.
- [x] Insert reviewer gate into prechecked permission handling.
- [x] Reuse `approvePermission()` for approved decisions when the action still maps to an existing permission request.
- [x] Use one-shot exact-action authorization for reviewed full-access-like actions that do not map to existing permission cache.
- [x] Fall back to existing permission interaction blocks on reviewer failure or `ask_user`.
- [x] Mark hard blocks as tool failures without executing the tool.
- [x] Add focused runtime tests for allow, ask-user fallback, timeout, invalid JSON, hash mismatch, and critical-risk rejection.

## 5. Audit and Verification

- [x] Add redacted review decision logging.
- [x] Run `pnpm run format`.
- [x] Run `pnpm run i18n`.
- [x] Run `pnpm run lint`.
- [x] Run focused main and renderer Vitest suites.
