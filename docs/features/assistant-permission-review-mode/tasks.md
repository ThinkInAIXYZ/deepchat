# Assistant Permission Review Mode Tasks

## 0. Review Gate

- [ ] Review `spec.md` mode semantics with maintainers.
- [ ] Confirm `auto_approve` product label in English and Chinese.
- [ ] Confirm first increment excludes ACP permission auto-review.

## 1. Shared Contracts and Persistence

- [ ] Extend `PermissionMode` to include `auto_approve`.
- [ ] Extend `PermissionModeSchema`.
- [ ] Extend DeepChat agent config schema for `permissionMode`.
- [ ] Update session table TypeScript method signatures for `permission_mode`.
- [ ] Update every permission-mode normalizer that currently collapses non-`default` to `full_access`.
- [ ] Add/adjust route contract tests for `sessions.getPermissionMode` and `sessions.setPermissionMode`.

## 2. Renderer UI

- [ ] Add `Approve for me` / `助手代审` i18n labels.
- [ ] Add third dropdown option in `ChatStatusBar.vue`.
- [ ] Preserve compact status bar layout and existing ACP hiding behavior.
- [ ] Add renderer tests for rendering and selecting `auto_approve`.

## 3. Reviewer Gate

- [ ] Add local permission review gate helper under agent runtime.
- [ ] Build exact action envelope from tool call context and normalized permission request.
- [ ] Canonicalize envelope and compute action hash.
- [ ] Build untrusted-evidence reviewer prompt.
- [ ] Resolve reviewer model from agent `assistantModel`, falling back to current session model.
- [ ] Call standalone completion with timeout and abort handling.
- [ ] Parse strict JSON decision and validate `actionHash`.
- [ ] Apply deterministic post-policy.
- [ ] Return `auto_allow`, `ask_user`, or `block` without executing tools directly.

## 4. Runtime Integration

- [ ] Ensure `auto_approve` uses full-access-like capability reach for tool precheck and execution candidates.
- [ ] Ensure agent tools surface reviewable external-file action candidates before execution.
- [ ] Insert reviewer gate into `requiresPermission` handling.
- [ ] Insert reviewer gate into prechecked permission handling.
- [ ] Reuse `approvePermission()` for approved decisions when the action still maps to an existing permission request.
- [ ] Use one-shot exact-action authorization for reviewed full-access-like actions that do not map to existing permission cache.
- [ ] Fall back to existing permission interaction blocks on reviewer failure or `ask_user`.
- [ ] Mark hard blocks as tool failures without executing the tool.
- [ ] Add focused runtime tests for allow, ask-user fallback, timeout, invalid JSON, hash mismatch, and critical-risk rejection.

## 5. Audit and Verification

- [ ] Add redacted review decision logging.
- [ ] Run `pnpm run format`.
- [ ] Run `pnpm run i18n`.
- [ ] Run `pnpm run lint`.
- [ ] Run focused main and renderer Vitest suites.
